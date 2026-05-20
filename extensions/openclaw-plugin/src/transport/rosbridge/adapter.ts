import type { RosTransport } from "../transport.js";
import type {
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
  NodeInfo,
  NodeDetails,
  TopicDetails,
  ServiceDetails,
  ActionDetails,
  RosTypeDef,
  MessageSchema,
  ServiceSchema,
  ActionSchema,
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
      "rosapi_msgs/srv/Topics",
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
      "rosapi_msgs/srv/Services",
    );
    const services = (response.values?.["services"] as string[]) ?? [];
    return Promise.all(
      services.map(async (name) => ({ name, type: await this.getServiceType(name) })),
    );
  }

  async listActions(): Promise<ActionInfo[]> {
    const response = await callService(
      this.client,
      "/rosapi/action_servers",
      {},
      "rosapi_msgs/srv/GetActionServers",
    );
    const actionServers = stringArray(response.values?.["action_servers"]);
    if (actionServers.length > 0) {
      return Promise.all(
        actionServers.map(async (name) => ({
          name,
          type: await this.getActionType(name),
        })),
      );
    }

    // Fallback for rosapi variants that do not expose /rosapi/action_servers.
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

  async listNodes(): Promise<NodeInfo[]> {
    const response = await callService(
      this.client,
      "/rosapi/nodes",
      {},
      "rosapi_msgs/srv/Nodes",
    );
    return stringArray(response.values?.["nodes"]).map((name) => ({ name }));
  }

  async getNodeInfo(node: string): Promise<NodeDetails> {
    const response = await callService(
      this.client,
      "/rosapi/node_details",
      { node },
      "rosapi_msgs/srv/NodeDetails",
    );
    return {
      name: node,
      subscribing: stringArray(response.values?.["subscribing"]),
      publishing: stringArray(response.values?.["publishing"]),
      services: stringArray(response.values?.["services"]),
    };
  }

  async getTopicInfo(topic: string): Promise<TopicDetails> {
    const [typeResponse, publishersResponse, subscribersResponse] = await Promise.all([
      callService(this.client, "/rosapi/topic_type", { topic }, "rosapi_msgs/srv/TopicType"),
      callService(this.client, "/rosapi/publishers", { topic }, "rosapi_msgs/srv/Publishers"),
      callService(this.client, "/rosapi/subscribers", { topic }, "rosapi_msgs/srv/Subscribers"),
    ]);
    const publishers = stringArray(publishersResponse.values?.["publishers"]);
    const subscribers = stringArray(subscribersResponse.values?.["subscribers"]);
    return {
      name: topic,
      type: stringValue(typeResponse.values?.["type"]),
      publishers,
      subscribers,
      publisherCount: publishers.length,
      subscriberCount: subscribers.length,
      qosAvailable: false,
      qosProfiles: [],
    };
  }

  async getServiceInfo(service: string): Promise<ServiceDetails> {
    const [type, nodeResponse] = await Promise.all([
      this.getServiceType(service),
      callService(
        this.client,
        "/rosapi/service_node",
        { service },
        "rosapi_msgs/srv/ServiceNode",
      ),
    ]);
    const provider = stringValue(nodeResponse.values?.["node"]);
    const providers = provider ? [provider] : [];
    return {
      name: service,
      type,
      providers,
      providerCount: providers.length,
    };
  }

  async getActionInfo(action: string): Promise<ActionDetails> {
    const type = await this.getActionType(action);
    return {
      name: action,
      type,
      servers: type ? [action] : [],
    };
  }

  async getMessageSchema(type: string): Promise<MessageSchema> {
    const response = await callService(
      this.client,
      "/rosapi/message_details",
      { type },
      "rosapi_msgs/srv/MessageDetails",
    );
    return { type, typedefs: typeDefs(response.values?.["typedefs"]) };
  }

  async getServiceSchema(type: string): Promise<ServiceSchema> {
    const [requestResponse, responseResponse] = await Promise.all([
      callService(
        this.client,
        "/rosapi/service_request_details",
        { type },
        "rosapi_msgs/srv/ServiceRequestDetails",
      ),
      callService(
        this.client,
        "/rosapi/service_response_details",
        { type },
        "rosapi_msgs/srv/ServiceResponseDetails",
      ),
    ]);
    return {
      type,
      request: typeDefs(requestResponse.values?.["typedefs"]),
      response: typeDefs(responseResponse.values?.["typedefs"]),
    };
  }

  async getActionSchema(type: string): Promise<ActionSchema> {
    const [goalResponse, resultResponse, feedbackResponse] = await Promise.all([
      callService(
        this.client,
        "/rosapi/action_goal_details",
        { type },
        "rosapi_msgs/srv/ActionGoalDetails",
      ),
      callService(
        this.client,
        "/rosapi/action_result_details",
        { type },
        "rosapi_msgs/srv/ActionResultDetails",
      ),
      callService(
        this.client,
        "/rosapi/action_feedback_details",
        { type },
        "rosapi_msgs/srv/ActionFeedbackDetails",
      ),
    ]);
    return {
      type,
      goal: typeDefs(goalResponse.values?.["typedefs"]),
      result: typeDefs(resultResponse.values?.["typedefs"]),
      feedback: typeDefs(feedbackResponse.values?.["typedefs"]),
    };
  }

  private async getActionType(action: string): Promise<string> {
    const response = await callService(
      this.client,
      "/rosapi/action_type",
      { action },
      "rosapi_msgs/srv/ActionType",
    );
    return stringValue(response.values?.["type"]);
  }

  private async getServiceType(service: string): Promise<string> {
    const response = await callService(
      this.client,
      "/rosapi/service_type",
      { service },
      "rosapi_msgs/srv/ServiceType",
    );
    return stringValue(response.values?.["type"]);
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function typeDefs(value: unknown): RosTypeDef[] {
  return Array.isArray(value)
    ? value.filter(isTypeDef).map((item) => ({
        type: item.type,
        fieldnames: item.fieldnames,
        fieldtypes: item.fieldtypes,
        fieldarraylen: item.fieldarraylen,
        examples: item.examples,
        constnames: item.constnames,
        constvalues: item.constvalues,
      }))
    : [];
}

function isTypeDef(value: unknown): value is RosTypeDef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["type"] === "string" &&
    isStringArray(candidate["fieldnames"]) &&
    isStringArray(candidate["fieldtypes"]) &&
    isNumberArray(candidate["fieldarraylen"]) &&
    isStringArray(candidate["examples"]) &&
    isStringArray(candidate["constnames"]) &&
    isStringArray(candidate["constvalues"])
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}
