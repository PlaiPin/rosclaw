import type { RosbridgeClient } from "./client.js";
import type {
  ActionResultMessage,
  ActionFeedbackMessage,
  MessageHandler,
} from "./types.js";

export interface ActionGoalOptions {
  action: string;
  actionType: string;
  args?: Record<string, unknown>;
  onFeedback?: (feedback: ActionFeedbackMessage) => void;
}

/**
 * Client for sending action goals and receiving feedback/results.
 */
export class ActionClient {
  constructor(private client: RosbridgeClient) {}

  /**
   * Send an action goal and wait for the result.
   *
   * @param options - Action goal options including feedback handler
   * @returns The action result
   */
  async sendGoal(options: ActionGoalOptions): Promise<ActionResultMessage> {
    // TODO: Implement action goal sending
    // - Generate unique ID
    // - Register feedback handler if provided
    // - Send send_action_goal message
    // - Wait for action_result with matching ID
    // - Clean up feedback handler
    // - Return result (or throw on failure)
    const id = this.client.nextId("action");

    this.client.send({
      op: "send_action_goal",
      id,
      action: options.action,
      action_type: options.actionType,
      args: options.args,
    });

    // TODO: Replace with actual result listener
    return {
      op: "action_result",
      id,
      action: options.action,
      values: {},
      result: true,
    };
  }

  /**
   * Cancel an in-progress action goal.
   *
   * @param action - The action server name
   */
  async cancelGoal(action: string): Promise<void> {
    // TODO: Implement action cancel
    // - Send cancel_action_goal message
    this.client.send({
      op: "cancel_action_goal",
      id: this.client.nextId("cancel"),
      action,
    });
  }
}
