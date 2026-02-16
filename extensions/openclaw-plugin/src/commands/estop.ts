import { TopicPublisher } from "@rosclaw/rosbridge-client";
import type { OpenClawPluginAPI } from "../../index.js";
import { getRosbridgeClient } from "../service.js";

/**
 * Register the /estop command.
 * This command bypasses the AI agent and immediately sends a zero-velocity
 * command to stop the robot.
 */
export function registerEstopCommand(api: OpenClawPluginAPI): void {
  const namespace = api.getConfig<string>("robot.namespace") ?? "";

  api.registerCommand({
    name: "estop",
    description: "Emergency stop — immediately halt the robot (bypasses AI)",

    async execute() {
      // TODO: Implement comprehensive emergency stop
      // - Send zero velocity to cmd_vel
      // - Cancel all active action goals
      // - Optionally trigger hardware e-stop service if available

      try {
        const client = getRosbridgeClient();
        const topic = namespace ? `${namespace}/cmd_vel` : "/cmd_vel";
        const publisher = new TopicPublisher(client, topic, "geometry_msgs/msg/Twist");

        // Send zero velocity
        publisher.publish({
          linear: { x: 0, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: 0 },
        });

        api.log.warn("ESTOP: Zero velocity command sent");
        return { message: "Emergency stop activated. Robot halted." };
      } catch (error) {
        api.log.error("ESTOP FAILED:", String(error));
        return { message: "Emergency stop failed — rosbridge may be disconnected!" };
      }
    },
  });
}
