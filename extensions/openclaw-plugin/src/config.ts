import { z } from "zod";

const IceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

// DEFAULT_ALLOWED_TOPICS: default topic allowlist for common robot control, state, camera, diagnostics, and rosclaw topics
const DEFAULT_ALLOWED_TOPICS = [
  "/cmd_vel",
  "*/cmd_vel",
  "/goal_pose",
  "*/goal_pose",
  "/odom",
  "*/odom",
  "/scan",
  "*/scan",
  "/camera/*",
  "*/camera/*",
  "/battery_state",
  "*/battery_state",
  "/diagnostics",
  "*/diagnostics",
  "/rosclaw/*",
];

// DEFAULT_ALLOWED_SERVICES: default service allowlist for rosapi, rosclaw, and read-only parameter access
const DEFAULT_ALLOWED_SERVICES = [
  "/rosapi/*",
  "/rosclaw/*",
  "*/get_parameters",
];

// DEFAULT_ALLOWED_ACTIONS: default action allowlist for common navigation action servers
const DEFAULT_ALLOWED_ACTIONS = [
  "/navigate_to_pose",
  "*/navigate_to_pose",
];

export const RosClawConfigSchema = z.object({
  transport: z
    .object({
      mode: z.enum(["rosbridge", "local", "webrtc"]).default("rosbridge"),
    })
    .default({}),

  rosbridge: z
    .object({
      url: z.string().default("ws://localhost:9090"),
      reconnect: z.boolean().default(true),
      reconnectInterval: z.number().default(3000),
    })
    .default({}),

  local: z
    .object({
      domainId: z.number().default(0),
    })
    .default({}),

  webrtc: z
    .object({
      signalingUrl: z.string().default(""),
      apiUrl: z.string().default(""),
      robotId: z.string().default(""),
      robotKey: z.string().default(""),
      iceServers: z
        .array(IceServerSchema)
        .default([{ urls: "stun:stun.l.google.com:19302" }]),
    })
    .default({}),

  robot: z
    .object({
      name: z.string().default("Robot"),
      namespace: z.string().default(""),
    })
    .default({}),

  safety: z
    .object({
      maxLinearVelocity: z.number().nonnegative().default(1.0),
      maxAngularVelocity: z.number().nonnegative().default(1.5),
      // readonlyMode: blocks write operations while still allowing read-only discovery and subscriptions
      readonlyMode: z.boolean().default(false),
      // allowedTopics: topic allowlist; empty means all topics are allowed, otherwise only matching topics pass
      allowedTopics: z.array(z.string()).default(DEFAULT_ALLOWED_TOPICS),
      // allowedServices: service allowlist; empty means all services are allowed, otherwise only matching services pass
      allowedServices: z.array(z.string()).default(DEFAULT_ALLOWED_SERVICES),
      // allowedActions: action allowlist; empty means all actions are allowed, otherwise only matching actions pass
      allowedActions: z.array(z.string()).default(DEFAULT_ALLOWED_ACTIONS),
      // blockedTopics: topic blocklist that overrides allowedTopics; useful for noisy or internal topics like /rosout
      blockedTopics: z.array(z.string()).default(["/rosout", "/parameter_events"]),
      // requireConfirmationFor: write targets blocked without confirmation; supports bare patterns or kind prefixes like topic:/cmd_vel
      requireConfirmationFor: z.array(z.string()).default([]),
      workspaceLimits: z
        .object({
          xMin: z.number().default(-10),
          xMax: z.number().default(10),
          yMin: z.number().default(-10),
          yMax: z.number().default(10),
        })
        .refine((limits) => limits.xMin <= limits.xMax, {
          message: "xMin must be less than or equal to xMax",
          path: ["xMin"],
        })
        .refine((limits) => limits.yMin <= limits.yMax, {
          message: "yMin must be less than or equal to yMax",
          path: ["yMin"],
        })
        .default({}),
    })
    .default({}),
});

export type RosClawConfig = z.infer<typeof RosClawConfigSchema>;

/**
 * Parse and validate raw plugin config against the RosClaw schema.
 * Returns a fully-defaulted, typed config object.
 */
export function parseConfig(raw: Record<string, unknown>): RosClawConfig {
  return RosClawConfigSchema.parse(raw);
}
