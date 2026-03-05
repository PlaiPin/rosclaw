import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import type { TopicInfo, ServiceInfo, ActionInfo } from "../transport/types.js";
import { getTransport } from "../service.js";

/** Cached discovery results with TTL. */
interface DiscoveryCache {
  topics: TopicInfo[];
  services: ServiceInfo[];
  actions: ActionInfo[];
  timestamp: number;
}

const CACHE_TTL_MS = 60_000; // 60s
let cache: DiscoveryCache | null = null;

/** Clear the discovery cache so the next agent start re-discovers capabilities. */
export function clearDiscoveryCache(): void {
  cache = null;
}

/**
 * Register the before_agent_start hook to inject robot capabilities
 * into the AI agent's system context.
 */
export function registerRobotContext(api: OpenClawPluginApi, config: RosClawConfig): void {
  const robotName = config.robot.name;
  const robotNamespace = config.robot.namespace;

  // Reactive re-discovery: clear cache on transport reconnect
  try {
    const transport = getTransport();
    transport.onConnection((status: string) => {
      if (status === "connected") {
        cache = null; // Force re-discovery on next agent start
        api.logger.info("Transport reconnected — capability cache cleared");
      }
    });
  } catch {
    // Transport not initialized yet — will be set up by the service.
    // The onConnection handler will be registered when the hook fires.
  }

  api.on("before_agent_start", async (_event, _ctx) => {
    const capabilities = await discoverCapabilities(api, robotNamespace);
    const cameraTopicHint =
      (config.robot?.cameraTopic ?? "").trim() || "/camera/camera/color/image_raw/compressed";
    const context = buildRobotContext(robotName, robotNamespace, capabilities, cameraTopicHint);
    return { prependContext: context };
  });
}

/**
 * Discover live capabilities from the transport layer, with caching.
 * Falls back to empty lists if discovery fails.
 */
async function discoverCapabilities(
  api: OpenClawPluginApi,
  namespace: string,
): Promise<DiscoveryCache> {
  // Return cached results if still fresh
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache;
  }

  try {
    const transport = getTransport();

    const [topics, services, actions] = await Promise.all([
      transport.listTopics(),
      transport.listServices(),
      transport.listActions(),
    ]);

    // Filter by namespace if configured; always include camera topics (they often live under /camera/, not robot namespace)
    const filterByNs = (name: string) => {
      if (!namespace) return true;
      const normalized = name.replace(/^\/+/, "");
      if (normalized.startsWith(namespace)) return true;
      if (normalized.startsWith("camera/") || normalized.includes("/camera/")) return true;
      return false;
    };

    cache = {
      topics: topics.filter((t: TopicInfo) => filterByNs(t.name)),
      services: services.filter((s: ServiceInfo) => filterByNs(s.name)),
      actions: actions.filter((a: ActionInfo) => filterByNs(a.name)),
      timestamp: Date.now(),
    };

    api.logger.info(
      `Discovered ${cache.topics.length} topics, ${cache.services.length} services, ${cache.actions.length} actions`,
    );

    return cache;
  } catch (err) {
    api.logger.warn(`Capability discovery failed, using defaults: ${err}`);
    return {
      topics: [],
      services: [],
      actions: [],
      timestamp: 0,
    };
  }
}

/**
 * Build the robot context string that gets injected into the agent's system prompt.
 */
function buildRobotContext(
  name: string,
  namespace: string,
  capabilities: DiscoveryCache,
  cameraTopicHint: string,
): string {
  const { topics, services, actions } = capabilities;

  // If discovery returned results, use them
  if (topics.length > 0 || services.length > 0 || actions.length > 0) {
    return buildDynamicContext(name, namespace, topics, services, actions);
  }

  // Fall back to hardcoded defaults if discovery failed
  return buildFallbackContext(name, namespace, cameraTopicHint);
}

const USER_INTERFACE_BLURB = `
### User-facing interface (tell users this when they ask)
- **There is no separate robot GUI, dashboard, or URL.** The interface is this chat.
- The user controls the robot by typing here (e.g. "move forward 1 meter", "what do you see?", "check the battery"). You execute commands with the ros2_* tools and reply in chat.
- For telemetry: use \`ros2_subscribe_once\` or \`ros2_camera_snapshot\` and describe or show the result in your reply. There is no separate feed URL—you are the feed. If they want a "controller app," this chat is it.

### OpenClaw "nodes" — do not confuse with RosClaw
- RosClaw is an **OpenClaw plugin** that runs inside this gateway. It connects to the robot via **rosbridge** (WebSocket to the robot's rosbridge_server). There is **no separate "RosClaw agent" or "node" to pair**.
- **Never tell users** to run \`openclaw node pair\`, \`openclaw nodes status\`, QR codes, or auth tokens for robot control. Those apply to OpenClaw's node/device pairing feature, not to RosClaw.
- If the user says "nodes status shows zero" or "how do I pair the robot": explain that the robot is already connected through the RosClaw plugin's rosbridge connection (configured in the plugin as e.g. ws://localhost:9090). No pairing step is required. If the plugin is loaded and rosbridge is running on the robot, the robot is connected—\`openclaw nodes status\` is irrelevant for RosClaw.
`.trim();

