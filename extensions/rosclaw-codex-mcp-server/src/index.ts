import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseConfig } from "@rosclaw/rosclaw/config";
import { validateRosToolCall } from "@rosclaw/rosclaw/safety/validator";
import { createTransport } from "@rosclaw/rosclaw/transport/factory";
import type { RosTransport } from "@rosclaw/rosclaw/transport/transport";
import type { TransportConfig } from "@rosclaw/rosclaw/transport/types";
import type { RosClawConfig } from "@rosclaw/rosclaw/config";
import { z } from "zod";

let transport: RosTransport | null = null;
const config = readRosClawConfig();

const server = new McpServer(
  {
    name: "rosclaw-codex",
    version: "0.0.1",
  },
  {
    instructions:
      "Use this server for controlled ROS2 access through RosClaw. Write-capable ROS tools are guarded by RosClaw safety policy.",
  },
);

server.registerTool(
  "ros2_publish",
  {
    title: "ROS2 Publish",
    description:
      "Publish a message to a ROS2 topic after RosClaw safety policy validation.",
    inputSchema: z.object({
      topic: z.string().min(1).describe("ROS2 topic name, for example /cmd_vel"),
      type: z
        .string()
        .min(1)
        .describe("ROS2 message type, for example geometry_msgs/msg/Twist"),
      message: z
        .record(z.unknown())
        .describe("Message payload matching the ROS2 message type schema"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_publish", params);
    const ros = await getTransport();
    ros.publish({
      topic: params.topic,
      type: params.type,
      msg: params.message,
    });

    return jsonResult({
      success: true,
      topic: params.topic,
      type: params.type,
    });
  },
);

server.registerTool(
  "ros2_list_topics",
  {
    title: "ROS2 List Topics",
    description:
      "List available ROS2 topics and message types through the configured RosClaw transport.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    const ros = await getTransport();
    const topics = await ros.listTopics();

    return jsonResult({ success: true, topics });
  },
);

server.registerTool(
  "ros2_subscribe_once",
  {
    title: "ROS2 Subscribe Once",
    description:
      "Subscribe to one ROS2 topic and return the next received message without modifying robot state.",
    inputSchema: z.object({
      topic: z.string().min(1).describe("ROS2 topic name, for example /odom"),
      type: z
        .string()
        .min(1)
        .optional()
        .describe("Optional ROS2 message type, for example nav_msgs/msg/Odometry"),
      timeout: z
        .number()
        .positive()
        .optional()
        .describe("Timeout in milliseconds. Defaults to 5000."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  async ({ topic, type, timeout }) => {
    assertAllowed("ros2_subscribe_once", { topic, type, timeout });
    const ros = await getTransport();
    const message = await subscribeOnce(ros, topic, type, timeout ?? 5000);
    return jsonResult({ success: true, topic, message });
  },
);

server.registerTool(
  "ros2_param_get",
  {
    title: "ROS2 Get Parameter",
    description:
      "Read a ROS2 parameter value through the standard get_parameters service.",
    inputSchema: z.object({
      node: z
        .string()
        .min(1)
        .describe("Fully qualified ROS2 node name, for example /controller"),
      parameter: z.string().min(1).describe("Parameter name to read"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  async ({ node, parameter }) => {
    assertAllowed("ros2_param_get", { node, parameter });
    const ros = await getTransport();
    const response = await ros.callService({
      service: `${node}/get_parameters`,
      type: "rcl_interfaces/srv/GetParameters",
      args: { names: [parameter] },
    });

    return jsonResult({
      success: response.result,
      node,
      parameter,
      value: response.values,
    });
  },
);

server.registerTool(
  "ros2_param_set",
  {
    title: "ROS2 Set Parameter",
    description:
      "Set a ROS2 parameter after RosClaw safety policy validation.",
    inputSchema: z.object({
      node: z
        .string()
        .min(1)
        .describe("Fully qualified ROS2 node name, for example /controller"),
      parameter: z.string().min(1).describe("Parameter name to set"),
      value: z.unknown().describe("New parameter value"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_param_set", params);
    const ros = await getTransport();
    const response = await ros.callService({
      service: `${params.node}/set_parameters`,
      type: "rcl_interfaces/srv/SetParameters",
      args: {
        parameters: [
          {
            name: params.parameter,
            value: params.value,
          },
        ],
      },
    });

    return jsonResult({
      success: response.result,
      node: params.node,
      parameter: params.parameter,
      response: response.values,
    });
  },
);

server.registerTool(
  "ros2_camera_snapshot",
  {
    title: "ROS2 Camera Snapshot",
    description:
      "Read one compressed image frame from a ROS2 camera topic without modifying robot state.",
    inputSchema: z.object({
      topic: z
        .string()
        .min(1)
        .optional()
        .describe("Compressed image topic. Defaults to /camera/image_raw/compressed."),
      timeout: z
        .number()
        .positive()
        .optional()
        .describe("Timeout in milliseconds. Defaults to 10000."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  async ({ topic, timeout }) => {
    const cameraTopic = topic ?? "/camera/image_raw/compressed";
    assertAllowed("ros2_camera_snapshot", { topic: cameraTopic, timeout });
    const ros = await getTransport();
    const message = await subscribeOnce(
      ros,
      cameraTopic,
      "sensor_msgs/msg/CompressedImage",
      timeout ?? 10000,
    );

    return jsonResult({
      success: true,
      topic: cameraTopic,
      format: message["format"] ?? "jpeg",
      data: message["data"] ?? "",
    });
  },
);

server.registerTool(
  "ros2_service_call",
  {
    title: "ROS2 Service Call",
    description:
      "Call a ROS2 service after RosClaw safety policy validation.",
    inputSchema: z.object({
      service: z.string().min(1).describe("ROS2 service name"),
      type: z.string().min(1).optional().describe("Optional ROS2 service type"),
      args: z
        .record(z.unknown())
        .optional()
        .describe("Service request arguments"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_service_call", params);
    const ros = await getTransport();
    const response = await ros.callService({
      service: params.service,
      type: params.type,
      args: params.args,
    });

    return jsonResult({
      success: response.result,
      service: params.service,
      response: response.values,
    });
  },
);

server.registerTool(
  "ros2_action_goal",
  {
    title: "ROS2 Action Goal",
    description:
      "Send a ROS2 action goal after RosClaw safety policy validation.",
    inputSchema: z.object({
      action: z.string().min(1).describe("ROS2 action server name"),
      actionType: z.string().min(1).describe("ROS2 action type"),
      goal: z.record(z.unknown()).describe("Action goal payload"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_action_goal", params);
    const ros = await getTransport();
    const result = await ros.sendActionGoal({
      action: params.action,
      actionType: params.actionType,
      args: params.goal,
    });

    return jsonResult({
      success: result.result,
      action: params.action,
      result: result.values,
    });
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RosClaw Codex MCP server running on stdio");
}

process.on("SIGINT", async () => {
  await closeTransport();
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeTransport();
  await server.close();
  process.exit(0);
});

main().catch((error: unknown) => {
  console.error("Fatal error in RosClaw Codex MCP server:", error);
  process.exit(1);
});

async function getTransport(): Promise<RosTransport> {
  if (transport) {
    return transport;
  }

  const config = readTransportConfig();
  const nextTransport = await createTransport(config);
  nextTransport.onConnection((status) => {
    console.error(`RosClaw transport status: ${status}`);
  });
  await nextTransport.connect();
  transport = nextTransport;
  return nextTransport;
}

async function closeTransport(): Promise<void> {
  if (!transport) {
    return;
  }
  await transport.disconnect();
  transport = null;
}

function readTransportConfig(): TransportConfig {
  const mode = config.transport.mode;

  if (mode !== "rosbridge") {
    throw new Error(
      `Unsupported ROSCLAW_TRANSPORT_MODE for the first Codex MCP phase: ${mode}`,
    );
  }

  return {
    mode: "rosbridge",
    rosbridge: config.rosbridge,
  };
}

function readRosClawConfig(): RosClawConfig {
  const raw = readJsonEnv("ROSCLAW_CONFIG_JSON");
  const rawTransport = objectValue(raw["transport"]);
  const rawRosbridge = objectValue(raw["rosbridge"]);

  return parseConfig({
    ...raw,
    transport: {
      ...rawTransport,
      mode: process.env.ROSCLAW_TRANSPORT_MODE ?? rawTransport["mode"],
    },
    rosbridge: {
      ...rawRosbridge,
      url: process.env.ROSCLAW_ROSBRIDGE_URL ?? rawRosbridge["url"],
      reconnect: envBoolean(
        "ROSCLAW_ROSBRIDGE_RECONNECT",
        booleanValue(rawRosbridge["reconnect"], true),
      ),
      reconnectInterval: envNumber(
        "ROSCLAW_ROSBRIDGE_RECONNECT_INTERVAL",
        numberValue(rawRosbridge["reconnectInterval"], 3000),
      ),
    },
  });
}

function assertAllowed(toolName: string, params: Record<string, unknown>): void {
  const violation = validateRosToolCall(toolName, params, config.safety);
  if (violation) {
    throw new Error(violation);
  }
}

function readJsonEnv(name: string): Record<string, unknown> {
  const value = process.env[name];
  if (!value) {
    return {};
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanValue(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function numberValue(value: unknown, defaultValue: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : defaultValue;
}

function envBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function envNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function subscribeOnce(
  ros: RosTransport,
  topic: string,
  type: string | undefined,
  timeout: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const subscription = ros.subscribe({ topic, type }, (message) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve(message);
    });

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      subscription.unsubscribe();
      reject(new Error(`Timeout waiting for message on ${topic}`));
    }, timeout);
  });
}

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
