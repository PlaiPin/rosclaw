import type { TransportConfig } from "./transport/types.js";
import type { RosTransport } from "./transport/transport.js";
import { createTransport } from "./transport/factory.js";
import type { OpenClawPluginApi } from "./plugin-api.js";
import type { PluginLogger } from "./plugin-api.js";
import type { RosClawConfig } from "./config.js";

/** Shared transport instance for all tools. */
let transport: RosTransport | null = null;

/** Tracks the active transport mode. */
let currentMode: TransportConfig["mode"] | null = null;

/** Concurrency guard — prevents overlapping switchTransport calls. */
let switching = false;

/** Get the active transport. Throws if not connected. */
export function getTransport(): RosTransport {
  if (!transport) {
    throw new Error("Transport not initialized. Is the service running?");
  }
  return transport;
}

/** Get the current transport mode, or null if no transport is active. */
export function getTransportMode(): TransportConfig["mode"] | null {
  return currentMode;
}

/**
 * Switch the active transport at runtime.
 * Disconnects the old transport, creates a new one, and connects it.
 * No rollback on failure — the user retries with `/transport`.
 */
export async function switchTransport(config: TransportConfig, logger: PluginLogger): Promise<void> {
  if (switching) {
    throw new Error("A transport switch is already in progress. Please wait.");
  }

  switching = true;
  try {
    // Disconnect old transport
    if (transport) {
      await transport.disconnect();
      transport = null;
      currentMode = null;
    }

    // Create and connect new transport
    const newTransport = await createTransport(config);

    newTransport.onConnection((status: string) => {
      logger.info(`ROS2 transport status: ${status}`);
    });

    await newTransport.connect();

    transport = newTransport;
    currentMode = config.mode;

    logger.info(`ROS2 transport switched to ${config.mode}`);
  } finally {
    switching = false;
  }
}

/**
 * Register the ROS2 transport connection as an OpenClaw managed service.
 * The service handles connection lifecycle (connect on start, disconnect on stop).
 */
export function registerService(api: OpenClawPluginApi, config: RosClawConfig): void {
  const mode = config.transport.mode;

  api.registerService({
    id: "ros2-transport",

    async start(_ctx) {
      let transportCfg: TransportConfig;

      switch (mode) {
        case "rosbridge":
          transportCfg = { mode: "rosbridge", rosbridge: config.rosbridge };
          break;
        case "local":
          transportCfg = { mode: "local", local: config.local };
          break;
        case "webrtc":
          transportCfg = { mode: "webrtc", webrtc: config.webrtc };
          break;
        case "zenoh":
          transportCfg = { mode: "zenoh", zenoh: config.zenoh };
          break;
      }

      api.logger.info(`Connecting to ROS2 via ${mode} transport...`);

      transport = await createTransport(transportCfg);

      transport.onConnection((status: string) => {
        api.logger.info(`ROS2 transport status: ${status}`);
      });

      await transport.connect();
      currentMode = mode;
      api.logger.info(`ROS2 transport connected (mode: ${mode})`);
    },

    async stop(_ctx) {
      if (transport) {
        await transport.disconnect();
        transport = null;
        currentMode = null;
        api.logger.info("ROS2 transport disconnected");
      }
    },
  });
}
