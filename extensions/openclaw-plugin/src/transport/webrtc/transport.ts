import { PeerConnection, DescriptionType, type DataChannel, type RtcConfig } from "node-datachannel";
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
  RTCIceServerConfig,
} from "../types.js";
import { SignalingClient } from "./signaling-client.js";
import type {
  SignalingMessage,
  OfferMessage,
  IceCandidateMessage,
  PeerJoinedMessage,
} from "./signaling-types.js";

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

/** Pending request for service calls and action goals over the data channel. */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Mode C transport: WebRTC data channel for cloud/remote deployments.
 *
 * The frontend (this class) acts as the answering peer:
 * 1. POST /api/robots/{robotId}/connect → get session_id, room_id
 * 2. Open signaling WebSocket → JOIN_ROOM
 * 3. Wait for robot's SDP offer
 * 4. Create RTCPeerConnection, set remote description, create answer
 * 5. Exchange ICE candidates
 * 6. Data channel opens → rosbridge JSON over WebRTC
 */
export class WebRTCTransport implements RosTransport {
  private options: WebRTCTransportOptions;
  private signaling: SignalingClient;
  private pc: PeerConnection | null = null;
  private dataChannel: DataChannel | null = null;
  private status: ConnectionStatus = "disconnected";
  private connectionHandlers = new Set<ConnectionHandler>();
  private topicHandlers = new Map<string, Set<MessageHandler>>();
  private pendingRequests = new Map<string, PendingRequest>();
  private idCounter = 0;
  private sessionId: string | null = null;
  private roomId: string | null = null;
  private peerId: string | null = null;
  private robotPeerId: string | null = null;

  constructor(options: WebRTCTransportOptions) {
    this.options = options;
    this.signaling = new SignalingClient(options.apiUrl, options.signalingUrl);
  }

