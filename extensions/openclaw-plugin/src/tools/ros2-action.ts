import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { toNamespacedTopic } from "../topic-utils.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_action_goal tool with the AI agent.
 * Sends action goals with progress feedback streaming.
 */
export function registerActionTool(api: OpenClawPluginApi, config: RosClawConfig): void {
  api.registerTool({
    name: "ros2_action_goal",
    label: "ROS2 Action Goal",
    description:
      "Send a goal to a ROS2 action server and stream feedback. " +
      "Use this for long-running operations like navigation or arm movements.",
    parameters: Type.Object({
      action: Type.String({ description: "The ROS2 action server name (e.g., '/navigate_to_pose')" }),
      actionType: Type.String({ description: "The ROS2 action type (e.g., 'nav2_msgs/action/NavigateToPose')" }),
      goal: Type.Record(Type.String(), Type.Unknown(), {
        description: "The action goal parameters",
      }),
    }),

    async execute(_toolCallId, params) {
      const rawAction = params["action"] as string;
      const action = toNamespacedTopic(config, rawAction);
      const actionType = params["actionType"] as string;
      const goal = params["goal"] as Record<string, unknown>;

      const transport = getTransport();
      const actionResult = await transport.sendActionGoal({
        action,
        actionType,
        args: goal,
      });

      const result = {
        success: actionResult.result,
        action,
        result: actionResult.values,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
