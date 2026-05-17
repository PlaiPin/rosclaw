import { createRequire } from "node:module";
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
  MessageSchema,
  ServiceSchema,
  ActionSchema,
  MessageHandler,
} from "../types.js";
import { EntityCache } from "./entities.js";
import { toRosMessage, fromRosMessage, loadMessageClass, clearTypeCache } from "./conversion.js";

const require = createRequire(import.meta.url);

export interface LocalTransportOptions {
  domainId?: number;
}

/** Internal ROS2 topics/services to filter from introspection results. */
const INTERNAL_TOPIC_PREFIXES = ["/rosout", "/parameter_events", "/rosclaw/"];
const INTERNAL_SERVICE_SUFFIXES = [
  "/describe_parameters",
  "/get_parameter_types",
  "/get_parameters",
  "/list_parameters",
  "/set_parameters",
  "/set_parameters_atomically",
];

/**
 * Mode A transport: direct local DDS communication via rclnodejs.
 *
 * When OpenClaw runs on the robot itself, this transport talks to ROS2
 * directly via the local DDS bus — no network intermediary needed.
 */
export class LocalTransport implements RosTransport {
  private domainId: number;
  private status: ConnectionStatus = "disconnected";
  private connectionHandlers = new Set<ConnectionHandler>();
  /** rclnodejs module — loaded dynamically at runtime (optional dep, no types). */
  private rclnodejs: any = null;
  private node: any = null;
  private entityCache: EntityCache | null = null;
  private activeGoals = new Map<string, any>();

  /** Singleton guard — rclnodejs.init() must only be called once per process. */
  private static rclInitialized = false;

  constructor(options?: LocalTransportOptions) {
    this.domainId = options?.domainId ?? 0;
  }

  // --- Connection lifecycle ---

