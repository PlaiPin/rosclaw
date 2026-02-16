import type { OpenClawPluginAPI } from "../../index.js";
import { getRosbridgeClient } from "../service.js";
import { callService } from "@rosclaw/rosbridge-client";

/**
 * Register the ros2_list_topics tool with the AI agent.
 * Allows the agent to discover available ROS2 topics at runtime.
 */
export function registerIntrospectTool(api: OpenClawPluginAPI): void {
  api.registerTool({
    name: "ros2_list_topics",
    description:
      "List all available ROS2 topics and their message types. " +
      "Use this to discover what data the robot publishes and what commands it accepts.",
    parameters: {
      type: "object",
      properties: {},
    },

    async execute() {
      // TODO: Implement topic listing via rosbridge
      // Option A: Use rosbridge's built-in /rosapi/topics service
      // Option B: Query the rosclaw_discovery node's capability manifest
      const client = getRosbridgeClient();
      const response = await callService(
        client,
        "/rosapi/topics",
        {},
        "rosapi/srv/Topics",
      );
      return {
        success: response.result,
        topics: response.values,
      };
    },
  });
}
