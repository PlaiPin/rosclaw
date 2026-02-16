import type { OpenClawPluginAPI } from "../../index.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_publish tool with the AI agent.
 * Allows publishing messages to any ROS2 topic.
 */
export function registerPublishTool(api: OpenClawPluginAPI): void {
  api.registerTool({
    name: "ros2_publish",
    description:
      "Publish a message to a ROS2 topic. Use this to send commands to the robot " +
      "(e.g., velocity commands to /cmd_vel, navigation goals, etc.).",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The ROS2 topic name (e.g., '/cmd_vel')",
        },
        type: {
          type: "string",
          description: "The ROS2 message type (e.g., 'geometry_msgs/msg/Twist')",
        },
        message: {
          type: "object",
          description: "The message payload matching the ROS2 message type schema",
        },
      },
      required: ["topic", "type", "message"],
    },

    async execute(params: { topic: string; type: string; message: Record<string, unknown> }) {
      // TODO: Implement full publish logic with error handling
      const transport = getTransport();
      transport.publish({ topic: params.topic, type: params.type, msg: params.message });
      return { success: true, topic: params.topic, type: params.type };
    },
  });
}
