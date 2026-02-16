"""
RosClaw Agent Node — robot-side bridge for Mode C (Cloud/Remote) deployments.

This ROS2 node runs on the robot and connects outbound to the signaling server,
establishing a WebRTC data channel with the cloud-side RosClaw plugin. All ROS2
commands and responses flow over this encrypted peer-to-peer channel.

## Connection flow:

1. Connect to signaling server via WebSocket at ROSCLAW_SIGNALING_URL
2. Send ROBOT_CONNECT with robot_token (from ROSCLAW_ROBOT_TOKEN env var)
3. Listen for SESSION_INVITATION from the cloud-side plugin
4. Validate robot_key in the invitation (from ROSCLAW_ROBOT_KEY env var)
5. Send SESSION_ACCEPTED to confirm
6. Join the session room
7. Exchange SDP offer/answer with the cloud-side plugin
8. Exchange ICE candidates for NAT traversal
9. Establish WebRTC data channel (label: "rosbridge")

## Message flow:

- Receive rosbridge-protocol JSON commands on the data channel
  (publish, subscribe, call_service, send_action_goal, etc.)
- Execute each command against the local ROS2 DDS bus via rclpy
- Send responses (service_response, action_result, topic messages)
  back over the data channel

## Environment variables:

- ROSCLAW_SIGNALING_URL: WebSocket URL of the signaling server
- ROSCLAW_ROBOT_TOKEN: Authentication token for the signaling server
- ROSCLAW_ROBOT_KEY: Secret key validated by this node (not the server)
- ROSCLAW_ROBOT_ID: This robot's ID on the signaling server
- ROS_DOMAIN_ID: ROS2 domain ID (default: 0)

TODO: Implement full agent node with:
- aiortc for WebRTC peer connection
- websockets for signaling server communication
- rclpy for local ROS2 DDS bridge
- Rosbridge protocol message parsing and execution
"""


def main():
    # TODO: Implement agent node
    print("rosclaw_agent: not yet implemented (Mode C)")


if __name__ == "__main__":
    main()
