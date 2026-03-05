import { z } from "zod";

const IceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export const RosClawConfigSchema = z.object({
  transport: z
    .object({
      mode: z.enum(["rosbridge", "local", "webrtc", "zenoh"]).default("rosbridge"),
    })
    .default({}),

  zenoh: z
    .object({
      routerEndpoint: z.string().default("tcp/localhost:7447"),
      domainId: z.number().default(0),
      /** "ros2dds" = zenoh-bridge-ros2dds key format (slashes kept). "rmw_zenoh" = rmw_zenoh key format (domain + %). */
      keyFormat: z.enum(["ros2dds", "rmw_zenoh"]).default("ros2dds"),
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
      /** Camera topic for "what do you see?" (e.g. /camera/camera/color/image_raw/compressed). If set, used as default in ros2_camera_snapshot and in context. */
      cameraTopic: z.string().default(""),
    })
    .default({}),

  /** Phase 3 teleop web app: camera + twist controls. */
  teleop: z
    .object({
      /** Default camera topic when only one source or as default selection. Falls back to robot.cameraTopic then RealSense default. */
      cameraTopic: z.string().default(""),
      /** Explicit list of camera sources for the selector; if empty, derived from listTopics() filtered by Image/CompressedImage. */
      cameraTopics: z
        .array(z.object({ topic: z.string(), label: z.string().optional() }))
        .default([]),
      /** cmd_vel topic override (default from robot namespace). */
      cmdVelTopic: z.string().default(""),
      /** Default linear speed (m/s) for teleop. */
      speedDefault: z.coerce.number().min(0).max(2).default(0.3),
      /** Camera poll interval in ms for the teleop page. */
      cameraPollMs: z.number().min(50).max(2000).default(150),
    })
    .default({}),

  safety: z
    .object({
      maxLinearVelocity: z.number().default(1.0),
      maxAngularVelocity: z.number().default(1.5),
      workspaceLimits: z
        .object({
          xMin: z.number().default(-10),
          xMax: z.number().default(10),
          yMin: z.number().default(-10),
          yMax: z.number().default(10),
        })
        .default({}),
    })
    .default({}),

  /** Native Follow Me: depth (and optional Ollama VLM) + cmd_vel. No external apps. */
  followMe: z
    .object({
      /** If false (default), use depth only—no Ollama. The chat's "what do you see" uses the assistant's vision model; Follow Me does not call it. Set true to use Qwen for person detection and left/right steering. */
      useOllama: z.boolean().default(false),
      ollamaUrl: z.string().default("http://localhost:11434"),
      vlmModel: z.string().default("qwen3-vl:2b"),
      cameraTopic: z.string().default("/camera/image_raw/compressed"),
      cameraMessageType: z.enum(["CompressedImage", "Image"]).default("CompressedImage"),
      /** Override cmd_vel topic (e.g. /robot3946.../cmd_vel). If set, used instead of robot.namespace + /cmd_vel. */
      cmdVelTopic: z.string().default(""),
      targetDistance: z.number().default(0.5),
      rateHz: z.number().min(1).max(15).default(5),
      /** Minimum linear speed (m/s) when moving forward/back so the base actually moves. Many bases need ~0.3. */
      minLinearVelocity: z.number().min(0).max(1).default(0.3),
      /** Optional depth image topic (e.g. RealSense /camera/camera/depth/image_rect_raw). If set, Follow Me uses real distance vs targetDistance instead of VLM distance_hint only. */
      depthTopic: z.string().default(""),
      /** Optional HTTP callback for human detection (e.g. OpenAI proxy). POST body: { "image": "<base64>" }. Expect JSON: { "person_visible": boolean, "position"?: "left"|"center"|"right", "distance_hint"?: "close"|"medium"|"far" }. Distance for follow is always from RealSense depth; this is for person_visible and left/right. */
      visionCallbackUrl: z.string().default(""),
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
