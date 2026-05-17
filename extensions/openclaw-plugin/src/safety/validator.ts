import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";

type OperationKind = "topic" | "service" | "action" | "none";

interface RosOperation {
  kind: OperationKind;
  target?: string;
  write: boolean;
}

interface Point2D {
  x: number;
  y: number;
}

/**
 * Register the before_tool_call safety validation hook.
 * Intercepts ROS tool calls and applies safety policy checks before execution.
 */
export function registerSafetyHook(api: OpenClawPluginApi, config: RosClawConfig): void {
  const safety = config.safety;

  api.on("before_tool_call", async (event, _ctx) => {
    const violation = validateRosToolCall(event.toolName, event.params, safety);
    if (violation) {
      api.logger.warn(`Blocked ${event.toolName}: ${violation}`);
      return { block: true, blockReason: violation };
    }
  });
}

export function validateRosToolCall(
  toolName: string,
  params: Record<string, unknown>,
  safety: RosClawConfig["safety"],
): string | null {
  // Map each ROS tool call into a normalized operation so policy checks stay centralized.
  const operation = getRosOperation(toolName, params);
  if (!operation) {
    return null;
  }

  // Fail closed on any configured safety violation before the tool reaches ROS.
  const policyViolation = validateAccessPolicy(operation, safety);
  if (policyViolation) {
    return policyViolation;
  }

  return validateMotionSafety(toolName, params, safety);
}

function getRosOperation(
  toolName: string,
  params: Record<string, unknown>,
): RosOperation | null {
  switch (toolName) {
    case "ros2_publish":
      return {
        kind: "topic",
        target: stringParam(params, "topic"),
        write: true,
      };

    case "ros2_subscribe_once":
      return {
        kind: "topic",
        target: stringParam(params, "topic"),
        write: false,
      };

    case "ros2_camera_snapshot":
      return {
        kind: "topic",
        // Camera snapshot defaults to the common compressed image topic when none is passed in.
        target: stringParam(params, "topic") ?? "/camera/image_raw/compressed",
        write: false,
      };

    case "ros2_service_call":
      return {
        kind: "service",
        target: stringParam(params, "service"),
        write: true,
      };

    case "ros2_param_get": {
      const node = stringParam(params, "node");
      return {
        kind: "service",
        target: node ? `${node}/get_parameters` : undefined,
        write: false,
      };
    }

    case "ros2_param_set": {
      const node = stringParam(params, "node");
      return {
        kind: "service",
        target: node ? `${node}/set_parameters` : undefined,
        write: true,
      };
    }

    case "ros2_action_goal":
      return {
        kind: "action",
        target: stringParam(params, "action"),
        write: true,
      };

    case "ros2_cancel_action_goal":
      return {
        kind: "action",
        target: stringParam(params, "action"),
        write: true,
      };

    case "ros2_list_topics":
    case "ros2_list_services":
    case "ros2_list_actions":
    case "ros2_transport_status":
      return {
        kind: "none",
        write: false,
      };

    default:
      return null;
  }
}

function validateAccessPolicy(
  operation: RosOperation,
  safety: RosClawConfig["safety"],
): string | null {
  if (safety.readonlyMode && operation.write) {
    return "ROS write operations are blocked because readonlyMode is enabled";
  }

  if (operation.kind === "none") {
    return null;
  }

  if (!operation.target) {
    return `Missing ROS ${operation.kind} target`;
  }

  if (
    operation.kind === "topic" &&
    matchesAny(operation.target, safety.blockedTopics)
  ) {
    return `Topic ${operation.target} is blocked by safety policy`;
  }

  const allowed = getAllowedPatterns(operation.kind, safety);
  // Empty allowlists are intentionally permissive; they mean "allow everything" for that kind.
  if (allowed.length > 0 && !matchesAny(operation.target, allowed)) {
    return `${capitalize(operation.kind)} ${operation.target} is not in the allowed ${operation.kind} list`;
  }

  if (
    operation.write &&
    matchesPolicyTarget(
      operation.kind,
      operation.target,
      safety.requireConfirmationFor,
    )
  ) {
    return `${capitalize(operation.kind)} ${operation.target} requires explicit user confirmation before execution`;
  }

  return null;
}

function getAllowedPatterns(
  kind: OperationKind,
  safety: RosClawConfig["safety"],
): string[] {
  switch (kind) {
    case "topic":
      return safety.allowedTopics;
    case "service":
      return safety.allowedServices;
    case "action":
      return safety.allowedActions;
    case "none":
      // Non-ROS discovery/listing operations are always allowed by policy.
      return ["*"];
  }
}

function matchesAny(value: string, patterns: string[]): boolean {
  // Pattern matching supports exact names and "*" wildcards.
  return patterns.some((pattern) => matchesPattern(value, pattern.trim()));
}

function matchesPolicyTarget(
  kind: OperationKind,
  target: string,
  patterns: string[],
): boolean {
  return patterns.some((rawPattern) => {
    const scoped = parseScopedPattern(rawPattern);
    if (!scoped.pattern) {
      return false;
    }
    if (scoped.kind && scoped.kind !== kind) {
      return false;
    }
    return matchesPattern(target, scoped.pattern);
  });
}

