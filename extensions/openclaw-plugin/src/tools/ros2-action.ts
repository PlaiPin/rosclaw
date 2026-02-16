import type { OpenClawPluginAPI } from "../../index.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_action_goal tool with the AI agent.
 * Phase 2 — sends action goals with progress feedback streaming.
 */
export function registerActionTool(api: OpenClawPluginAPI): void {
  // TODO: Phase 2 — Implement action goal tool
  // - Stream feedback back to the chat
  // - Support cancellation
  api.registerTool({
    name: "ros2_action_goal",
    description:
      "Send a goal to a ROS2 action server and stream feedback. " +
      "Use this for long-running operations like navigation or arm movements.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "The ROS2 action server name (e.g., '/navigate_to_pose')",
        },
        actionType: {
          type: "string",
          description: "The ROS2 action type (e.g., 'nav2_msgs/action/NavigateToPose')",
        },
        goal: {
          type: "object",
          description: "The action goal parameters",
        },
      },
      required: ["action", "actionType", "goal"],
    },

    async execute(params: { action: string; actionType: string; goal: Record<string, unknown> }) {
      const transport = getTransport();
      const result = await transport.sendActionGoal({
        action: params.action,
        actionType: params.actionType,
        args: params.goal,
      });
      return {
        success: result.result,
        action: params.action,
        result: result.values,
      };
    },
  });
}
