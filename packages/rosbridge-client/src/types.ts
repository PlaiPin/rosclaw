/**
 * Rosbridge WebSocket protocol types.
 * @see https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md
 */

// --- Connection ---

export interface RosbridgeClientOptions {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

// --- Core Protocol Messages ---

export interface RosbridgeMessage {
  op: string;
  id?: string;
}

// --- Publish / Subscribe ---

export interface PublishMessage extends RosbridgeMessage {
  op: "publish";
  topic: string;
  msg: Record<string, unknown>;
  type?: string;
}

export interface SubscribeMessage extends RosbridgeMessage {
  op: "subscribe";
  topic: string;
  type?: string;
  throttle_rate?: number;
  queue_length?: number;
  fragment_size?: number;
  compression?: string;
}

export interface UnsubscribeMessage extends RosbridgeMessage {
  op: "unsubscribe";
  topic: string;
}

export interface TopicMessage extends RosbridgeMessage {
  op: "publish";
  topic: string;
  msg: Record<string, unknown>;
}

// --- Service Call / Response ---

export interface ServiceCallMessage extends RosbridgeMessage {
  op: "call_service";
  service: string;
  args?: Record<string, unknown>;
  type?: string;
}

export interface ServiceResponseMessage extends RosbridgeMessage {
  op: "service_response";
  service: string;
  values?: Record<string, unknown>;
  result: boolean;
}

// --- Action Goal / Feedback / Result ---

export interface ActionGoalMessage extends RosbridgeMessage {
  op: "send_action_goal";
  action: string;
  action_type: string;
  args?: Record<string, unknown>;
}

export interface ActionFeedbackMessage extends RosbridgeMessage {
  op: "action_feedback";
  action: string;
  values: Record<string, unknown>;
}

export interface ActionResultMessage extends RosbridgeMessage {
  op: "action_result";
  action: string;
  values?: Record<string, unknown>;
  result: boolean;
}

export interface ActionCancelMessage extends RosbridgeMessage {
  op: "cancel_action_goal";
  action: string;
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

// --- Event Handlers ---

export type MessageHandler = (msg: Record<string, unknown>) => void;

export type ConnectionHandler = (status: ConnectionStatus) => void;
