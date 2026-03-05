/**
 * Tool to run the same Follow Me VLM pipeline (Ollama + prompt) on one frame.
 * Use when the user asks what the Follow Me tracker sees, or why person_visible differs from "what do you see".
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { getTransport } from "../service.js";
import { runFollowMeDetectionOnce } from "../follow-me/loop.js";

export function registerFollowMeDetectionTool(
  api: OpenClawPluginApi,
  config: RosClawConfig,
): void {
  api.registerTool({
    name: "follow_me_see",
    label: "Follow Me tracker detection",
    description:
      "Run the same vision pipeline as Follow Me (Ollama + qwen3-vl:2b) on one camera frame and return person_visible, position, distance_hint. " +
      "Use when the user asks what the Follow Me tracker sees, or why Follow Me reports person_visible=false while 'what do you see' describes a person—those use different models (chat vision vs Ollama).",

    parameters: Type.Object({}),

    async execute() {
      try {
        const transport = getTransport();
        const result = await runFollowMeDetectionOnce(transport, config);
        const d = result.detection;
        let text = `Follow Me tracker (Ollama ${result.vlm_model}, topic ${result.camera_topic}): person_visible=${d.person_visible}`;
        if (d.person_visible) {
          text += `, position=${d.position ?? "unknown"}, distance_hint=${d.distance_hint ?? "unknown"}.`;
        } else {
          text += `. So the tracker would not command motion from the VLM this frame.`;
        }
        if (result.error) {
          text += ` Error: ${result.error}`;
        }
        text += ` Note: "What do you see" uses the chat's vision model; Follow Me uses this Ollama model—they can differ.`;
        return {
          content: [{ type: "text" as const, text }],
          details: { detection: result.detection, vlm_model: result.vlm_model, camera_topic: result.camera_topic, error: result.error },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Follow Me detection check failed: ${message}` }],
          details: { success: false, error: message },
        };
      }
    },
  });
}
