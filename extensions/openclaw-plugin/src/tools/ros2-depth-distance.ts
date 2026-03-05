/**
 * Tool to read distance (meters) from a ROS2 depth image topic (e.g. RealSense).
 * Use when the user asks "how far am I" or "distance to the robot" / "distance from the robot".
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { toNamespacedTopic } from "../topic-utils.js";
import { getTransport } from "../service.js";
import { getDepthDistance } from "../depth.js";
import { REALSENSE_CAMERA_TOPICS } from "./ros2-camera.js";

const DEFAULT_DEPTH_TOPIC = REALSENSE_CAMERA_TOPICS.depth_raw;

export function registerDepthDistanceTool(api: OpenClawPluginApi, config: RosClawConfig): void {
  api.registerTool({
    name: "ros2_depth_distance",
    label: "ROS2 depth distance",
    description:
      "Get distance in meters from the robot's depth camera (e.g. RealSense). " +
      "Samples the center of the depth image and returns the median distance. " +
      "Use when the user asks how far they are from the robot, or distance to/from the robot.",

    parameters: Type.Object({
      topic: Type.Optional(
        Type.String({
          description: `Depth image topic (sensor_msgs/Image, 16UC1 or 32FC1). Default: ${DEFAULT_DEPTH_TOPIC}.`,
        }),
      ),
      timeout: Type.Optional(Type.Number({ description: "Timeout in ms (default 5000)" })),
    }),

    async execute(_toolCallId, params) {
      const rawTopic = (params["topic"] as string | undefined)?.trim() || DEFAULT_DEPTH_TOPIC;
      const topic = toNamespacedTopic(config, rawTopic);
      const timeout = (params["timeout"] as number | undefined) ?? 5000;

      try {
        const transport = getTransport();
        const result = await getDepthDistance(transport, topic, timeout);
        const text = result.valid
          ? `Distance at center of depth image: **${result.distance_m} m** (range in sample: ${result.min_m}–${result.max_m} m, ${result.sample_count} pixels). Topic: ${result.topic}.`
          : `No valid depth in center region (topic: ${result.topic}, ${result.width}×${result.height}, encoding ${result.encoding}). The scene may be out of range or obscured.`;
        return {
          content: [{ type: "text" as const, text }],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Depth distance failed: ${message}` }],
          details: { success: false, error: message, topic },
        };
      }
    },
  });
}
