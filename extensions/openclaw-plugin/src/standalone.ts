import type { OpenClawPluginApi, PluginLogger, PluginService } from "./plugin-api.js";
import plugin from "./index.js";

const logger: PluginLogger = {
  info: (msg: string) => console.log(`[rosclaw] INFO  ${msg}`),
  warn: (msg: string) => console.warn(`[rosclaw] WARN  ${msg}`),
  error: (msg: string) => console.error(`[rosclaw] ERROR ${msg}`),
};

const services: PluginService[] = [];

const api: OpenClawPluginApi = {
  pluginConfig: {},

  logger,

  registerTool() {
    // no-op in standalone: tools require an AI agent
  },

  registerService(service: PluginService) {
    services.push(service);
  },

  registerCommand() {
    // no-op in standalone: commands require OpenClaw
  },

  on() {
    // no-op in standalone: hooks require an agent session
  },
};

// Read basic config from environment
const transportMode = process.env.ROSCLAW_TRANSPORT_MODE ?? "rosbridge";
const rosbridgeUrl = process.env.ROSCLAW_ROSBRIDGE_URL ?? "ws://localhost:9090";

api.pluginConfig = {
  transport: { mode: transportMode },
  rosbridge: { url: rosbridgeUrl, reconnect: true, reconnectInterval: 3000 },
  local: { domainId: 0 },
  webrtc: {
    signalingUrl: process.env.ROSCLAW_SIGNALING_URL ?? "",
    apiUrl: process.env.ROSCLAW_API_URL ?? "",
    robotId: process.env.ROSCLAW_ROBOT_ID ?? "",
    robotKey: process.env.ROSCLAW_ROBOT_KEY ?? "",
  },
  robot: { name: "Robot", namespace: "" },
  safety: {
    maxLinearVelocity: 1.0,
    maxAngularVelocity: 1.5,
    workspaceLimits: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
  },
};

plugin.register(api);

// Start all registered services
for (const svc of services) {
  svc.start({
    config: api.pluginConfig!,
    stateDir: "/tmp/rosclaw",
    logger,
  }).catch((err) => {
    logger.error(`Service ${svc.id} failed to start: ${String(err)}`);
  });
}

// Keep the process alive
process.on("SIGINT", async () => {
  logger.info("Shutting down...");
  for (const svc of services) {
    await svc.stop?.({ config: api.pluginConfig!, stateDir: "/tmp/rosclaw", logger });
    logger.info(`Service ${svc.id} stopped`);
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down...");
  for (const svc of services) {
    await svc.stop?.({ config: api.pluginConfig!, stateDir: "/tmp/rosclaw", logger });
  }
  process.exit(0);
});