function parseScopedPattern(pattern: string): {
  kind?: Exclude<OperationKind, "none">;
  pattern: string;
} {
  const trimmed = pattern.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    return { pattern: trimmed };
  }

  const kind = trimmed.slice(0, separator);
  if (kind !== "topic" && kind !== "service" && kind !== "action") {
    return { pattern: trimmed };
  }

  return {
    kind,
    pattern: trimmed.slice(separator + 1).trim(),
  };
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === "*") {
    return true;
  }
  if (!pattern.includes("*")) {
    return value === pattern;
  }

  const regex = new RegExp(
    `^${pattern.split("*").map(escapeRegex).join(".*")}$`,
  );
  return regex.test(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringParam(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  // Ignore missing or empty values so downstream policy checks can report the target as missing.
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function validateMotionSafety(
  toolName: string,
  params: Record<string, unknown>,
  safety: RosClawConfig["safety"],
): string | null {
  if (toolName === "ros2_publish") {
    const msg = objectParam(params["message"]);
    if (!msg) {
      return null;
    }

    const twistViolation = validateTwistLimits(msg, safety);
    if (twistViolation) {
      return twistViolation;
    }
  }

  const goalPoint = getGoalPoint(toolName, params);
  if (!goalPoint) {
    return null;
  }

  const { xMin, xMax, yMin, yMax } = safety.workspaceLimits;
  if (
    goalPoint.x < xMin ||
    goalPoint.x > xMax ||
    goalPoint.y < yMin ||
    goalPoint.y > yMax
  ) {
    return `Goal (${goalPoint.x.toFixed(2)}, ${goalPoint.y.toFixed(2)}) is outside workspace limits x=[${xMin}, ${xMax}], y=[${yMin}, ${yMax}]`;
  }

  return null;
}

function validateTwistLimits(
  msg: Record<string, unknown>,
  safety: RosClawConfig["safety"],
): string | null {
  const linear = objectParam(msg["linear"]);
  if (linear) {
    const linearVector = vector3Param(linear, "linear");
    if (typeof linearVector === "string") {
      return linearVector;
    }

    const speed = vectorMagnitude(linearVector);
    if (speed > safety.maxLinearVelocity) {
      return `Linear velocity ${speed.toFixed(2)} m/s exceeds safety limit of ${safety.maxLinearVelocity} m/s`;
    }
  }

  const angular = objectParam(msg["angular"]);
  if (angular) {
    const angularVector = vector3Param(angular, "angular");
    if (typeof angularVector === "string") {
      return angularVector;
    }

    const rate = vectorMagnitude(angularVector);
    if (rate > safety.maxAngularVelocity) {
      return `Angular velocity ${rate.toFixed(2)} rad/s exceeds safety limit of ${safety.maxAngularVelocity} rad/s`;
    }
  }

  return null;
}

function getGoalPoint(
  toolName: string,
  params: Record<string, unknown>,
): Point2D | null {
  if (!shouldCheckWorkspace(toolName, params)) {
    return null;
  }

  if (toolName === "ros2_publish") {
    const msg = objectParam(params["message"]);
    return msg ? findPoint2D(msg) : null;
  }

  if (toolName === "ros2_action_goal") {
    const goal = objectParam(params["goal"]);
    return goal ? findPoint2D(goal) : null;
  }

  return null;
}

function shouldCheckWorkspace(
  toolName: string,
  params: Record<string, unknown>,
): boolean {
  if (toolName === "ros2_publish") {
    const topic = stringParam(params, "topic")?.toLowerCase() ?? "";
    return topic.includes("goal") || topic.includes("pose");
  }

  if (toolName === "ros2_action_goal") {
    const action = stringParam(params, "action")?.toLowerCase() ?? "";
    return (
      action.includes("navigate") ||
      action.includes("move") ||
      action.includes("goal") ||
      action.includes("pose")
    );
  }

  return false;
}

function findPoint2D(value: unknown): Point2D | null {
  const object = objectParam(value);
  if (!object) {
    return null;
  }

  const x = finiteNumberParam(object["x"]);
  const y = finiteNumberParam(object["y"]);
  if (x !== undefined && y !== undefined) {
    return { x, y };
  }

  for (const key of ["position", "pose", "goal", "target_pose"]) {
    const nested = objectParam(object[key]);
    if (!nested) {
      continue;
    }
    const point = findPoint2D(nested);
    if (point) {
      return point;
    }
  }

  return null;
}

function vector3Param(
  value: Record<string, unknown>,
  label: string,
): { x: number; y: number; z: number } | string {
  const x = finiteNumberParam(value["x"]) ?? 0;
  const y = finiteNumberParam(value["y"]) ?? 0;
  const z = finiteNumberParam(value["z"]) ?? 0;

  for (const axis of ["x", "y", "z"]) {
    const axisValue = value[axis];
    if (axisValue !== undefined && finiteNumberParam(axisValue) === undefined) {
      return `Invalid ${label}.${axis} value; expected a finite number`;
    }
  }

  return { x, y, z };
}

function vectorMagnitude(vector: { x: number; y: number; z: number }): number {
  return Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
}

function objectParam(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function finiteNumberParam(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
