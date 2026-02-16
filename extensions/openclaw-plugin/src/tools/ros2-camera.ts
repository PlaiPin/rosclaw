import type { OpenClawPluginAPI } from "../../index.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_camera_snapshot tool with the AI agent.
 * Grabs a single frame from a camera topic.
 */
export function registerCameraTool(api: OpenClawPluginAPI): void {
  api.registerTool({
    name: "ros2_camera_snapshot",
    description:
      "Capture a single image from a ROS2 camera topic. Returns the image as base64-encoded data. " +
      "Use this when the user asks what the robot sees or requests a photo.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The camera image topic (default: '/camera/image_raw/compressed')",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 10000)",
        },
      },
    },

    async execute(params: { topic?: string; timeout?: number }) {
      // TODO: Implement camera snapshot
      // - Subscribe to the compressed image topic
      // - Grab the first frame
      // - Convert to base64 for inline display
      // - Return as media attachment
      const transport = getTransport();
      const topic = params.topic ?? "/camera/image_raw/compressed";
      const timeout = params.timeout ?? 10000;

      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const subscription = transport.subscribe(
          { topic, type: "sensor_msgs/msg/CompressedImage" },
          (msg) => {
            clearTimeout(timer);
            subscription.unsubscribe();
            // TODO: Extract base64 image data from msg.data
            // TODO: Return as media attachment via OpenClaw API
            resolve({
              success: true,
              topic,
              format: msg["format"] ?? "jpeg",
              data: msg["data"] ?? "",
            });
          },
        );
        const timer = setTimeout(() => {
          subscription.unsubscribe();
          reject(new Error(`Timeout waiting for camera frame on ${topic}`));
        }, timeout);
      });
    },
  });
}
