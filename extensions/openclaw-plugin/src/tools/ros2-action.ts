import type { OpenClawPluginAPI } from "../../index.js";

/**
 * Register the ros2_action_goal tool with the AI agent.
 * Phase 2 — sends action goals with progress feedback streaming.
 */
export function registerActionTool(api: OpenClawPluginAPI): void {
  // TODO: Phase 2 — Implement action goal tool
  // - Send action goals via ActionClient
  // - Stream feedback back to the chat
  // - Support cancellation
  api.registerTool({
    name: "ros2_action_goal",
    description:
      "Send a goal to a ROS2 action server and stream feedback. " +
      "Use this for long-running operations like navigation or arm movements. " +
      "(Phase 2 — not yet implemented)",
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

    async execute(_params: { action: string; actionType: string; goal: Record<string, unknown> }) {
      // TODO: Phase 2 implementation
      return {
        success: false,
        error: "ros2_action_goal is not yet implemented (Phase 2)",
      };
    },
  });
}
