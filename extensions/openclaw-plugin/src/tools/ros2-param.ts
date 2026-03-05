import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { toNamespacedTopic } from "../topic-utils.js";
import { getTransport } from "../service.js";

/**
 * Register ros2_param_get and ros2_param_set tools with the AI agent.
 */
export function registerParamTools(api: OpenClawPluginApi, config: RosClawConfig): void {
  api.registerTool({
    name: "ros2_param_get",
    label: "ROS2 Get Parameter",
    description:
      "Get the value of a ROS2 parameter from a node. " +
      "Use this to check robot configuration values.",
    parameters: Type.Object({
      node: Type.String({ description: "The fully qualified node name (e.g., '/turtlebot3/controller')" }),
      parameter: Type.String({ description: "The parameter name (e.g., 'max_velocity')" }),
    }),

    async execute(_toolCallId, params) {
      const rawNode = params["node"] as string;
      const node = toNamespacedTopic(config, rawNode);
      const parameter = params["parameter"] as string;

      const transport = getTransport();
      const response = await transport.callService({
        service: `${node}/get_parameters`,
        type: "rcl_interfaces/srv/GetParameters",
        args: { names: [parameter] },
      });

      const result = {
        success: response.result,
        node,
        parameter,
        value: response.values,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });

  api.registerTool({
    name: "ros2_param_set",
    label: "ROS2 Set Parameter",
    description:
      "Set the value of a ROS2 parameter on a node. " +
      "Use this to change robot configuration at runtime.",
    parameters: Type.Object({
      node: Type.String({ description: "The fully qualified node name" }),
      parameter: Type.String({ description: "The parameter name" }),
      value: Type.Unknown({ description: "The new parameter value" }),
    }),

    async execute(_toolCallId, params) {
      const rawNode = params["node"] as string;
      const node = toNamespacedTopic(config, rawNode);
      const parameter = params["parameter"] as string;
      const value = params["value"];

      const transport = getTransport();
      const response = await transport.callService({
        service: `${node}/set_parameters`,
        type: "rcl_interfaces/srv/SetParameters",
        args: {
          parameters: [
            { name: parameter, value },
          ],
        },
      });

      const result = {
        success: response.result,
        node,
        parameter,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
