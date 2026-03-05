import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { toNamespacedTopic } from "../topic-utils.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_publish tool with the AI agent.
 * Allows publishing messages to any ROS2 topic.
 */
export function registerPublishTool(api: OpenClawPluginApi, config: RosClawConfig): void {
  api.registerTool({
    name: "ros2_publish",
    label: "ROS2 Publish",
    description:
      "Publish a message to a ROS2 topic. Use this to send commands to the robot " +
      "(e.g., velocity commands to /cmd_vel, navigation goals, etc.).",
    parameters: Type.Object({
      topic: Type.String({ description: "The ROS2 topic name (e.g., '/cmd_vel')" }),
      type: Type.String({ description: "The ROS2 message type (e.g., 'geometry_msgs/msg/Twist')" }),
      message: Type.Record(Type.String(), Type.Unknown(), {
        description: "The message payload matching the ROS2 message type schema",
      }),
    }),

    async execute(_toolCallId, params) {
      const rawTopic = params["topic"] as string;
      const topic = toNamespacedTopic(config, rawTopic);
      const type = params["type"] as string;
      const message = params["message"] as Record<string, unknown>;

      const transport = getTransport();
      transport.publish({ topic, type, msg: message });

      const ns = (config.robot?.namespace ?? "").trim();
      const namespaceApplied = ns && topic.startsWith(`/${ns}/`);
      let summary = namespaceApplied
        ? `Published to ${topic} (robot.namespace="${ns}" applied).`
        : `Published to ${topic}.`;
      if (!ns && (rawTopic === "/cmd_vel" || rawTopic.trim().replace(/^\/+/, "") === "cmd_vel")) {
        summary += " If the robot did not move, set robot.namespace in plugin config to the robot's cmd_vel prefix (e.g. robot3946b404c33e4aa39a8d16deb1c5c593), then restart the gateway.";
      }

      const result = { success: true, topic, type, summary };
      return {
        content: [{ type: "text", text: summary + "\n" + JSON.stringify({ success: true, topic, type }) }],
        details: result,
      };
    },
  });
}
