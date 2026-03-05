import type { OpenClawPluginApi } from "./plugin-api.js";
import { parseConfig } from "./config.js";
import { registerService } from "./service.js";
import { registerTools } from "./tools/index.js";
import { registerSafetyHook } from "./safety/validator.js";
import { registerRobotContext } from "./context/robot-context.js";
import { registerEstopCommand } from "./commands/estop.js";
import { registerTransportCommand } from "./commands/transport.js";
import { registerRoutes } from "./routes.js";
import { isCdrTypeSupported } from "./transport/zenoh/cdr.js";

/**
 * RosClaw — OpenClaw plugin for ROS2 robot control via natural language.
 */
export default {
  id: "rosclaw",
  name: "RosClaw",

  register(api: OpenClawPluginApi): void {
    api.logger.info("RosClaw plugin loading...");
    const imageSupported = isCdrTypeSupported("sensor_msgs/msg/CompressedImage");
    api.logger.info(`RosClaw: Zenoh CDR Image/CompressedImage supported=${imageSupported}`);

    const config = parseConfig(api.pluginConfig ?? {});

    // Register the rosbridge WebSocket connection as a managed service
    registerService(api, config);

    // Register all ROS2 tools and mission tools with the AI agent
    registerTools(api, config);

    // Register safety validation hook (before_tool_call)
    registerSafetyHook(api, config);

    // Register robot capability injection (before_agent_start)
    registerRobotContext(api, config);

    // Register direct commands (bypass AI)
    registerEstopCommand(api, config);
    registerTransportCommand(api, config);

    if (typeof api.registerHttpRoute === "function") {
      registerRoutes(api, config);
    }

    api.logger.info("RosClaw plugin loaded successfully");
  },
};
