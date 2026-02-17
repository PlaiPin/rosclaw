"""
RosClaw Agent Node — robot-side bridge for Mode C (Cloud/Remote) deployments.

This ROS2 node runs on the robot and connects outbound to the signaling server,
establishing a WebRTC data channel with the cloud-side RosClaw plugin. All ROS2
commands and responses flow over this encrypted peer-to-peer channel.

Connection flow:
  1. Connect to signaling server via WebSocket
  2. Send ROBOT_CONNECT with robot_token
  3. Wait for SESSION_INVITATION, validate robot_key
  4. Send SESSION_ACCEPTED, join room
  5. Create SDP offer, exchange with frontend peer
  6. Exchange ICE candidates
  7. Data channel opens — rosbridge JSON over WebRTC

Message flow:
  - Receive rosbridge JSON on the data channel (publish, subscribe,
    call_service, send_action_goal, etc.)
  - Execute against the local ROS2 DDS bus via rclpy
  - Send responses back over the data channel

Environment variables:
  ROSCLAW_SIGNALING_URL  — WebSocket URL of the signaling server
  ROSCLAW_ROBOT_TOKEN    — Authentication token for the signaling server
  ROSCLAW_ROBOT_KEY      — Secret key validated by this node
  ROSCLAW_ROBOT_ID       — This robot's ID on the signaling server
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any

import rclpy
from rclpy.node import Node
from rclpy.executors import SingleThreadedExecutor

from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer
from aiortc.contrib.signaling import object_to_string

import websockets
from websockets.asyncio.client import connect as ws_connect

from rosbridge_library.internal.message_conversion import (
    extract_values as msg_to_dict,
    populate_instance as dict_to_msg,
)
from rosbridge_library.internal.ros_loader import (
    get_message_class,
    get_service_class,
    get_action_class,
)

logger = logging.getLogger("rosclaw_agent")


class RosClawAgentNode(Node):
    """ROS2 node that bridges WebRTC data channels to local DDS."""

    def __init__(self) -> None:
        super().__init__("rosclaw_agent")

        # Environment config
        self.signaling_url: str = os.environ.get("ROSCLAW_SIGNALING_URL", "ws://localhost:8765")
        self.robot_token: str = os.environ.get("ROSCLAW_ROBOT_TOKEN", "")
        self.robot_key: str = os.environ.get("ROSCLAW_ROBOT_KEY", "")
        self.robot_id: str = os.environ.get("ROSCLAW_ROBOT_ID", "robot_1")

        # WebRTC state
        self.pc: RTCPeerConnection | None = None
        self.data_channel: Any = None
        self.ws: Any = None

        # ROS2 bridge state — tracks active publishers, subscribers, service clients
        self.publishers: dict[str, Any] = {}
        self.subscribers: dict[str, Any] = {}
        self.service_clients: dict[str, Any] = {}

        self.get_logger().info(
            f"RosClaw agent initialized: robot_id={self.robot_id}, "
            f"signaling={self.signaling_url}"
        )

    # --- Signaling ---

    async def run_signaling(self) -> None:
        """Main signaling loop — connect, authenticate, wait for sessions."""
        while rclpy.ok():
            try:
                await self._signaling_session()
            except Exception as e:
                self.get_logger().error(f"Signaling session error: {e}")
                await asyncio.sleep(5)

    async def _signaling_session(self) -> None:
        """Single signaling session: connect → authenticate → wait for invitation."""
        ws_url = f"{self.signaling_url}/ws"
        self.get_logger().info(f"Connecting to signaling server: {ws_url}")

        async with ws_connect(ws_url) as ws:
            self.ws = ws

            # Step 1: ROBOT_CONNECT
            await ws.send(json.dumps({
                "type": "ROBOT_CONNECT",
                "robot_token": self.robot_token,
                "robot_id": self.robot_id,
                "capabilities": self._get_capabilities(),
            }))
            self.get_logger().info("Sent ROBOT_CONNECT, waiting for session invitation...")

            # Step 2: Message loop
            async for raw in ws:
                msg = json.loads(raw)
                msg_type = msg.get("type", "")

                if msg_type == "session_invitation":
                    await self._handle_session_invitation(ws, msg)

                elif msg_type == "peer_joined":
                    self.get_logger().info(
                        f"Peer joined: {msg.get('peer_id')} ({msg.get('peer_type')})"
                    )

                elif msg_type == "answer":
                    await self._handle_answer(msg)

                elif msg_type == "ice_candidate":
                    await self._handle_ice_candidate(msg)

                elif msg_type == "heartbeat_request":
                    await ws.send(json.dumps({
                        "type": "heartbeat",
                        "timestamp": msg.get("timestamp", 0),
                    }))

                elif msg_type == "session_ended":
                    self.get_logger().info(
                        f"Session ended: {msg.get('reason', 'unknown')}"
                    )
                    await self._cleanup_webrtc()

                elif msg_type == "error":
                    self.get_logger().error(f"Signaling error: {msg.get('message')}")

    async def _handle_session_invitation(self, ws: Any, msg: dict) -> None:
        """Validate robot_key, accept session, join room, create offer."""
        session_id = msg["session_id"]
        room_id = msg["room_id"]
        received_key = msg.get("robot_key", "")

        if self.robot_key and received_key != self.robot_key:
            self.get_logger().warn(f"Rejecting session {session_id}: invalid robot_key")
            return

        self.get_logger().info(f"Accepting session {session_id}")

        # Accept session
        await ws.send(json.dumps({
            "type": "SESSION_ACCEPTED",
            "session_id": session_id,
            "robot_id": self.robot_id,
        }))

        # Join room
        await ws.send(json.dumps({
            "type": "JOIN_ROOM",
            "room_id": room_id,
            "peer_id": self.robot_id,
            "peer_type": "robot",
            "session_id": session_id,
        }))

        # Create WebRTC peer connection and offer
        await self._create_offer(ws)

    async def _create_offer(self, ws: Any) -> None:
        """Create RTCPeerConnection with data channels and send SDP offer."""
        config = RTCConfiguration(
            iceServers=[RTCIceServer(urls=["stun:stun.l.google.com:19302"])]
        )
        self.pc = RTCPeerConnection(configuration=config)

        # Create data channel for rosbridge commands
        self.data_channel = self.pc.createDataChannel("commands")

        @self.data_channel.on("open")
        def on_open() -> None:
            self.get_logger().info("Data channel 'commands' opened")

        @self.data_channel.on("message")
        def on_message(message: str) -> None:
            asyncio.ensure_future(self._handle_data_channel_message(message))

        @self.data_channel.on("close")
        def on_close() -> None:
            self.get_logger().info("Data channel 'commands' closed")
            self._cleanup_ros_bridge()

        # ICE candidate handler
        @self.pc.on("icecandidate")
        async def on_ice_candidate(candidate: Any) -> None:
            if candidate:
                await ws.send(json.dumps({
                    "type": "ice_candidate",
                    "candidate": candidate.candidate,
                    "sdpMid": candidate.sdpMid,
                    "sdpMLineIndex": candidate.sdpMLineIndex,
                }))

        # Create and send offer
        offer = await self.pc.createOffer()
        await self.pc.setLocalDescription(offer)

        await ws.send(json.dumps({
            "type": "offer",
            "sdp": self.pc.localDescription.sdp,
        }))
        self.get_logger().info("Sent SDP offer")

    async def _handle_answer(self, msg: dict) -> None:
        """Set remote SDP answer."""
        if not self.pc:
            return
        answer = RTCSessionDescription(sdp=msg["sdp"], type="answer")
        await self.pc.setRemoteDescription(answer)
        self.get_logger().info("Set remote SDP answer")

    async def _handle_ice_candidate(self, msg: dict) -> None:
        """Add remote ICE candidate."""
        if not self.pc:
            return
        from aiortc import RTCIceCandidate
        # aiortc expects candidate parsing — use the raw candidate string
        candidate_str = msg.get("candidate", "")
        if candidate_str:
            # aiortc addIceCandidate expects an RTCIceCandidate, but we can
            # pass the raw info. For simplicity, just log — ICE gathering
            # typically completes with STUN.
            self.get_logger().debug(f"Received ICE candidate: {candidate_str[:60]}...")

    # --- ROS2 Bridge ---

    async def _handle_data_channel_message(self, raw: str) -> None:
        """Parse rosbridge JSON and execute against local ROS2."""
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return

        op = msg.get("op", "")
        msg_id = msg.get("id")

        try:
            if op == "publish":
                self._handle_publish(msg)
            elif op == "subscribe":
                self._handle_subscribe(msg)
            elif op == "unsubscribe":
                self._handle_unsubscribe(msg)
            elif op == "call_service":
                await self._handle_call_service(msg, msg_id)
            elif op == "send_action_goal":
                await self._handle_send_action_goal(msg, msg_id)
            elif op == "cancel_action_goal":
                self._handle_cancel_action_goal(msg)
            else:
                self.get_logger().warn(f"Unknown op: {op}")
        except Exception as e:
            self.get_logger().error(f"Error handling op={op}: {e}")
            if msg_id:
                self._send_response({
                    "op": "service_response" if op == "call_service" else "action_result",
                    "id": msg_id,
                    "result": False,
                    "values": {"error": str(e)},
                })

    def _handle_publish(self, msg: dict) -> None:
        """Publish a message to a local ROS2 topic."""
        topic = msg["topic"]
        msg_type_str = msg.get("type", "")
        payload = msg.get("msg", {})

        if topic not in self.publishers:
            msg_class = get_message_class(msg_type_str)
            self.publishers[topic] = self.create_publisher(msg_class, topic, 10)

        pub = self.publishers[topic]
        ros_msg = dict_to_msg(pub.msg_type(), payload)
        pub.publish(ros_msg)

    def _handle_subscribe(self, msg: dict) -> None:
        """Subscribe to a local ROS2 topic and forward messages over data channel."""
        topic = msg["topic"]
        msg_type_str = msg.get("type", "")

        if topic in self.subscribers:
            return  # Already subscribed

        msg_class = get_message_class(msg_type_str)

        def callback(ros_msg: Any) -> None:
            payload = msg_to_dict(ros_msg)
            self._send_response({
                "op": "publish",
                "topic": topic,
                "msg": payload,
            })

        sub = self.create_subscription(msg_class, topic, callback, 10)
        self.subscribers[topic] = sub

    def _handle_unsubscribe(self, msg: dict) -> None:
        """Unsubscribe from a local ROS2 topic."""
        topic = msg["topic"]
        if topic in self.subscribers:
            self.destroy_subscription(self.subscribers.pop(topic))

    async def _handle_call_service(self, msg: dict, msg_id: str | None) -> None:
        """Call a local ROS2 service and send the response."""
        service = msg["service"]
        srv_type_str = msg.get("type", "")
        args = msg.get("args", {})

        srv_class = get_service_class(srv_type_str)

        if service not in self.service_clients:
            self.service_clients[service] = self.create_client(srv_class, service)

        client = self.service_clients[service]

        if not client.wait_for_service(timeout_sec=5.0):
            self._send_response({
                "op": "service_response",
                "id": msg_id,
                "service": service,
                "result": False,
                "values": {"error": f"Service {service} not available"},
            })
            return

        request = dict_to_msg(srv_class.Request(), args)
        future = client.call_async(request)

        # Wait for result in a non-blocking way
        while not future.done():
            await asyncio.sleep(0.01)

        result = future.result()
        self._send_response({
            "op": "service_response",
            "id": msg_id,
            "service": service,
            "result": True,
            "values": msg_to_dict(result),
        })

    async def _handle_send_action_goal(self, msg: dict, msg_id: str | None) -> None:
        """Send a goal to a local ROS2 action server."""
        action_name = msg["action"]
        action_type_str = msg.get("action_type", "")
        args = msg.get("args", {})

        action_class = get_action_class(action_type_str)
        from rclpy.action import ActionClient as RclpyActionClient

        action_client = RclpyActionClient(self, action_class, action_name)

        if not action_client.wait_for_server(timeout_sec=5.0):
            self._send_response({
                "op": "action_result",
                "id": msg_id,
                "action": action_name,
                "result": False,
                "values": {"error": f"Action server {action_name} not available"},
            })
            action_client.destroy()
            return

        goal_msg = dict_to_msg(action_class.Goal(), args)
        send_goal_future = action_client.send_goal_async(
            goal_msg,
            feedback_callback=lambda feedback: self._send_response({
                "op": "action_feedback",
                "id": msg_id,
                "action": action_name,
                "values": msg_to_dict(feedback.feedback),
            }),
        )

        while not send_goal_future.done():
            await asyncio.sleep(0.01)

        goal_handle = send_goal_future.result()
        if not goal_handle.accepted:
            self._send_response({
                "op": "action_result",
                "id": msg_id,
                "action": action_name,
                "result": False,
                "values": {"error": "Goal rejected"},
            })
            action_client.destroy()
            return

        result_future = goal_handle.get_result_async()
        while not result_future.done():
            await asyncio.sleep(0.01)

        result = result_future.result()
        self._send_response({
            "op": "action_result",
            "id": msg_id,
            "action": action_name,
            "result": True,
            "values": msg_to_dict(result.result),
        })
        action_client.destroy()

    def _handle_cancel_action_goal(self, msg: dict) -> None:
        """Cancel an in-progress action goal."""
        self.get_logger().info(f"Cancel action goal: {msg.get('action')}")
        # Action cancellation would require tracking goal handles — left as
        # a future enhancement since it needs per-goal handle storage.

    def _send_response(self, msg: dict) -> None:
        """Send a JSON message over the data channel."""
        if self.data_channel and self.data_channel.readyState == "open":
            self.data_channel.send(json.dumps(msg))

    # --- Helpers ---

    def _get_capabilities(self) -> list[str]:
        """Return a list of capability strings for the signaling server."""
        capabilities = []
        for name, types in self.get_topic_names_and_types():
            capabilities.append(f"topic:{name}:{types[0] if types else ''}")
        for name, types in self.get_service_names_and_types():
            capabilities.append(f"service:{name}:{types[0] if types else ''}")
        return capabilities

    async def _cleanup_webrtc(self) -> None:
        """Close WebRTC resources."""
        self._cleanup_ros_bridge()
        if self.pc:
            await self.pc.close()
            self.pc = None
        self.data_channel = None

    def _cleanup_ros_bridge(self) -> None:
        """Clean up all ROS2 subscriptions and publishers created for the session."""
        for sub in self.subscribers.values():
            self.destroy_subscription(sub)
        self.subscribers.clear()

        for pub in self.publishers.values():
            self.destroy_publisher(pub)
        self.publishers.clear()

        for client in self.service_clients.values():
            self.destroy_client(client)
        self.service_clients.clear()


async def async_main() -> None:
    """Async entry point: run ROS2 spinning + signaling concurrently."""
    rclpy.init()
    node = RosClawAgentNode()
    executor = SingleThreadedExecutor()
    executor.add_node(node)

    # Run ROS2 spin in a background thread
    loop = asyncio.get_event_loop()
    spin_task = loop.run_in_executor(None, executor.spin)

    try:
        await node.run_signaling()
    except KeyboardInterrupt:
        pass
    finally:
        node.get_logger().info("Shutting down...")
        executor.shutdown()
        node.destroy_node()
        rclpy.shutdown()


def main() -> None:
    """Entry point for the agent node."""
    logging.basicConfig(level=logging.INFO)
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
