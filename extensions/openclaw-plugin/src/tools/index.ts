import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { registerPublishTool } from "./ros2-publish.js";
import { registerSubscribeTool } from "./ros2-subscribe.js";
import { registerServiceTool } from "./ros2-service.js";
import { registerActionTool } from "./ros2-action.js";
import { registerParamTools } from "./ros2-param.js";
import { registerIntrospectTool } from "./ros2-introspect.js";
import { registerCameraTool } from "./ros2-camera.js";
import { registerDepthDistanceTool } from "./ros2-depth-distance.js";
import { registerFollowRobotTool } from "./follow-robot.js";
import { registerOllamaStatusTool } from "./ollama-status.js";
import { registerFollowMeDetectionTool } from "./follow-me-detection.js";

/**
 * Register all ROS2 tools and mission tools with the OpenClaw AI agent.
 */
export function registerTools(api: OpenClawPluginApi, config: RosClawConfig): void {
  registerPublishTool(api, config);
  registerSubscribeTool(api, config);
  registerServiceTool(api, config);
  registerActionTool(api, config);
  registerParamTools(api, config);
  registerIntrospectTool(api);
  registerCameraTool(api, config);
  registerDepthDistanceTool(api, config);
  registerOllamaStatusTool(api, config);
  registerFollowMeDetectionTool(api, config);
  registerFollowRobotTool(api, config);
}
