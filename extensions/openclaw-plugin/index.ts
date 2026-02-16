import { registerService } from "./src/service.js";
import { registerTools } from "./src/tools/index.js";
import { registerSafetyHook } from "./src/safety/validator.js";
import { registerRobotContext } from "./src/context/robot-context.js";
import { registerEstopCommand } from "./src/commands/estop.js";

/**
 * OpenClaw plugin API interface (simplified for typing).
 * The real API is provided by OpenClaw at runtime.
 */
export interface OpenClawPluginAPI {
  registerTool(definition: Record<string, unknown>): void;
  registerService(definition: Record<string, unknown>): void;
  registerCommand(definition: Record<string, unknown>): void;
  on(event: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): void;
  getConfig<T = unknown>(key: string): T;
  log: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };
}

/**
 * Plugin entry point — called by OpenClaw when the extension is loaded.
 */
export function register(api: OpenClawPluginAPI): void {
  api.log.info("RosClaw plugin loading...");

  // Register the rosbridge WebSocket connection as a managed service
  registerService(api);

  // Register all ROS2 tools with the AI agent
  registerTools(api);

  // Register safety validation hook (before_tool_call)
  registerSafetyHook(api);

  // Register robot capability injection (before_agent_start)
  registerRobotContext(api);

  // Register direct commands (bypass AI)
  registerEstopCommand(api);

  api.log.info("RosClaw plugin loaded successfully");
}
