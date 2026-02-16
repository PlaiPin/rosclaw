import type { OpenClawPluginAPI } from "../../index.js";

interface SafetyConfig {
  maxLinearVelocity: number;
  maxAngularVelocity: number;
  workspaceLimits: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
}

const DEFAULT_SAFETY: SafetyConfig = {
  maxLinearVelocity: 1.0,
  maxAngularVelocity: 1.5,
  workspaceLimits: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
};

/**
 * Register the before_tool_call safety validation hook.
 * Intercepts tool calls and validates them against safety limits.
 */
export function registerSafetyHook(api: OpenClawPluginAPI): void {
  const safety: SafetyConfig = {
    ...DEFAULT_SAFETY,
    ...(api.getConfig<Partial<SafetyConfig>>("safety") ?? {}),
  };

  api.on("before_tool_call", async (toolCall: unknown) => {
    // TODO: Implement safety validation
    // - Check velocity commands against maxLinearVelocity / maxAngularVelocity
    // - Check navigation goals against workspace limits
    // - Block dangerous operations (e.g., publishing to certain topics)
    // - Return { allow: true } or { allow: false, reason: "..." }

    const call = toolCall as { name: string; parameters: Record<string, unknown> };

    if (call.name === "ros2_publish") {
      const msg = call.parameters["message"] as Record<string, unknown> | undefined;
      if (msg) {
        // Check velocity limits for Twist messages
        const linear = msg["linear"] as Record<string, number> | undefined;
        const angular = msg["angular"] as Record<string, number> | undefined;

        if (linear) {
          const speed = Math.sqrt(
            (linear["x"] ?? 0) ** 2 +
            (linear["y"] ?? 0) ** 2 +
            (linear["z"] ?? 0) ** 2,
          );
          if (speed > safety.maxLinearVelocity) {
            api.log.warn(`Blocked: linear velocity ${speed} exceeds limit ${safety.maxLinearVelocity}`);
            return { allow: false, reason: `Linear velocity ${speed.toFixed(2)} m/s exceeds safety limit of ${safety.maxLinearVelocity} m/s` };
          }
        }

        if (angular) {
          const rate = Math.abs(angular["z"] ?? 0);
          if (rate > safety.maxAngularVelocity) {
            api.log.warn(`Blocked: angular velocity ${rate} exceeds limit ${safety.maxAngularVelocity}`);
            return { allow: false, reason: `Angular velocity ${rate.toFixed(2)} rad/s exceeds safety limit of ${safety.maxAngularVelocity} rad/s` };
          }
        }
      }
    }

    // TODO: Add workspace limit checks for navigation goals

    return { allow: true };
  });
}
