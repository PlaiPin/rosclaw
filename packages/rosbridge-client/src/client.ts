import WebSocket from "ws";
import type {
  RosbridgeClientOptions,
  ConnectionStatus,
  RosbridgeMessage,
  MessageHandler,
  ConnectionHandler,
} from "./types.js";

/**
 * WebSocket client for the rosbridge protocol.
 * Handles connection lifecycle, reconnection, and message routing.
 */
export class RosbridgeClient {
  private ws: WebSocket | null = null;
  private options: Required<RosbridgeClientOptions>;
  private status: ConnectionStatus = "disconnected";
  private messageHandlers = new Map<string, Set<MessageHandler>>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idCounter = 0;

  constructor(options: RosbridgeClientOptions) {
    this.options = {
      url: options.url,
      reconnect: options.reconnect ?? true,
      reconnectInterval: options.reconnectInterval ?? 3000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
    };
  }

  /** Connect to the rosbridge WebSocket server. */
  async connect(): Promise<void> {
    // TODO: Implement WebSocket connection
    // - Create WebSocket connection to this.options.url
    // - Set up message routing (onmessage → parse JSON → route to handlers)
    // - Set up reconnection logic (onclose → attempt reconnect if enabled)
    // - Update connection status and notify handlers
    // - Return promise that resolves on open, rejects on error
    this.setStatus("connecting");
    return Promise.resolve();
  }

  /** Disconnect from the rosbridge server. */
  async disconnect(): Promise<void> {
    // TODO: Implement graceful disconnect
    // - Clear reconnect timer
    // - Close WebSocket connection
    // - Update status to disconnected
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  /** Send a rosbridge protocol message. */
  send(message: RosbridgeMessage & Record<string, unknown>): void {
    // TODO: Implement message sending
    // - Verify connection is open
    // - Serialize message to JSON
    // - Send via WebSocket
    if (!this.ws || this.status !== "connected") {
      throw new Error("Not connected to rosbridge server");
    }
    this.ws.send(JSON.stringify(message));
  }

  /** Generate a unique message ID. */
  nextId(prefix = "rosclaw"): string {
    return `${prefix}_${++this.idCounter}`;
  }

  /** Subscribe to messages on a specific topic. */
  onMessage(topic: string, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(topic)) {
      this.messageHandlers.set(topic, new Set());
    }
    this.messageHandlers.get(topic)!.add(handler);
    return () => {
      this.messageHandlers.get(topic)?.delete(handler);
    };
  }

  /** Register a connection status change handler. */
  onConnection(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }

  /** Get current connection status. */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const handler of this.connectionHandlers) {
      handler(status);
    }
  }

  // TODO: Implement private reconnection logic
  // private attemptReconnect(): void { ... }

  // TODO: Implement private message routing
  // private handleMessage(data: string): void { ... }
}
