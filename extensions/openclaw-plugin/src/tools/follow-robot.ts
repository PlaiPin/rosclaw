/**
 * Follow Me tool — native OpenClaw + RosClaw implementation.
 * Uses camera (ROS2) + Qwen VLM (Ollama) + cmd_vel (ROS2). No external apps.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { getTransport } from "../service.js";
import {
  startFollowMeLoop,
  stopFollowMeLoop,
  isFollowMeRunning,
  getFollowMeCmdVelTopic,
  getLastFollowMeState,
} from "../follow-me/loop.js";

export function registerFollowRobotTool(
  api: OpenClawPluginApi,
  config: RosClawConfig,
): void {
  api.registerTool({
    name: "follow_robot",
    label: "Follow Me",
    description:
      "Start or stop the native Follow Me mission. By default uses depth only (no Ollama)—robot follows based on depth vs target distance. Optional: set followMe.useOllama to use Qwen for person detection and left/right steering. " +
      "Use when the user says 'follow me', 'start following', 'stop following'. Actions: start, stop, status.",

    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("start"),
          Type.Literal("stop"),
          Type.Literal("status"),
        ],
        { description: "Action: start, stop, status" },
      ),
    }),

    async execute(_toolCallId, params) {
      const action = params["action"] as "start" | "stop" | "status";

      if (action === "status") {
        const running = isFollowMeRunning();
        const cmdVelTopic = getFollowMeCmdVelTopic(config);
        const state = getLastFollowMeState();
        let message = running
          ? `Follow Me is active; publishing to ${cmdVelTopic}.`
          : "Follow Me is stopped.";
        const useOllama = config.followMe?.useOllama ?? false;
        const visionCallbackUrl = (config.followMe?.visionCallbackUrl ?? "").trim();
        const vlmModel = config.followMe?.vlmModel ?? "qwen3-vl:2b";
        if (running) {
          if (visionCallbackUrl) message += ` Vision: callback (e.g. OpenAI).`;
          else if (useOllama) message += ` Vision: Ollama ${vlmModel}.`;
          else message += ` Vision: depth only.`;
        }
        if (running && state.last_error) {
          message += ` Last tick failed: ${state.last_error}. If the user sees only zero twist, the loop is failing every tick—check camera topic, Ollama (reachable? model loaded?), and depth topic.`;
        } else if (running && state.last_twist && state.tick_count > 0) {
          message += ` Latest twist: linear_x=${state.last_twist.linear_x}, angular_z=${state.last_twist.angular_z} (tick ${state.tick_count}).`;
        }
        const payload: Record<string, unknown> = {
          success: true,
          running,
          cmd_vel_topic: cmdVelTopic,
          vision: useOllama ? `Ollama ${vlmModel}` : "depth only",
          message,
        };
        if (running) {
          payload.last_detection = state.last_detection;
          payload.last_twist = state.last_twist;
          payload.last_error = state.last_error;
          payload.tick_count = state.tick_count;
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          details: { success: true, running, cmd_vel_topic: cmdVelTopic, ...(running ? state : {}) },
        };
      }

      if (action === "stop") {
        try {
          const transport = getTransport();
          stopFollowMeLoop(transport, config);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  message: "Follow Me stopped. Robot halted.",
                }),
              },
            ],
            details: { success: true },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
            details: { success: false, error: message },
          };
        }
      }

      if (action === "start") {
        try {
          const transport = getTransport();
          const cmdVelTopic = startFollowMeLoop(transport, config, api.logger);
          const useOllama = config.followMe?.useOllama ?? false;
          const visionCallbackUrl = (config.followMe?.visionCallbackUrl ?? "").trim();
          const vlmModel = config.followMe?.vlmModel ?? "qwen3-vl:2b";
          const visionLabel = visionCallbackUrl ? "vision callback (e.g. OpenAI)" : useOllama ? `Ollama ${vlmModel}` : "depth only";
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  cmd_vel_topic: cmdVelTopic,
                  vision: visionLabel,
                  message: `Follow Me started (${visionLabel}). Publishing Twist to ${cmdVelTopic}. Say 'stop following' to stop.`,
                }),
              },
            ],
            details: { success: true, cmd_vel_topic: cmdVelTopic, vision: visionLabel },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
            details: { success: false, error: message },
          };
        }
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: `Unknown action: ${action}` }) }],
        details: { success: false },
      };
    },
  });
}
