import { TopicSubscriber } from "@rosclaw/rosbridge-client";
import type { OpenClawPluginAPI } from "../../index.js";
import { getRosbridgeClient } from "../service.js";

/**
 * Register the ros2_subscribe_once tool with the AI agent.
 * Subscribes to a topic and returns the next message received.
 */
export function registerSubscribeTool(api: OpenClawPluginAPI): void {
  api.registerTool({
    name: "ros2_subscribe_once",
    description:
      "Subscribe to a ROS2 topic and return the next message. Use this to read sensor data, " +
      "check robot state, or get the current value of a topic.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The ROS2 topic name (e.g., '/battery_state')",
        },
        type: {
          type: "string",
          description: "The ROS2 message type (e.g., 'sensor_msgs/msg/BatteryState')",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 5000)",
        },
      },
      required: ["topic"],
    },

    async execute(params: { topic: string; type?: string; timeout?: number }) {
      // TODO: Implement subscribe-once with timeout
      // - Create subscriber
      // - Wait for first message or timeout
      // - Unsubscribe and return the message
      const client = getRosbridgeClient();
      const timeout = params.timeout ?? 5000;

      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const subscriber = new TopicSubscriber(client, params.topic, params.type);
        const timer = setTimeout(() => {
          subscriber.unsubscribe();
          reject(new Error(`Timeout waiting for message on ${params.topic}`));
        }, timeout);

        subscriber.subscribe((msg) => {
          clearTimeout(timer);
          subscriber.unsubscribe();
          resolve({ success: true, topic: params.topic, message: msg });
        });
      });
    },
  });
}
