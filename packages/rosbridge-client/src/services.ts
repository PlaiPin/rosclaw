import type { RosbridgeClient } from "./client.js";
import type { ServiceResponseMessage } from "./types.js";

/**
 * Call a ROS2 service via rosbridge.
 *
 * @param client - The rosbridge client instance
 * @param service - The service name (e.g., "/my_node/set_parameters")
 * @param args - The service request arguments
 * @param type - Optional service type
 * @returns The service response
 */
export async function callService(
  client: RosbridgeClient,
  service: string,
  args?: Record<string, unknown>,
  type?: string,
): Promise<ServiceResponseMessage> {
  // TODO: Implement service call
  // - Generate unique ID for this call
  // - Send call_service message
  // - Wait for service_response with matching ID
  // - Return the response (or throw on failure)
  const id = client.nextId("service");

  client.send({
    op: "call_service",
    id,
    service,
    args,
    type,
  });

  // TODO: Replace with actual response listener
  return {
    op: "service_response",
    id,
    service,
    values: {},
    result: true,
  };
}
