import type { OpenClawPluginAPI } from "../../index.js";
import { getTransport } from "../service.js";

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
      // TODO: Option to also query rosclaw_discovery node's capability manifest
      const transport = getTransport();
      const topics = await transport.listTopics();
      return {
        success: true,
        topics,
      };
    },
  });
}
