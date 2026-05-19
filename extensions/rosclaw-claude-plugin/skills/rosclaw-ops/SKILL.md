---
name: rosclaw-ops
description: Use when operating or inspecting ROS2 robots through the RosClaw MCP tools in Claude Code.
---

# RosClaw Operations

Use the RosClaw MCP tools for ROS2 robot access. Prefer read-only discovery before any state-changing operation.

## Workflow

1. Check transport health with `ros2_transport_status`.
2. Discover the graph with `ros2_list_topics`, `ros2_list_services`, `ros2_list_actions`, or `ros2_list_nodes`.
3. Inspect exact interfaces before sending structured data:
   - Topics: `ros2_topic_info`, then `ros2_message_schema`.
   - Services: `ros2_service_info`, then `ros2_service_schema`.
   - Actions: `ros2_action_info`, then `ros2_action_schema`.
4. Dry-run safety with `ros2_validate_tool_call` before write-capable calls.
5. Prefer simulator validation before controlling real hardware.

## Safety Rules

- Treat `ros2_publish`, `ros2_param_set`, `ros2_service_call`, `ros2_action_goal`, and `ros2_cancel_action_goal` as write-capable.
- Do not bypass RosClaw safety failures.
- Keep velocity commands bounded and short-lived.
- Confirm coordinate frames and workspace limits before navigation goals.
- If schema, frame, or topic semantics are unclear, stop and inspect instead of guessing.
