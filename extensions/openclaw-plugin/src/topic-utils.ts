import type { RosClawConfig } from "./config.js";

/**
 * Normalize a ROS 2 topic name to a canonical form (leading slash, no trailing slash).
 */
function normalizeTopic(topic: string): string {
  const t = topic.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return t ? `/${t}` : "/";
}

/**
 * Return true if the topic is "root-level" (single segment, e.g. cmd_vel, battery_state).
 */
function isRootLevelTopic(normalized: string): boolean {
  const withoutLeading = normalized.replace(/^\/+/, "");
  return withoutLeading.length > 0 && !withoutLeading.includes("/");
}

/**
 * Apply robot namespace to a topic (or service/action name) when configured.
 * If config.robot.namespace is set and the name is root-level (e.g. cmd_vel, battery_state),
 * returns /<namespace>/<name>. Otherwise returns the normalized name as-is.
 *
 * Example: namespace "robot-uuid", topic "/cmd_vel" -> "/robot-uuid/cmd_vel"
 * Example: namespace "", topic "/cmd_vel" -> "/cmd_vel"
 * Example: namespace "robot-uuid", topic "/robot-uuid/odom" -> "/robot-uuid/odom" (unchanged)
 */
export function toNamespacedTopic(config: RosClawConfig, topic: string): string {
  const normalized = normalizeTopic(topic);
  const ns = (config.robot?.namespace ?? "").trim();
  if (!ns) return normalized;
  if (!isRootLevelTopic(normalized)) return normalized;
  const segment = normalized.replace(/^\/+/, "");
  return `/${ns}/${segment}`;
}
