import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { getTransport } from "../service.js";
import { getFollowMeCmdVelTopic } from "../follow-me/loop.js";

const TWIST_TYPE = "geometry_msgs/msg/Twist";
const ZERO_TWIST = {
  linear: { x: 0, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0 },
};

/**
 * Register the /estop command.
 * This command bypasses the AI agent and immediately sends a zero-velocity
 * command to stop the robot. Uses the same cmd_vel topic as Follow Me so
 * estop reliably stops the base when Follow Me (or other missions) use a
 * custom topic.
 */
export function registerEstopCommand(api: OpenClawPluginApi, config: RosClawConfig): void {
  api.registerCommand({
    name: "estop",
    description: "Emergency stop — immediately halt the robot (bypasses AI)",

    async handler(_ctx) {
      try {
        const transport = getTransport();
        const topic = getFollowMeCmdVelTopic(config);

        // Send zero repeatedly so the base reliably stops
        for (let i = 0; i < 5; i++) {
          transport.publish({ topic, type: TWIST_TYPE, msg: ZERO_TWIST });
        }

        api.logger.warn("ESTOP: Zero velocity command sent");
        return { text: "Emergency stop activated. Robot halted." };
      } catch (error) {
        api.logger.error(`ESTOP FAILED: ${String(error)}`);
        return { text: "Emergency stop failed — transport may be disconnected!" };
      }
    },
  });
}
