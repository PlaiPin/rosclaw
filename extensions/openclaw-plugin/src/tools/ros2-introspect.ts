import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_list_topics tool with the AI agent.
 * Allows the agent to discover available ROS2 topics at runtime.
 */
export function registerIntrospectTool(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "ros2_list_topics",
    label: "ROS2 List Topics",
    description:
      "List all available ROS2 topics and their message types. " +
      "Use this to discover what data the robot publishes and what commands it accepts.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params) {
      const transport = getTransport();
      const topics = await transport.listTopics();

      // Cap output size to avoid rate limits / token burn when robot has many topics
      const MAX_TOPICS_IN_RESPONSE = 50;
      const MAX_CHARS = 6000;
      const truncated =
        topics.length > MAX_TOPICS_IN_RESPONSE
          ? topics.slice(0, MAX_TOPICS_IN_RESPONSE)
          : topics;
      const result = {
        success: true,
        topics: truncated,
        total: topics.length,
        truncated: topics.length > MAX_TOPICS_IN_RESPONSE,
      };
      let text = JSON.stringify(result);
      if (text.length > MAX_CHARS) {
        const fewer = truncated.slice(0, 20);
        text = JSON.stringify({
          success: true,
          total: topics.length,
          message: `Topic list truncated to save tokens (${topics.length} total). Showing first 20.`,
          topics: fewer,
        });
      }

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });
}
