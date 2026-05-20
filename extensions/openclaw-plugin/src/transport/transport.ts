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
} from "./types.js";

/**
 * Unified transport interface for ROS2 communication.
 *
 * All deployment modes (local DDS, rosbridge WebSocket, WebRTC data channel)
 * implement this interface so that plugin tools work identically regardless
 * of the underlying transport.
 */
export interface RosTransport {
  // --- Connection lifecycle ---

  /** Establish the transport connection. */
  connect(): Promise<void>;

  /** Gracefully close the transport connection. */
  disconnect(): Promise<void>;

  /** Get current connection status. */
  getStatus(): ConnectionStatus;

  /** Register a connection status change handler. Returns a cleanup function. */
  onConnection(handler: ConnectionHandler): () => void;

  // --- Topics ---

  /** Publish a message to a ROS2 topic. */
  publish(options: PublishOptions): void;

  /** Subscribe to a ROS2 topic. Returns a Subscription handle. */
  subscribe(options: SubscribeOptions, handler: MessageHandler): Subscription;

  // --- Services ---

  /** Call a ROS2 service and return the result. */
  callService(options: ServiceCallOptions): Promise<ServiceCallResult>;

  // --- Actions ---

  /** Send a goal to a ROS2 action server. */
  sendActionGoal(options: ActionGoalOptions): Promise<ActionResult>;

  /** Cancel an in-progress action goal. */
  cancelActionGoal(action: string): Promise<void>;

  // --- Introspection ---

  /** List all available ROS2 topics. */
  listTopics(): Promise<TopicInfo[]>;

  /** List all available ROS2 services. */
  listServices(): Promise<ServiceInfo[]>;

  /** List all available ROS2 action servers. */
  listActions(): Promise<ActionInfo[]>;

  /** List all available ROS2 nodes. */
  listNodes(): Promise<NodeInfo[]>;

  /** Return a node's topic and service graph details. */
  getNodeInfo(node: string): Promise<NodeDetails>;

  /** Return topic type, publishers, subscribers, and QoS metadata when available. */
  getTopicInfo(topic: string): Promise<TopicDetails>;

  /** Return service type and provider nodes. */
  getServiceInfo(service: string): Promise<ServiceDetails>;

  /** Return action server type and provider nodes when available. */
  getActionInfo(action: string): Promise<ActionDetails>;

  /** Return message field schema for a ROS interface type. */
  getMessageSchema(type: string): Promise<MessageSchema>;

  /** Return request and response field schema for a ROS service type. */
  getServiceSchema(type: string): Promise<ServiceSchema>;

  /** Return goal, result, and feedback field schema for a ROS action type. */
  getActionSchema(type: string): Promise<ActionSchema>;
}
