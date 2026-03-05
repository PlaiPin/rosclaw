import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { toNamespacedTopic } from "../topic-utils.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_service_call tool with the AI agent.
 * Allows calling any ROS2 service.
 */
export function registerServiceTool(api: OpenClawPluginApi, config: RosClawConfig): void {
  api.registerTool({
    name: "ros2_service_call",
    label: "ROS2 Service Call",
    description:
      "Call a ROS2 service and return the response. Use this for request/response operations " +
      "like setting parameters, triggering behaviors, or querying node state.",
    parameters: Type.Object({
      service: Type.String({ description: "The ROS2 service name (e.g., '/spawn_entity')" }),
      type: Type.Optional(Type.String({ description: "The ROS2 service type (e.g., 'gazebo_msgs/srv/SpawnEntity')" })),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "The service request arguments",
      })),
    }),

    async execute(_toolCallId, params) {
      const rawService = params["service"] as string;
      const service = toNamespacedTopic(config, rawService);
      const type = params["type"] as string | undefined;
      const args = params["args"] as Record<string, unknown> | undefined;

      const transport = getTransport();
      const response = await transport.callService({ service, type, args });

      const result = {
        success: response.result,
        service,
        response: response.values,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
