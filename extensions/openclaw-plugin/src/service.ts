import { RosbridgeClient } from "@rosclaw/rosbridge-client";
import type { OpenClawPluginAPI } from "../index.js";

/** Shared rosbridge client instance for all tools. */
let rosbridgeClient: RosbridgeClient | null = null;

/** Get the active rosbridge client. Throws if not connected. */
export function getRosbridgeClient(): RosbridgeClient {
  if (!rosbridgeClient) {
    throw new Error("Rosbridge client not initialized. Is the service running?");
  }
  return rosbridgeClient;
}

/**
 * Register the rosbridge WebSocket connection as an OpenClaw managed service.
 * The service handles connection lifecycle (connect on start, disconnect on stop).
 */
export function registerService(api: OpenClawPluginAPI): void {
  // TODO: Implement service registration
  // - Read rosbridge URL from plugin config
  // - Create RosbridgeClient instance
  // - Register with api.registerService() for lifecycle management
  // - Handle connection status changes and log them

  const rosbridgeUrl = api.getConfig<string>("rosbridge.url") ?? "ws://localhost:9090";

  api.registerService({
    name: "rosbridge",
    description: "Rosbridge WebSocket connection to ROS2",

    async start() {
      api.log.info(`Connecting to rosbridge at ${rosbridgeUrl}...`);
      rosbridgeClient = new RosbridgeClient({ url: rosbridgeUrl });

      rosbridgeClient.onConnection((status) => {
        api.log.info(`Rosbridge connection status: ${status}`);
      });

      await rosbridgeClient.connect();
      api.log.info("Rosbridge connected");
    },

    async stop() {
      if (rosbridgeClient) {
        await rosbridgeClient.disconnect();
        rosbridgeClient = null;
        api.log.info("Rosbridge disconnected");
      }
    },
  });
}