  async connect(): Promise<void> {
    if (this.status === "connected") return;
    this.setStatus("connecting");

    try {
      this.rclnodejs = require("rclnodejs");

      // Set domain ID before init if non-default
      if (this.domainId !== 0) {
        process.env.ROS_DOMAIN_ID = String(this.domainId);
      }

      // Global init — only once per process
      if (!LocalTransport.rclInitialized) {
        await this.rclnodejs!.init();
        LocalTransport.rclInitialized = true;
      }

      this.node = this.rclnodejs!.createNode("rosclaw_local");
      this.rclnodejs!.spin(this.node);
      this.entityCache = new EntityCache();

      this.setStatus("connected");
    } catch (err) {
      this.setStatus("disconnected");
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.status === "disconnected") return;

    // Cancel any active action goals
    for (const [action] of this.activeGoals) {
      try {
        await this.cancelActionGoal(action);
      } catch {
        // Best-effort
      }
    }
    this.activeGoals.clear();

    if (this.entityCache && this.node) {
      this.entityCache.destroyAll(this.node);
      this.entityCache = null;
    }

    if (this.node) {
      this.node.destroy();
      this.node = null;
    }

    if (this.rclnodejs && LocalTransport.rclInitialized) {
      try {
        this.rclnodejs.shutdown();
      } catch {
        // May already be shut down
      }
      LocalTransport.rclInitialized = false;
    }

    clearTypeCache();
    this.rclnodejs = null;
    this.setStatus("disconnected");
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onConnection(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }

  // --- Topics ---

  publish(options: PublishOptions): void {
    this.ensureConnected();
    const publisher = this.entityCache!.getPublisher(this.node, options.topic, options.type);
    const rosMsg = toRosMessage(options.type, options.msg);
    publisher.publish(rosMsg);
  }

  subscribe(options: SubscribeOptions, handler: MessageHandler): Subscription {
    this.ensureConnected();
    const type = options.type ?? this.resolveTopicType(options.topic);
    if (!type) {
      throw new Error(
        `Cannot subscribe to ${options.topic}: type is required when it cannot be inferred`,
      );
    }
    return this.entityCache!.addSubscription(this.node, options.topic, type, handler);
  }

  // --- Services ---

  async callService(options: ServiceCallOptions): Promise<ServiceCallResult> {
    this.ensureConnected();

    const type = options.type ?? this.resolveServiceType(options.service);
    if (!type) {
      throw new Error(
        `Cannot call service ${options.service}: type is required when it cannot be inferred`,
      );
    }

    const client = this.entityCache!.getServiceClient(this.node, options.service, type);

    // Wait for service to become available (5s timeout)
    const available = await client.waitForService(5000);
    if (!available) {
      throw new Error(`Service ${options.service} not available after 5 seconds`);
    }

    // Create request from args
    const ServiceClass = loadMessageClass(type);
    const request = new ServiceClass.Request();
    if (options.args) {
      for (const [key, value] of Object.entries(options.args)) {
        request[key] = value;
      }
    }

    // Send request with Promise wrapping + timeout
    const response = await this.sendServiceRequest(client, request, 30_000);

    return {
      result: true,
      values: fromRosMessage(response),
    };
  }

  // --- Actions ---

  async sendActionGoal(options: ActionGoalOptions): Promise<ActionResult> {
    this.ensureConnected();

    const ActionClass = loadMessageClass(options.actionType);
    const actionClient = new (this.rclnodejs!.ActionClient as any)(
      this.node,
      ActionClass,
      options.action,
    );

    // Wait for action server (5s)
    const available = await actionClient.waitForServer(5000);
    if (!available) {
      actionClient.destroy();
      throw new Error(`Action server ${options.action} not available after 5 seconds`);
    }

    // Build goal message
    const goal = new ActionClass.Goal();
    if (options.args) {
      for (const [key, value] of Object.entries(options.args)) {
        goal[key] = value;
      }
    }

    try {
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.activeGoals.delete(options.action);
          reject(new Error(`Action ${options.action} timed out after 120 seconds`));
        }, 120_000);

        actionClient.sendGoal(
          goal,
          (goalHandle: any) => {
            // Goal response callback — store for cancellation
            this.activeGoals.set(options.action, goalHandle);
          },
          (feedback: any) => {
            // Feedback callback
            if (options.onFeedback) {
              options.onFeedback(fromRosMessage(feedback));
            }
          },
          (resultResponse: any) => {
            // Result callback
            clearTimeout(timer);
            this.activeGoals.delete(options.action);
            resolve(fromRosMessage(resultResponse));
          },
        );
      });

      return { result: true, values: result };
    } finally {
      actionClient.destroy();
    }
  }

  async cancelActionGoal(action: string): Promise<void> {
    const goalHandle = this.activeGoals.get(action);
    if (goalHandle && typeof goalHandle.cancelGoal === "function") {
      await goalHandle.cancelGoal();
      this.activeGoals.delete(action);
    }
  }

  // --- Introspection ---

  async listTopics(): Promise<TopicInfo[]> {
    this.ensureConnected();

    const namesAndTypes: Array<{ name: string; types: string[] }> =
      this.node.getTopicNamesAndTypes();

    return namesAndTypes
      .filter((t) => !INTERNAL_TOPIC_PREFIXES.some((prefix) => t.name.startsWith(prefix)))
      .map((t) => ({ name: t.name, type: t.types[0] ?? "" }));
  }

  async listServices(): Promise<ServiceInfo[]> {
    this.ensureConnected();

    const namesAndTypes: Array<{ name: string; types: string[] }> =
      this.node.getServiceNamesAndTypes();

    return namesAndTypes
      .filter((s) => !INTERNAL_SERVICE_SUFFIXES.some((suffix) => s.name.endsWith(suffix)))
      .filter((s) => !INTERNAL_TOPIC_PREFIXES.some((prefix) => s.name.startsWith(prefix)))
      .map((s) => ({ name: s.name, type: s.types[0] ?? "" }));
  }

  async listActions(): Promise<ActionInfo[]> {
    // Same feedback-topic heuristic as rosbridge/adapter.ts
    const topics = await this.listTopics();
    const actions: ActionInfo[] = [];
    const feedbackSuffix = "/_action/feedback";

    for (const topic of topics) {
      if (topic.name.endsWith(feedbackSuffix)) {
        const actionName = topic.name.slice(0, -feedbackSuffix.length);
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
    this.ensureConnected();
    return this.getNodeNames().map((name) => ({ name }));
  }

  async getNodeInfo(node: string): Promise<NodeDetails> {
    this.ensureConnected();
    const topics = await this.listTopics();
    const services = await this.listServices();
    return {
      name: node,
      subscribing: topics
        .filter((topic) => this.topicHasNode(topic.name, node, "subscriber"))
        .map((topic) => topic.name),
      publishing: topics
        .filter((topic) => this.topicHasNode(topic.name, node, "publisher"))
        .map((topic) => topic.name),
      services: services
        .filter((service) => this.serviceHasNode(service.name, node))
        .map((service) => service.name),
    };
  }

  async getTopicInfo(topic: string): Promise<TopicDetails> {
    this.ensureConnected();
    const type = this.resolveTopicType(topic) ?? "";
    const publishers = this.getTopicEndpointNodes(topic, "publisher");
    const subscribers = this.getTopicEndpointNodes(topic, "subscriber");
    const qosProfiles = [
      ...this.getTopicEndpointQos(topic, "publisher"),
      ...this.getTopicEndpointQos(topic, "subscriber"),
    ];
    return {
      name: topic,
      type,
      publishers,
      subscribers,
      publisherCount: publishers.length,
      subscriberCount: subscribers.length,
      qosAvailable: qosProfiles.length > 0,
      qosProfiles,
    };
  }

  async getServiceInfo(service: string): Promise<ServiceDetails> {
    this.ensureConnected();
    const providers = this.getNodeNames().filter((node) => this.serviceHasNode(service, node));
    return {
      name: service,
      type: this.resolveServiceType(service) ?? "",
      providers,
      providerCount: providers.length,
    };
  }

  async getActionInfo(action: string): Promise<ActionDetails> {
    const actions = await this.listActions();
    const match = actions.find((item) => item.name === action);
    return {
      name: action,
      type: match?.type ?? "",
      servers: match ? [match.name] : [],
    };
  }

  async getMessageSchema(type: string): Promise<MessageSchema> {
    throw new Error(
      `Message schema introspection for ${type} is not supported by LocalTransport yet`,
    );
  }

  async getServiceSchema(type: string): Promise<ServiceSchema> {
    throw new Error(
      `Service schema introspection for ${type} is not supported by LocalTransport yet`,
    );
  }

  async getActionSchema(type: string): Promise<ActionSchema> {
    throw new Error(
      `Action schema introspection for ${type} is not supported by LocalTransport yet`,
    );
  }

  // --- Private helpers ---

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const handler of this.connectionHandlers) {
      handler(status);
    }
  }

  private ensureConnected(): void {
    if (this.status !== "connected" || !this.node || !this.entityCache) {
      throw new Error("LocalTransport is not connected");
    }
  }

  /**
   * Resolve a topic's type from the node's graph introspection.
   * Returns undefined if the topic is not yet known.
   */
  private resolveTopicType(topic: string): string | undefined {
    if (!this.node) return undefined;
    const namesAndTypes: Array<{ name: string; types: string[] }> =
      this.node.getTopicNamesAndTypes();
    const entry = namesAndTypes.find((t) => t.name === topic);
    return entry?.types[0];
  }

  /**
   * Resolve a service's type from the node's graph introspection.
   * Returns undefined if the service is not yet known.
   */
  private resolveServiceType(service: string): string | undefined {
    if (!this.node) return undefined;
    const namesAndTypes: Array<{ name: string; types: string[] }> =
      this.node.getServiceNamesAndTypes();
    const entry = namesAndTypes.find((s) => s.name === service);
    return entry?.types[0];
  }

  private getNodeNames(): string[] {
    const getNodeNames = this.node?.getNodeNames;
    if (typeof getNodeNames === "function") {
      return getNodeNames.call(this.node) as string[];
    }

    const getNodeNamesAndNamespaces = this.node?.getNodeNamesAndNamespaces;
    if (typeof getNodeNamesAndNamespaces === "function") {
      const entries = getNodeNamesAndNamespaces.call(this.node) as Array<{
        name?: string;
        namespace?: string;
      }>;
      return entries.map((entry) => qualifyNodeName(entry.namespace, entry.name));
    }

    return [];
  }

  private topicHasNode(
    topic: string,
    node: string,
    endpointKind: "publisher" | "subscriber",
  ): boolean {
    return this.getTopicEndpointNodes(topic, endpointKind).includes(node);
  }

  private serviceHasNode(service: string, node: string): boolean {
    const getServiceServerInfo = this.node?.getServiceServerInfo;
    if (typeof getServiceServerInfo !== "function") {
      return false;
    }
    const endpoints = getServiceServerInfo.call(this.node, service) as Array<{
      nodeName?: string;
      nodeNamespace?: string;
    }>;
    return endpoints
      .map((endpoint) => qualifyNodeName(endpoint.nodeNamespace, endpoint.nodeName))
      .includes(node);
  }

  private getTopicEndpointNodes(
    topic: string,
    endpointKind: "publisher" | "subscriber",
  ): string[] {
    const methodName =
      endpointKind === "publisher" ? "getPublishersInfoByTopic" : "getSubscriptionsInfoByTopic";
    const method = this.node?.[methodName];
    if (typeof method !== "function") {
      return [];
    }
    const endpoints = method.call(this.node, topic) as Array<{
      nodeName?: string;
      nodeNamespace?: string;
    }>;
    return Array.from(
      new Set(
        endpoints.map((endpoint) => qualifyNodeName(endpoint.nodeNamespace, endpoint.nodeName)),
      ),
    );
  }

  private getTopicEndpointQos(
    topic: string,
    endpointKind: "publisher" | "subscriber",
  ): unknown[] {
    const methodName =
      endpointKind === "publisher" ? "getPublishersInfoByTopic" : "getSubscriptionsInfoByTopic";
    const method = this.node?.[methodName];
    if (typeof method !== "function") {
      return [];
    }
    const endpoints = method.call(this.node, topic) as Array<{ qosProfile?: unknown }>;
    return endpoints
      .map((endpoint) => endpoint.qosProfile)
      .filter((qosProfile): qosProfile is unknown => qosProfile !== undefined);
  }

  /**
   * Wrap rclnodejs callback-based sendRequest in a Promise with timeout.
   */
  private sendServiceRequest(client: any, request: any, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Service call timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        client.sendRequest(request, (response: any) => {
          clearTimeout(timer);
          if (response) {
            resolve(response);
          } else {
            reject(new Error("Service returned no response"));
          }
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }
}

function qualifyNodeName(namespace: string | undefined, name: string | undefined): string {
  const safeName = name ?? "";
  const safeNamespace = namespace && namespace !== "/" ? namespace : "";
  return `${safeNamespace}/${safeName}`.replace(/\/+/g, "/");
}
