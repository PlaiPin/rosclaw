import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { toNamespacedTopic } from "../topic-utils.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_subscribe_once tool with the AI agent.
 * Subscribes to a topic and returns the next message received.
 */
export function registerSubscribeTool(api: OpenClawPluginApi, config: RosClawConfig): void {
  api.registerTool({
    name: "ros2_subscribe_once",
    label: "ROS2 Subscribe Once",
    description:
      "Subscribe to a ROS2 topic and return the next message. Use this to read sensor data, " +
      "check robot state, or get the current value of a topic.",
    parameters: Type.Object({
      topic: Type.String({ description: "The ROS2 topic name (e.g., '/battery_state')" }),
      type: Type.Optional(Type.String({ description: "The ROS2 message type (e.g., 'sensor_msgs/msg/BatteryState')" })),
      timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 5000)" })),
    }),

    async execute(_toolCallId, params) {
      const rawTopic = params["topic"] as string;
      const topic = toNamespacedTopic(config, rawTopic);
      let msgType = params["type"] as string | undefined;
      const timeout = (params["timeout"] as number | undefined) ?? 5000;

      if (!msgType && /\/?(camera|image|color|depth)/i.test(rawTopic)) {
        msgType = rawTopic.includes("compressed") ? "sensor_msgs/msg/CompressedImage" : "sensor_msgs/msg/Image";
      }

      const transport = getTransport();

      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const subscription = transport.subscribe(
          { topic, type: msgType },
          (msg: Record<string, unknown>) => {
            clearTimeout(timer);
            subscription.unsubscribe();
            resolve({ success: true, topic, message: msg });
          },
        );
        const timer = setTimeout(() => {
          subscription.unsubscribe();
          reject(new Error(`Timeout waiting for message on ${topic}`));
        }, timeout);
      });

      // Avoid sending huge payloads (e.g. image/point cloud) as text — burns tokens and triggers rate limits
      const MAX_TEXT_CHARS = 8000;
      let text = JSON.stringify(result);
      if (text.length > MAX_TEXT_CHARS) {
        text =
          JSON.stringify({
            success: true,
            topic,
            message: "[truncated: message too large for model context]",
            originalSize: text.length,
          }) +
          "\n(Use ros2_camera_snapshot for image topics.)";
      }

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });
}