function buildDynamicContext(
  name: string,
  namespace: string,
  topics: TopicInfo[],
  services: ServiceInfo[],
  actions: ActionInfo[],
): string {
  let context = `## Robot: ${name}\n\n`;
  context += `You are connected to a ROS2 robot named "${name}". You can control it using the ros2_* tools.\n\n`;
  if (namespace) {
    context += `**Velocity commands:** Use \`ros2_publish\` with topic \`/cmd_vel\`; the plugin sends them to \`/${namespace}/cmd_vel\`.\n\n`;
  }
  context += `${USER_INTERFACE_BLURB}\n\n`;

  // Cap injected lists to avoid huge context (rate limits / token burn)
  const MAX_TOPICS = 25;
  const MAX_SERVICES = 15;
  const MAX_ACTIONS = 15;

  if (topics.length > 0) {
    context += "### Available Topics\n";
    const showTopics = topics.slice(0, MAX_TOPICS);
    for (const t of showTopics) {
      context += `- \`${t.name}\` (${t.type})\n`;
    }
    if (topics.length > MAX_TOPICS) {
      context += `- … and ${topics.length - MAX_TOPICS} more (use \`ros2_list_topics\` if needed)\n`;
    }
    context += "\n";
  }

  if (services.length > 0) {
    context += "### Available Services\n";
    const showServices = services.slice(0, MAX_SERVICES);
    for (const s of showServices) {
      context += `- \`${s.name}\` (${s.type})\n`;
    }
    if (services.length > MAX_SERVICES) {
      context += `- … and ${services.length - MAX_SERVICES} more\n`;
    }
    context += "\n";
  }

  if (actions.length > 0) {
    context += "### Available Actions\n";
    const showActions = actions.slice(0, MAX_ACTIONS);
    for (const a of showActions) {
      context += `- \`${a.name}\` (${a.type})\n`;
    }
    if (actions.length > MAX_ACTIONS) {
      context += `- … and ${actions.length - MAX_ACTIONS} more\n`;
    }
    context += "\n";
  }

  context += `### Missions
- **Follow Me** (native): The user can say "follow me", "start following", "stop following". Use the **\`follow_robot\`** tool (action: \`start\` to begin, \`stop\` to halt, \`status\` to check). By default Follow Me uses **depth only** (no Ollama)—the plugin cannot call the chat's vision model from its loop. Set followMe.useOllama to true to use Qwen for person detection. Use **\`follow_me_see\`** when useOllama is on and the user asks what the tracker sees.

### Safety Limits
- Maximum linear velocity: 1.0 m/s
- Maximum angular velocity: 1.5 rad/s
- All velocity commands are validated before execution

### Camera / "What does the robot see?"
- When the user asks what the robot sees (or for a photo, camera view, or snapshot), **always call \`ros2_camera_snapshot\`** (or \`ros2_subscribe_once\` on a camera topic). Prefer a topic from the list above that contains **color** and **compressed** (e.g. \`/camera/camera/color/image_raw/compressed\`) for RGB. Do not assume the transport cannot decode images—RosClaw supports \`sensor_msgs/msg/Image\` and \`sensor_msgs/msg/CompressedImage\` over Zenoh and rosbridge. If the tool returns an error, report it; otherwise show or describe the image.

### Tips
- Use \`ros2_list_topics\` to discover all available topics
- Use \`ros2_subscribe_once\` to read the current value of any topic
- Use \`ros2_camera_snapshot\` to see what the robot sees
- The user can say /estop at any time to immediately stop the robot`;

  return context;
}

function buildFallbackContext(
  name: string,
  namespace: string,
  cameraTopicHint: string,
): string {
  const prefix = namespace ? `${namespace}/` : "/";

  return `
## Robot: ${name}

You are connected to a ROS2 robot named "${name}". You can control it using the ros2_* tools.

${USER_INTERFACE_BLURB}

### Available Topics
- \`${prefix}cmd_vel\` (geometry_msgs/msg/Twist) — Velocity commands
- \`${prefix}odom\` (nav_msgs/msg/Odometry) — Odometry data
- \`${prefix}scan\` (sensor_msgs/msg/LaserScan) — LIDAR scan
- \`${cameraTopicHint}\` (sensor_msgs/msg/CompressedImage) — Camera feed for "what do you see?" Use this with \`ros2_camera_snapshot\`.
- \`${prefix}battery_state\` (sensor_msgs/msg/BatteryState) — Battery status
- RealSense: \`/camera/camera/color/image_raw\` (Image), \`/camera/camera/color/image_raw/compressed\` (CompressedImage), \`/camera/camera/depth/image_rect_raw\` (depth). Use \`ros2_camera_snapshot\` for RGB; use \`ros2_depth_distance\` for distance in meters.

### Missions
- **Follow Me** (native): Use **\`follow_robot\`** with action \`start\` / \`stop\` / \`status\` when the user says "follow me", "start following", or "stop following". Default is **depth only** (no Ollama). Set followMe.useOllama for Qwen. Use **\`follow_me_see\`** when useOllama is on to report what the tracker sees.

### Safety Limits
- Maximum linear velocity: 1.0 m/s
- Maximum angular velocity: 1.5 rad/s
- All velocity commands are validated before execution

### Camera / "What does the robot see?"
- When the user asks what the robot sees (or for a photo, camera view, or snapshot), **always call \`ros2_camera_snapshot\`** (or \`ros2_subscribe_once\` on a camera topic). Do not assume the transport cannot decode images—RosClaw supports \`sensor_msgs/msg/Image\` and \`sensor_msgs/msg/CompressedImage\` over Zenoh and rosbridge. If the tool returns an error, report it; otherwise show or describe the image.

### Tips
- Use \`ros2_list_topics\` to discover all available topics
- Use \`ros2_subscribe_once\` to read the current value of any topic
- Use \`ros2_camera_snapshot\` to see what the robot sees
- Use \`ollama_status\` to check if Ollama is reachable and the Follow Me vision model is available when Follow Me has no detections or the user asks if Qwen is running
- The user can say /estop at any time to immediately stop the robot
`.trim();
}
