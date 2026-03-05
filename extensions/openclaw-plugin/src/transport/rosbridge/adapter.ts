import type { RosTransport } from "../transport.js";
import type {
  ConnectionStatus,
  ConnectionHandler,
  Subscription,
  PublishOptions,
  AdvertiseOptions,
  SubscribeOptions,
  ServiceCallOptions,
  ServiceCallResult,
  ActionGoalOptions,
  ActionResult,
  TopicInfo,
  ServiceInfo,
  ActionInfo,
  MessageHandler,
} from "../types.js";
import { RosbridgeClient } from "./client.js";
import { TopicPublisher, TopicSubscriber } from "./topics.js";
import { callService } from "./services.js";
import { ActionClient } from "./actions.js";
import type { RosbridgeClientOptions } from "./types.js";

/**
 * RosTransport adapter that wraps the existing RosbridgeClient.
 *
 * This is the Mode B (Local Network) transport. It connects to a
 * rosbridge_server running on the robot via WebSocket and translates
 * RosTransport method calls into rosbridge protocol messages.
 */
export class RosbridgeTransport implements RosTransport {
  private client: RosbridgeClient;
  private actionClient: ActionClient;

  constructor(options: RosbridgeClientOptions) {
    this.client = new RosbridgeClient(options);
    this.actionClient = new ActionClient(this.client);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  getStatus(): ConnectionStatus {
    return this.client.getStatus();
  }

  onConnection(handler: ConnectionHandler): () => void {
    return this.client.onConnection(handler);
  }

  advertise(options: AdvertiseOptions): void {
    this.client.send({
      op: "advertise",
      topic: options.topic,
      type: options.type,
    });
  }

  publish(options: PublishOptions): void {
    const publisher = new TopicPublisher(this.client, options.topic, options.type);
    publisher.publish(options.msg);
  }

  subscribe(options: SubscribeOptions, handler: MessageHandler): Subscription {
    const subscriber = new TopicSubscriber(this.client, options.topic, options.type);
    subscriber.subscribe(handler);
    return {
      unsubscribe() {
        subscriber.unsubscribe();
      },
    };
  }

  async callService(options: ServiceCallOptions): Promise<ServiceCallResult> {
    const response = await callService(
      this.client,
      options.service,
      options.args,
      options.type,
    );
    return {
      result: response.result,
      values: response.values,
    };
  }

  async sendActionGoal(options: ActionGoalOptions): Promise<ActionResult> {
    const response = await this.actionClient.sendGoal({
      action: options.action,
      actionType: options.actionType,
      args: options.args,
      onFeedback: options.onFeedback
        ? (feedback) => options.onFeedback!(feedback.values)
        : undefined,
    });
    return {
      result: response.result,
      values: response.values,
    };
  }

  async cancelActionGoal(action: string): Promise<void> {
    await this.actionClient.cancelGoal(action);
  }

  async listTopics(): Promise<TopicInfo[]> {
    const response = await callService(
      this.client,
      "/rosapi/topics",
      {},
      "rosapi/srv/Topics",
    );
    const topics = (response.values?.["topics"] as string[]) ?? [];
    const types = (response.values?.["types"] as string[]) ?? [];
    return topics.map((name, i) => ({ name, type: types[i] ?? "" }));
  }

  async listServices(): Promise<ServiceInfo[]> {
    const response = await callService(
      this.client,
      "/rosapi/services",
      {},
      "rosapi/srv/Services",
    );
    const services = (response.values?.["services"] as string[]) ?? [];
    const types = (response.values?.["types"] as string[]) ?? [];
    return services.map((name, i) => ({ name, type: types[i] ?? "" }));
  }

  async listActions(): Promise<ActionInfo[]> {
    // rosapi has no built-in action listing. Heuristic: action servers expose
    // topics matching */_action/feedback. Extract action names from that pattern.
    const topics = await this.listTopics();
    const actions: ActionInfo[] = [];
    const feedbackSuffix = "/_action/feedback";

    for (const topic of topics) {
      if (topic.name.endsWith(feedbackSuffix)) {
        const actionName = topic.name.slice(0, -feedbackSuffix.length);
        // Feedback type is like "pkg/action/Name_FeedbackMessage"
        // Extract base action type by stripping "_FeedbackMessage" suffix
        let actionType = topic.type;
        if (actionType.endsWith("_FeedbackMessage")) {
          actionType = actionType.slice(0, -"_FeedbackMessage".length);
        }
        actions.push({ name: actionName, type: actionType });
      }
    }

    return actions;
  }
}
