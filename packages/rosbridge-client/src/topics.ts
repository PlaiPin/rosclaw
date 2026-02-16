import type { RosbridgeClient } from "./client.js";
import type { MessageHandler } from "./types.js";

/**
 * Helper for publishing messages to a ROS2 topic.
 */
export class TopicPublisher {
  constructor(
    private client: RosbridgeClient,
    private topic: string,
    private type: string,
  ) {}

  /** Publish a message to the topic. */
  publish(msg: Record<string, unknown>): void {
    // TODO: Implement topic publish
    // - Send a publish message via the client
    this.client.send({
      op: "publish",
      topic: this.topic,
      type: this.type,
      msg,
    });
  }
}

/**
 * Helper for subscribing to messages from a ROS2 topic.
 */
export class TopicSubscriber {
  private unsubscribeFromClient: (() => void) | null = null;

  constructor(
    private client: RosbridgeClient,
    private topic: string,
    private type?: string,
  ) {}

  /** Subscribe to the topic and receive messages via the handler. */
  subscribe(handler: MessageHandler): void {
    // TODO: Implement topic subscribe
    // - Send a subscribe message via the client
    // - Register handler for incoming messages on this topic
    this.unsubscribeFromClient = this.client.onMessage(this.topic, handler);
    this.client.send({
      op: "subscribe",
      id: this.client.nextId("subscribe"),
      topic: this.topic,
      type: this.type,
    });
  }

  /** Unsubscribe from the topic. */
  unsubscribe(): void {
    // TODO: Implement topic unsubscribe
    // - Send an unsubscribe message via the client
    // - Remove handler
    if (this.unsubscribeFromClient) {
      this.unsubscribeFromClient();
      this.unsubscribeFromClient = null;
    }
    this.client.send({
      op: "unsubscribe",
      id: this.client.nextId("unsubscribe"),
      topic: this.topic,
    });
  }
}
