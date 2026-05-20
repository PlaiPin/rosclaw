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
    name: "rosclaw",
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
  "ros2_list_services",
  {
    title: "ROS2 List Services",
    description:
      "List available ROS2 services and service types through the configured RosClaw transport.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    assertAllowed("ros2_list_services", {});
    const ros = await getTransport();
    const services = await ros.listServices();

    return jsonResult({ success: true, services });
  },
);

server.registerTool(
  "ros2_list_actions",
  {
    title: "ROS2 List Actions",
    description:
      "List available ROS2 action servers and action types through the configured RosClaw transport.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    assertAllowed("ros2_list_actions", {});
    const ros = await getTransport();
    const actions = await ros.listActions();

    return jsonResult({ success: true, actions });
  },
);

server.registerTool(
  "ros2_list_nodes",
  {
    title: "ROS2 List Nodes",
    description:
      "List available ROS2 nodes through the configured RosClaw transport.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    assertAllowed("ros2_list_nodes", {});
    const ros = await getTransport();
    const nodes = await ros.listNodes();

    return jsonResult({ success: true, nodes });
  },
);

server.registerTool(
  "ros2_node_info",
  {
    title: "ROS2 Node Info",
    description:
      "Return the topics and services used by one ROS2 node without modifying robot state.",
    inputSchema: z.object({
      node: z.string().min(1).describe("Fully qualified ROS2 node name"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_node_info", params);
    const ros = await getTransport();
    const node = await ros.getNodeInfo(params.node);

    return jsonResult({ success: true, node });
  },
);

server.registerTool(
  "ros2_topic_info",
  {
    title: "ROS2 Topic Info",
    description:
      "Return a ROS2 topic's type, publishers, subscribers, and QoS metadata when available.",
    inputSchema: z.object({
      topic: z.string().min(1).describe("ROS2 topic name, for example /odom"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_topic_info", params);
    const ros = await getTransport();
    const topic = await ros.getTopicInfo(params.topic);

    return jsonResult({ success: true, topic });
  },
);

server.registerTool(
  "ros2_service_info",
  {
    title: "ROS2 Service Info",
    description:
      "Return a ROS2 service's type and provider nodes without modifying robot state.",
    inputSchema: z.object({
      service: z.string().min(1).describe("ROS2 service name"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_service_info", params);
    const ros = await getTransport();
    const service = await ros.getServiceInfo(params.service);

    return jsonResult({ success: true, service });
  },
);

server.registerTool(
  "ros2_action_info",
  {
    title: "ROS2 Action Info",
    description:
      "Return a ROS2 action server's type and server metadata without modifying robot state.",
    inputSchema: z.object({
      action: z.string().min(1).describe("ROS2 action server name"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_action_info", params);
    const ros = await getTransport();
    const action = await ros.getActionInfo(params.action);

    return jsonResult({ success: true, action });
  },
);

server.registerTool(
  "ros2_interface_show",
  {
    title: "ROS2 Interface Show",
    description:
      "Return the field schema for a ROS2 message, service, or action interface type.",
    inputSchema: z.object({
      type: z
        .string()
        .min(1)
        .describe("ROS2 interface type, for example geometry_msgs/msg/Twist"),
      kind: z
        .enum(["message", "service", "action"])
        .optional()
        .describe("Optional interface kind override."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_interface_show", params);
    const ros = await getTransport();
    const schema = await showInterface(ros, params.type, params.kind);

    return jsonResult({ success: true, ...schema });
  },
);

server.registerTool(
  "ros2_message_schema",
  {
    title: "ROS2 Message Schema",
    description:
      "Return the field schema for a ROS2 message type, including nested typedefs.",
    inputSchema: z.object({
      type: z
        .string()
        .min(1)
        .describe("ROS2 message type, for example geometry_msgs/msg/Twist"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_message_schema", params);
    const ros = await getTransport();
    const schema = await ros.getMessageSchema(params.type);

    return jsonResult({ success: true, schema });
  },
);

server.registerTool(
  "ros2_service_schema",
  {
    title: "ROS2 Service Schema",
    description:
      "Return request and response field schemas for a ROS2 service type.",
    inputSchema: z.object({
      type: z
        .string()
        .min(1)
        .describe("ROS2 service type, for example rcl_interfaces/srv/GetParameters"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_service_schema", params);
    const ros = await getTransport();
    const schema = await ros.getServiceSchema(params.type);

    return jsonResult({ success: true, schema });
  },
);

server.registerTool(
  "ros2_action_schema",
  {
    title: "ROS2 Action Schema",
    description:
      "Return goal, result, and feedback field schemas for a ROS2 action type.",
    inputSchema: z.object({
      type: z
        .string()
        .min(1)
        .describe("ROS2 action type, for example nav2_msgs/action/NavigateToPose"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_action_schema", params);
    const ros = await getTransport();
    const schema = await ros.getActionSchema(params.type);

    return jsonResult({ success: true, schema });
  },
);

server.registerTool(
  "ros2_validate_tool_call",
  {
    title: "ROS2 Validate Tool Call",
    description:
      "Dry-run RosClaw safety policy validation for a ROS tool call without executing it.",
    inputSchema: z.object({
      toolName: z
        .string()
        .min(1)
        .describe("ROS MCP tool name, for example ros2_publish"),
      params: z
        .record(z.unknown())
        .default({})
        .describe("Tool parameters to validate."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ toolName, params }) => {
    const violation = validateRosToolCall(toolName, params, config.safety);

    return jsonResult({
      allowed: !violation,
      reason: violation ?? null,
    });
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
  "ros2_transport_status",
  {
    title: "ROS2 Transport Status",
    description:
      "Return the current RosClaw transport connection status without modifying robot state.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    assertAllowed("ros2_transport_status", {});
    const ros = await getTransport();

    return jsonResult({
      success: true,
      mode: config.transport.mode,
      status: ros.getStatus(),
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
  "ros2_cancel_action_goal",
  {
    title: "ROS2 Cancel Action Goal",
    description:
      "Cancel an in-progress ROS2 action goal after RosClaw safety policy validation.",
    inputSchema: z.object({
      action: z.string().min(1).describe("ROS2 action server name"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
  },
  async (params) => {
    assertAllowed("ros2_cancel_action_goal", params);
    const ros = await getTransport();
    await ros.cancelActionGoal(params.action);

    return jsonResult({
      success: true,
      action: params.action,
      cancelled: true,
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
  console.error("RosClaw MCP server running on stdio");
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
  console.error("Fatal error in RosClaw MCP server:", error);
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
      `Unsupported ROSCLAW_TRANSPORT_MODE for this MCP server phase: ${mode}`,
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

async function showInterface(
  ros: RosTransport,
  type: string,
  kind?: "message" | "service" | "action",
): Promise<Record<string, unknown>> {
  const inferredKind = kind ?? inferInterfaceKind(type);
  switch (inferredKind) {
    case "message":
      return {
        kind: inferredKind,
        schema: await ros.getMessageSchema(type),
      };
    case "service":
      return {
        kind: inferredKind,
        schema: await ros.getServiceSchema(type),
      };
    case "action":
      return {
        kind: inferredKind,
        schema: await ros.getActionSchema(type),
      };
  }
}

function inferInterfaceKind(type: string): "message" | "service" | "action" {
  if (type.includes("/msg/")) {
    return "message";
  }
  if (type.includes("/srv/")) {
    return "service";
  }
  if (type.includes("/action/")) {
    return "action";
  }

  throw new Error(
    `Cannot infer interface kind from ${type}; pass kind as message, service, or action`,
  );
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
