import type {
  RosTransport,
  ConnectionStatus,
  ConnectionHandler,
  Subscription,
  PublishOptions,
  SubscribeOptions,
  ServiceCallOptions,
  ServiceCallResult,
  ActionGoalOptions,
  ActionResult,
  TopicInfo,
  ServiceInfo,
  ActionInfo,
  MessageHandler,
  RTCIceServerConfig,
} from "@rosclaw/transport";

export interface WebRTCTransportOptions {
  /** WebSocket URL of the signaling server (e.g., wss://signal-host). */
  signalingUrl: string;
  /** REST API URL of the signaling server (e.g., https://signal-host). */
  apiUrl: string;
  /** Target robot's ID on the signaling server. */
  robotId: string;
  /** Robot key secret — validated by the robot, not the signaling server. */
  robotKey: string;
  /** STUN/TURN server configuration. */
  iceServers?: RTCIceServerConfig[];
}

/**
 * Mode C transport: WebRTC data channel for cloud/remote deployments.
 *
 * Integrates with the existing signaling server at webrtc-py:
 *
 * ## Connection flow (connect):
 *   1. POST /api/robots/{robotId}/connect with robot_key header
 *   2. Open WebSocket to signalingUrl
 *   3. Send JOIN_ROOM message to join the robot's session room
 *   4. Exchange SDP offer/answer with the robot's agent node
 *   5. Exchange ICE candidates for NAT traversal
 *   6. Open RTCDataChannel for rosbridge JSON messages
 *
 * ## Message flow (publish/subscribe/callService):
 *   - All ROS2 operations are serialized as rosbridge-protocol JSON
 *   - JSON is sent/received over the WebRTC data channel
 *   - The robot-side rosclaw_agent node deserializes and executes
 *     against the local ROS2 DDS bus
 *
 * ## Disconnection flow (disconnect):
 *   1. Close the RTCDataChannel
 *   2. Close the RTCPeerConnection
 *   3. POST /api/robots/{robotId}/disconnect
 *   4. Close the signaling WebSocket
 *
 * TODO: Implement using wrtc (node-webrtc) or similar Node.js WebRTC library.
 */
export class WebRTCTransport implements RosTransport {
  constructor(_options: WebRTCTransportOptions) {
    // TODO: Store options, initialize WebRTC peer connection factory
  }

  async connect(): Promise<void> {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }

  async disconnect(): Promise<void> {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }

  getStatus(): ConnectionStatus {
    return "disconnected";
  }

  onConnection(_handler: ConnectionHandler): () => void {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }

  publish(_options: PublishOptions): void {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }

  subscribe(_options: SubscribeOptions, _handler: MessageHandler): Subscription {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }

  async callService(_options: ServiceCallOptions): Promise<ServiceCallResult> {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }

  async sendActionGoal(_options: ActionGoalOptions): Promise<ActionResult> {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }

  async cancelActionGoal(_action: string): Promise<void> {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }

  async listTopics(): Promise<TopicInfo[]> {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }

  async listServices(): Promise<ServiceInfo[]> {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }

  async listActions(): Promise<ActionInfo[]> {
    throw new Error("WebRTCTransport is not yet implemented (Mode C)");
  }
}
