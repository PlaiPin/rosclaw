/**
 * Shared types for the RosClaw transport abstraction layer.
 */

// --- Connection ---

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type MessageHandler = (msg: Record<string, unknown>) => void;

export type ConnectionHandler = (status: ConnectionStatus) => void;

/** Returned by subscribe(); call unsubscribe() to stop receiving messages. */
export interface Subscription {
  unsubscribe(): void;
}

// --- Publish ---

export interface PublishOptions {
  topic: string;
  type: string;
  msg: Record<string, unknown>;
}

// --- Subscribe ---

export interface SubscribeOptions {
  topic: string;
  type?: string;
  throttleRate?: number;
  queueLength?: number;
}

// --- Service Call ---

export interface ServiceCallOptions {
  service: string;
  type?: string;
  args?: Record<string, unknown>;
}

export interface ServiceCallResult {
  result: boolean;
  values?: Record<string, unknown>;
}

// --- Action ---

export interface ActionGoalOptions {
  action: string;
  actionType: string;
  args?: Record<string, unknown>;
  onFeedback?: (feedback: Record<string, unknown>) => void;
}

export interface ActionResult {
  result: boolean;
  values?: Record<string, unknown>;
}

// --- Introspection ---

export interface TopicInfo {
  name: string;
  type: string;
}

export interface ServiceInfo {
  name: string;
  type: string;
}

export interface ActionInfo {
  name: string;
  type: string;
}

export interface NodeInfo {
  name: string;
}

export interface NodeDetails {
  name: string;
  subscribing: string[];
  publishing: string[];
  services: string[];
}

export interface TopicDetails {
  name: string;
  type: string;
  publishers: string[];
  subscribers: string[];
  publisherCount: number;
  subscriberCount: number;
  qosAvailable: boolean;
  qosProfiles: unknown[];
}

export interface ServiceDetails {
  name: string;
  type: string;
  providers: string[];
  providerCount: number;
}

export interface ActionDetails {
  name: string;
  type: string;
  servers: string[];
}

export interface RosTypeDef {
  type: string;
  fieldnames: string[];
  fieldtypes: string[];
  fieldarraylen: number[];
  examples: string[];
  constnames: string[];
  constvalues: string[];
}

export interface MessageSchema {
  type: string;
  typedefs: RosTypeDef[];
}

export interface ServiceSchema {
  type: string;
  request: RosTypeDef[];
  response: RosTypeDef[];
}

export interface ActionSchema {
  type: string;
  goal: RosTypeDef[];
  result: RosTypeDef[];
  feedback: RosTypeDef[];
}

// --- Transport Configuration ---

export interface RosbridgeTransportConfig {
  mode: "rosbridge";
  rosbridge: {
    url: string;
    reconnect?: boolean;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
  };
}

export interface LocalTransportConfig {
  mode: "local";
  local?: {
    domainId?: number;
  };
}

export interface WebRTCTransportConfig {
  mode: "webrtc";
  webrtc: {
    signalingUrl: string;
    apiUrl: string;
    robotId: string;
    robotKey: string;
    iceServers?: RTCIceServerConfig[];
  };
}

export interface RTCIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Discriminated union of all transport configurations. */
export type TransportConfig =
  | RosbridgeTransportConfig
  | LocalTransportConfig
  | WebRTCTransportConfig;
