import type { OpenClawPluginAPI } from "../../index.js";

/**
 * Register the before_agent_start hook to inject robot capabilities
 * into the AI agent's system context.
 */
export function registerRobotContext(api: OpenClawPluginAPI): void {
  const robotName = api.getConfig<string>("robot.name") ?? "Robot";
  const robotNamespace = api.getConfig<string>("robot.namespace") ?? "";

  api.on("before_agent_start", async () => {
    // TODO: Implement dynamic capability discovery
    // Phase 1: Return hardcoded capabilities for the configured robot
    // Phase 2: Fetch live capabilities from rosclaw_discovery node

    const context = buildRobotContext(robotName, robotNamespace);
    return { systemMessage: context };
  });
}

/**
 * Build the robot context string that gets injected into the agent's system prompt.
 */
function buildRobotContext(name: string, namespace: string): string {
  // TODO: Replace with dynamic discovery from rosclaw_discovery node
  const prefix = namespace ? `${namespace}/` : "/";

  return `
## Robot: ${name}

You are connected to a ROS2 robot named "${name}". You can control it using the ros2_* tools.

### Available Topics
- \`${prefix}cmd_vel\` (geometry_msgs/msg/Twist) — Velocity commands
- \`${prefix}odom\` (nav_msgs/msg/Odometry) — Odometry data
- \`${prefix}scan\` (sensor_msgs/msg/LaserScan) — LIDAR scan
- \`${prefix}camera/image_raw/compressed\` (sensor_msgs/msg/CompressedImage) — Camera feed
- \`${prefix}battery_state\` (sensor_msgs/msg/BatteryState) — Battery status

### Safety Limits
- Maximum linear velocity: 1.0 m/s
- Maximum angular velocity: 1.5 rad/s
- All velocity commands are validated before execution

### Tips
- Use \`ros2_list_topics\` to discover all available topics
- Use \`ros2_subscribe_once\` to read the current value of any topic
- Use \`ros2_camera_snapshot\` to see what the robot sees
- The user can say /estop at any time to immediately stop the robot
`.trim();
}
