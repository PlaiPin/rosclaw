import type { OpenClawPluginAPI } from "../../index.js";
import { getRosbridgeClient } from "../service.js";
import { callService } from "@rosclaw/rosbridge-client";

/**
 * Register ros2_param_get and ros2_param_set tools with the AI agent.
 */
export function registerParamTools(api: OpenClawPluginAPI): void {
  api.registerTool({
    name: "ros2_param_get",
    description:
      "Get the value of a ROS2 parameter from a node. " +
      "Use this to check robot configuration values.",
    parameters: {
      type: "object",
      properties: {
        node: {
          type: "string",
          description: "The fully qualified node name (e.g., '/turtlebot3/controller')",
        },
        parameter: {
          type: "string",
          description: "The parameter name (e.g., 'max_velocity')",
        },
      },
      required: ["node", "parameter"],
    },

    async execute(params: { node: string; parameter: string }) {
      // TODO: Implement parameter get via service call
      // Uses the /{node}/get_parameters service
      const client = getRosbridgeClient();
      const response = await callService(
        client,
        `${params.node}/get_parameters`,
        { names: [params.parameter] },
        "rcl_interfaces/srv/GetParameters",
      );
      return {
        success: response.result,
        node: params.node,
        parameter: params.parameter,
        value: response.values,
      };
    },
  });

  api.registerTool({
    name: "ros2_param_set",
    description:
      "Set the value of a ROS2 parameter on a node. " +
      "Use this to change robot configuration at runtime.",
    parameters: {
      type: "object",
      properties: {
        node: {
          type: "string",
          description: "The fully qualified node name",
        },
        parameter: {
          type: "string",
          description: "The parameter name",
        },
        value: {
          description: "The new parameter value",
        },
      },
      required: ["node", "parameter", "value"],
    },

    async execute(params: { node: string; parameter: string; value: unknown }) {
      // TODO: Implement parameter set via service call
      // Uses the /{node}/set_parameters service
      const client = getRosbridgeClient();
      const response = await callService(
        client,
        `${params.node}/set_parameters`,
        {
          parameters: [
            { name: params.parameter, value: params.value },
          ],
        },
        "rcl_interfaces/srv/SetParameters",
      );
      return {
        success: response.result,
        node: params.node,
        parameter: params.parameter,
      };
    },
  });
}
