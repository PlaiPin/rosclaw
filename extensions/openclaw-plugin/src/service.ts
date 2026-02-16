import type { RosTransport, TransportConfig } from "@rosclaw/transport";
import { createTransport } from "@rosclaw/transport";
import type { OpenClawPluginAPI } from "../index.js";

/** Shared transport instance for all tools. */
let transport: RosTransport | null = null;

/** Get the active transport. Throws if not connected. */
export function getTransport(): RosTransport {
  if (!transport) {
    throw new Error("Transport not initialized. Is the service running?");
  }
  return transport;
}

/**
 * Register the ROS2 transport connection as an OpenClaw managed service.
 * The service handles connection lifecycle (connect on start, disconnect on stop).
 *
 * Reads `transport.mode` from plugin config to determine which adapter to use:
 * - "rosbridge" (default) — WebSocket to rosbridge_server (Mode B)
 * - "local" — direct DDS on same machine (Mode A)
 * - "webrtc" — WebRTC data channel via signaling server (Mode C)
 */
export function registerService(api: OpenClawPluginAPI): void {
  const mode = api.getConfig<string>("transport.mode") ?? "rosbridge";

  api.registerService({
    name: "ros2-transport",
    description: `ROS2 transport connection (mode: ${mode})`,

    async start() {
      const config = buildTransportConfig(api, mode);
      api.log.info(`Connecting to ROS2 via ${mode} transport...`);

      transport = await createTransport(config);

      transport.onConnection((status) => {
        api.log.info(`ROS2 transport status: ${status}`);
      });

      await transport.connect();
      api.log.info(`ROS2 transport connected (mode: ${mode})`);
    },

    async stop() {
      if (transport) {
        await transport.disconnect();
        transport = null;
        api.log.info("ROS2 transport disconnected");
      }
    },
  });
}

function buildTransportConfig(api: OpenClawPluginAPI, mode: string): TransportConfig {
  switch (mode) {
    case "rosbridge":
      return {
        mode: "rosbridge",
        rosbridge: {
          url: api.getConfig<string>("rosbridge.url") ?? "ws://localhost:9090",
          reconnect: api.getConfig<boolean>("rosbridge.reconnect") ?? true,
          reconnectInterval: api.getConfig<number>("rosbridge.reconnectInterval") ?? 3000,
        },
      };

    case "local":
      return {
        mode: "local",
        local: {
          domainId: api.getConfig<number>("local.domainId") ?? 0,
        },
      };

    case "webrtc":
      return {
        mode: "webrtc",
        webrtc: {
          signalingUrl: api.getConfig<string>("webrtc.signalingUrl") ?? "",
          apiUrl: api.getConfig<string>("webrtc.apiUrl") ?? "",
          robotId: api.getConfig<string>("webrtc.robotId") ?? "",
          robotKey: api.getConfig<string>("webrtc.robotKey") ?? "",
          iceServers: api.getConfig("webrtc.iceServers") ?? [
            { urls: "stun:stun.l.google.com:19302" },
          ],
        },
      };

    default:
      throw new Error(`Unknown transport mode: ${mode}`);
  }
}
