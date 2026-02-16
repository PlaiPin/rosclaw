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
} from "@rosclaw/transport";

export interface LocalTransportOptions {
  domainId?: number;
}

/**
 * Mode A transport: direct local DDS communication on the same machine.
 *
 * When OpenClaw runs on the robot itself, this transport talks to ROS2
 * directly via the local DDS bus (e.g. through rclnodejs or a native
 * addon). No network transport is needed — only outbound internet for
 * the messaging API connections.
 *
 * TODO: Implement using rclnodejs or a similar Node.js ↔ DDS binding.
 */
export class LocalTransport implements RosTransport {
  constructor(_options?: LocalTransportOptions) {
    // TODO: Initialize rclnodejs context with domain ID
  }

  async connect(): Promise<void> {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }

  async disconnect(): Promise<void> {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }

  getStatus(): ConnectionStatus {
    return "disconnected";
  }

  onConnection(_handler: ConnectionHandler): () => void {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }

  publish(_options: PublishOptions): void {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }

  subscribe(_options: SubscribeOptions, _handler: MessageHandler): Subscription {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }

  async callService(_options: ServiceCallOptions): Promise<ServiceCallResult> {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }

  async sendActionGoal(_options: ActionGoalOptions): Promise<ActionResult> {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }

  async cancelActionGoal(_action: string): Promise<void> {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }

  async listTopics(): Promise<TopicInfo[]> {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }

  async listServices(): Promise<ServiceInfo[]> {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }

  async listActions(): Promise<ActionInfo[]> {
    throw new Error("LocalTransport is not yet implemented (Mode A)");
  }
}
