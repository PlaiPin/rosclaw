import { callService } from "@rosclaw/rosbridge-client";
import type { OpenClawPluginAPI } from "../../index.js";
import { getRosbridgeClient } from "../service.js";

/**
 * Register the ros2_service_call tool with the AI agent.
 * Allows calling any ROS2 service.
 */
export function registerServiceTool(api: OpenClawPluginAPI): void {
  api.registerTool({
    name: "ros2_service_call",
    description:
      "Call a ROS2 service and return the response. Use this for request/response operations " +
      "like setting parameters, triggering behaviors, or querying node state.",
    parameters: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description: "The ROS2 service name (e.g., '/spawn_entity')",
        },
        type: {
          type: "string",
          description: "The ROS2 service type (e.g., 'gazebo_msgs/srv/SpawnEntity')",
        },
        args: {
          type: "object",
          description: "The service request arguments",
        },
      },
      required: ["service"],
    },

    async execute(params: { service: string; type?: string; args?: Record<string, unknown> }) {
      // TODO: Implement full service call with error handling
      const client = getRosbridgeClient();
      const response = await callService(client, params.service, params.args, params.type);
      return {
        success: response.result,
        service: params.service,
        response: response.values,
      };
    },
  });
}