  async connect(): Promise<void> {
    if (this.status === "connected") return;
    this.setStatus("connecting");

    try {
      // Step 1: Request connection via REST API
      const userId = `frontend_${Date.now()}`;
      const connectRes = await this.signaling.requestConnection(this.options.robotId, {
        user_id: userId,
        robot_id: this.options.robotId,
        robot_key: this.options.robotKey,
      });
      this.sessionId = connectRes.session.session_id;
      this.roomId = connectRes.room_id;
      this.peerId = userId;

      // Step 2: Connect signaling WebSocket
      await this.signaling.connectWs();

      // Step 3: Set up message handler before joining room
      const connected = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("WebRTC connection timed out (30s)"));
        }, 30_000);

        this.signaling.onMessage((msg: SignalingMessage) => {
          this.handleSignalingMessage(msg, resolve, reject, timeout);
        });
      });

      // Step 4: Join room
      this.signaling.joinRoom(this.roomId, userId, "frontend", this.sessionId);

      // Step 5: Wait for data channel to be established
      await connected;
      this.setStatus("connected");
    } catch (err) {
      this.setStatus("disconnected");
      this.cleanup();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.cleanup();

    // Notify signaling server
    if (this.sessionId) {
      try {
        await this.signaling.requestDisconnect(this.options.robotId);
      } catch {
        // Best-effort disconnect notification
      }
      this.sessionId = null;
    }

    this.signaling.close();
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

  publish(options: PublishOptions): void {
    this.sendOverDataChannel({
      op: "publish",
      topic: options.topic,
      type: options.type,
      msg: options.msg,
    });
  }

  subscribe(options: SubscribeOptions, handler: MessageHandler): Subscription {
    const topic = options.topic;

    if (!this.topicHandlers.has(topic)) {
      this.topicHandlers.set(topic, new Set());
    }
    this.topicHandlers.get(topic)!.add(handler);

    // Send rosbridge subscribe command
    this.sendOverDataChannel({
      op: "subscribe",
      id: this.nextId("sub"),
      topic,
      type: options.type,
      throttle_rate: options.throttleRate,
      queue_length: options.queueLength,
    });

    return {
      unsubscribe: () => {
        this.topicHandlers.get(topic)?.delete(handler);
        if (this.topicHandlers.get(topic)?.size === 0) {
          this.topicHandlers.delete(topic);
          try {
            this.sendOverDataChannel({ op: "unsubscribe", topic });
          } catch {
            // Already disconnected
          }
        }
      },
    };
  }

  async callService(options: ServiceCallOptions): Promise<ServiceCallResult> {
    const id = this.nextId("service");

    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.registerPending(id, (v) => resolve(v as Record<string, unknown>), reject, 30_000);

      this.sendOverDataChannel({
        op: "call_service",
        id,
        service: options.service,
        args: options.args,
        type: options.type,
      });
    });

    return {
      result: response.result as boolean,
      values: response.values as Record<string, unknown> | undefined,
    };
  }

  async sendActionGoal(options: ActionGoalOptions): Promise<ActionResult> {
    const id = this.nextId("action");

    // Register feedback handler if provided
    let feedbackKey: string | null = null;
    if (options.onFeedback) {
      feedbackKey = `__action_feedback__${id}`;
      if (!this.topicHandlers.has(feedbackKey)) {
        this.topicHandlers.set(feedbackKey, new Set());
      }
      this.topicHandlers.get(feedbackKey)!.add((msg) => {
        options.onFeedback!(msg.values as Record<string, unknown>);
      });
    }

    try {
      const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
        this.registerPending(id, (v) => resolve(v as Record<string, unknown>), reject, 120_000);

        this.sendOverDataChannel({
          op: "send_action_goal",
          id,
          action: options.action,
          action_type: options.actionType,
          args: options.args,
        });
      });

      return {
        result: response.result as boolean,
        values: response.values as Record<string, unknown> | undefined,
      };
    } finally {
      if (feedbackKey) {
        this.topicHandlers.delete(feedbackKey);
      }
    }
  }

  async cancelActionGoal(action: string): Promise<void> {
    this.sendOverDataChannel({
      op: "cancel_action_goal",
      id: this.nextId("cancel"),
      action,
    });
  }

  async listTopics(): Promise<TopicInfo[]> {
    const result = await this.callService({
      service: "/rosapi/topics",
      type: "rosapi_msgs/srv/Topics",
      args: {},
    });
    const topics = (result.values?.["topics"] as string[]) ?? [];
    const types = (result.values?.["types"] as string[]) ?? [];
    return topics.map((name, i) => ({ name, type: types[i] ?? "" }));
  }

  async listServices(): Promise<ServiceInfo[]> {
    const result = await this.callService({
      service: "/rosapi/services",
      type: "rosapi_msgs/srv/Services",
      args: {},
    });
    const services = (result.values?.["services"] as string[]) ?? [];
    return Promise.all(
      services.map(async (name) => ({ name, type: await this.getServiceType(name) })),
    );
  }

  async listActions(): Promise<ActionInfo[]> {
    // Same heuristic as RosbridgeTransport — extract from feedback topics
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
    const result = await this.callService({
      service: "/rosapi/nodes",
      type: "rosapi_msgs/srv/Nodes",
      args: {},
    });
    return stringArray(result.values?.["nodes"]).map((name) => ({ name }));
  }

  async getNodeInfo(node: string): Promise<NodeDetails> {
    const result = await this.callService({
      service: "/rosapi/node_details",
      type: "rosapi_msgs/srv/NodeDetails",
      args: { node },
    });
    return {
      name: node,
      subscribing: stringArray(result.values?.["subscribing"]),
      publishing: stringArray(result.values?.["publishing"]),
      services: stringArray(result.values?.["services"]),
    };
  }

  async getTopicInfo(topic: string): Promise<TopicDetails> {
    const [typeResult, publishersResult, subscribersResult] = await Promise.all([
      this.callService({
        service: "/rosapi/topic_type",
        type: "rosapi_msgs/srv/TopicType",
        args: { topic },
      }),
      this.callService({
        service: "/rosapi/publishers",
        type: "rosapi_msgs/srv/Publishers",
        args: { topic },
      }),
      this.callService({
        service: "/rosapi/subscribers",
        type: "rosapi_msgs/srv/Subscribers",
        args: { topic },
      }),
    ]);
    const publishers = stringArray(publishersResult.values?.["publishers"]);
    const subscribers = stringArray(subscribersResult.values?.["subscribers"]);
    return {
      name: topic,
      type: stringValue(typeResult.values?.["type"]),
      publishers,
      subscribers,
      publisherCount: publishers.length,
      subscriberCount: subscribers.length,
      qosAvailable: false,
      qosProfiles: [],
    };
  }

  async getServiceInfo(service: string): Promise<ServiceDetails> {
    const [type, nodeResult] = await Promise.all([
      this.getServiceType(service),
      this.callService({
        service: "/rosapi/service_node",
        type: "rosapi_msgs/srv/ServiceNode",
        args: { service },
      }),
    ]);
    const provider = stringValue(nodeResult.values?.["node"]);
    const providers = provider ? [provider] : [];
    return {
      name: service,
      type,
      providers,
      providerCount: providers.length,
    };
  }

  async getActionInfo(action: string): Promise<ActionDetails> {
    const result = await this.callService({
      service: "/rosapi/action_type",
      type: "rosapi_msgs/srv/ActionType",
      args: { action },
    });
    const type = stringValue(result.values?.["type"]);
    return {
      name: action,
      type,
      servers: type ? [action] : [],
    };
  }

  async getMessageSchema(type: string): Promise<MessageSchema> {
    const result = await this.callService({
      service: "/rosapi/message_details",
      type: "rosapi_msgs/srv/MessageDetails",
      args: { type },
    });
    return { type, typedefs: typeDefs(result.values?.["typedefs"]) };
  }

  async getServiceSchema(type: string): Promise<ServiceSchema> {
    const [requestResult, responseResult] = await Promise.all([
      this.callService({
        service: "/rosapi/service_request_details",
        type: "rosapi_msgs/srv/ServiceRequestDetails",
        args: { type },
      }),
      this.callService({
        service: "/rosapi/service_response_details",
        type: "rosapi_msgs/srv/ServiceResponseDetails",
        args: { type },
      }),
    ]);
    return {
      type,
      request: typeDefs(requestResult.values?.["typedefs"]),
      response: typeDefs(responseResult.values?.["typedefs"]),
    };
  }

  async getActionSchema(type: string): Promise<ActionSchema> {
    const [goalResult, resultResult, feedbackResult] = await Promise.all([
      this.callService({
        service: "/rosapi/action_goal_details",
        type: "rosapi_msgs/srv/ActionGoalDetails",
        args: { type },
      }),
      this.callService({
        service: "/rosapi/action_result_details",
        type: "rosapi_msgs/srv/ActionResultDetails",
        args: { type },
      }),
      this.callService({
        service: "/rosapi/action_feedback_details",
        type: "rosapi_msgs/srv/ActionFeedbackDetails",
        args: { type },
      }),
    ]);
    return {
      type,
      goal: typeDefs(goalResult.values?.["typedefs"]),
      result: typeDefs(resultResult.values?.["typedefs"]),
      feedback: typeDefs(feedbackResult.values?.["typedefs"]),
    };
  }

  // --- Private helpers ---

  private nextId(prefix = "rosclaw"): string {
    return `${prefix}_${++this.idCounter}`;
  }

  private async getServiceType(service: string): Promise<string> {
    const result = await this.callService({
      service: "/rosapi/service_type",
      type: "rosapi_msgs/srv/ServiceType",
      args: { service },
    });
    return stringValue(result.values?.["type"]);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const handler of this.connectionHandlers) {
      handler(status);
    }
  }

  private sendOverDataChannel(msg: Record<string, unknown>): void {
    if (!this.dataChannel) {
      throw new Error("Data channel is not open");
    }
    this.dataChannel.sendMessage(JSON.stringify(msg));
  }

  private registerPending(
    id: string,
    resolve: (value: unknown) => void,
    reject: (reason: Error) => void,
    timeoutMs: number,
  ): void {
    const timer = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    this.pendingRequests.set(id, { resolve, reject, timer });
  }

  private resolvePending(id: string, result: unknown): void {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.resolve(result);
    }
  }

  /** Handle incoming rosbridge JSON from the data channel. */
  private handleDataChannelMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    const op = msg.op as string | undefined;
    if (!op) return;

    switch (op) {
      case "publish": {
        const topic = msg.topic as string;
        const payload = msg.msg as Record<string, unknown>;
        const handlers = this.topicHandlers.get(topic);
        if (handlers) {
          for (const handler of handlers) {
            handler(payload);
          }
        }
        break;
      }

      case "service_response": {
        const id = msg.id as string | undefined;
        if (id) this.resolvePending(id, msg);
        break;
      }

      case "action_result": {
        const id = msg.id as string | undefined;
        if (id) this.resolvePending(id, msg);
        break;
      }

      case "action_feedback": {
        const id = msg.id as string | undefined;
        if (id) {
          const handlers = this.topicHandlers.get(`__action_feedback__${id}`);
          if (handlers) {
            for (const handler of handlers) {
              handler(msg);
            }
          }
        }
        break;
      }
    }
  }

  /** Handle signaling messages during connection setup. */
  private handleSignalingMessage(
    msg: SignalingMessage,
    onConnected: () => void,
    onError: (err: Error) => void,
    timeout: ReturnType<typeof setTimeout>,
  ): void {
    switch (msg.type) {
      case "peer_joined": {
        const peerMsg = msg as PeerJoinedMessage;
        if (peerMsg.peer_type === "robot") {
          this.robotPeerId = peerMsg.peer_id;
        }
        break;
      }

      case "offer": {
        const offerMsg = msg as OfferMessage;
        this.handleOffer(offerMsg, onConnected, onError, timeout);
        break;
      }

      case "ice_candidate": {
        const iceMsg = msg as IceCandidateMessage;
        if (this.pc) {
          this.pc.addRemoteCandidate(iceMsg.data.candidate, iceMsg.data.sdpMid ?? "0");
        }
        break;
      }

      case "error": {
        clearTimeout(timeout);
        onError(new Error(`Signaling error: ${(msg as unknown as { message: string }).message}`));
        break;
      }
    }
  }

  /** Handle SDP offer from the robot and create an answer. */
  private handleOffer(
    offer: OfferMessage,
    onConnected: () => void,
    onError: (err: Error) => void,
    timeout: ReturnType<typeof setTimeout>,
  ): void {
    // Build ICE server strings for node-datachannel
    const iceServers = this.options.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
    const iceServerStrs = iceServers.map((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls[0]; // node-datachannel takes individual server strings
    });

    const rtcConfig: RtcConfig = { iceServers: iceServerStrs };
    this.pc = new PeerConnection("rosclaw-frontend", rtcConfig);

    // Handle ICE candidates from our side → send to robot
    this.pc.onLocalCandidate((candidate, mid) => {
      this.signaling.sendIceCandidate(candidate, mid, null, this.robotPeerId ?? undefined);
    });

    // Handle state changes
    this.pc.onStateChange((state) => {
      if (state === "failed" || state === "closed") {
        this.setStatus("disconnected");
        this.rejectAllPending(new Error("Peer connection closed"));
      }
    });

    // Handle incoming data channel
    this.pc.onDataChannel((dc) => {
      this.dataChannel = dc;

      dc.onOpen(() => {
        clearTimeout(timeout);
        onConnected();
      });

      dc.onMessage((data: string | Buffer) => {
        const str = typeof data === "string" ? data : data.toString("utf-8");
        this.handleDataChannelMessage(str);
      });

      dc.onClosed(() => {
        this.dataChannel = null;
        this.setStatus("disconnected");
        this.rejectAllPending(new Error("Data channel closed"));
      });
    });

    // Set remote offer and create answer
    this.pc.setRemoteDescription(offer.data.sdp, DescriptionType.Offer);
    const answer = this.pc.localDescription();
    if (answer) {
      this.signaling.sendAnswer(answer.sdp, this.roomId!, this.peerId!, this.robotPeerId ?? undefined);
    } else {
      clearTimeout(timeout);
      onError(new Error("Failed to create SDP answer"));
    }
  }

  private cleanup(): void {
    this.rejectAllPending(new Error("Transport disconnected"));

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
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
