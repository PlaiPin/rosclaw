# Codex MCP Server Plan

## Goal

Expose RosClaw to Codex through a local MCP stdio server. Codex should call
controlled ROS tools through MCP instead of running arbitrary `ros2` shell
commands.

Target flow:

```text
Codex
  -> MCP stdio server
  -> RosClaw transport
  -> rosbridge / local DDS / WebRTC
  -> ROS 2 robot
```

The MCP server should be reusable by other MCP-capable agents later, but Codex
is the first target platform.

## Scope

Current implementation scope:

- Add a new MCP server package.
- Reuse existing RosClaw transport code.
- Expose the existing RosClaw ROS tools through MCP.
- Guard write-capable tools with the shared RosClaw safety policy.

Out of scope for the current implementation:

- Web dashboard or Canvas integration.
- Replacing the existing OpenClaw plugin.
- Non-rosbridge transports in the Codex MCP server. The MCP server currently
  supports `rosbridge` first.

## Package Location

Use a Codex-focused package name for the first implementation:

```text
extensions/rosclaw-codex-mcp-server/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

The server still speaks standard MCP over stdio, so the implementation can be
generalized later if another MCP-capable agent needs the same ROS access.

## First-Phase Tools

Expose all existing RosClaw ROS tools:

| MCP Tool | Purpose | Existing RosClaw equivalent |
|---|---|---|
| `ros2_publish` | Publish a ROS message after safety validation | `ros2_publish` |
| `ros2_list_topics` | Discover ROS topics and message types | `ros2_list_topics` |
| `ros2_subscribe_once` | Read one message from a topic | `ros2_subscribe_once` |
| `ros2_param_get` | Read a ROS parameter | `ros2_param_get` |
| `ros2_param_set` | Set a ROS parameter after safety validation | `ros2_param_set` |
| `ros2_camera_snapshot` | Read one compressed camera frame | `ros2_camera_snapshot` |
| `ros2_service_call` | Call a ROS service after safety validation | `ros2_service_call` |
| `ros2_action_goal` | Send a ROS action goal after safety validation | `ros2_action_goal` |

Read-only tools can inspect robot state. Write-capable tools are exposed but
must pass RosClaw safety validation before they reach ROS.

## Code Reuse

The MCP server should reuse the current plugin internals instead of creating a
parallel ROS client stack:

```text
extensions/openclaw-plugin/src/transport/
extensions/openclaw-plugin/src/config.ts
extensions/openclaw-plugin/src/safety/validator.ts
```

Shared safety validation:

- `safety/validator.ts` exports `validateRosToolCall(...)`.
- OpenClaw hooks and Codex MCP tool handlers both call the same policy path.
- Keep the same allowlist, blocklist, readonly, velocity, and workspace rules.

Suggested shape:

```ts
validateRosToolCall({
  toolName,
  params,
  safety,
}): string | null
```

Return `null` when allowed, or a human-readable block reason when denied.

## Transport Configuration

Default first-phase transport should be `rosbridge`, because it is easiest to
run from Codex without sourcing a ROS workspace:

```text
ROSCLAW_TRANSPORT_MODE=rosbridge
ROSCLAW_ROSBRIDGE_URL=ws://localhost:9090
```

Optional full config override:

```bash
ROSCLAW_CONFIG_JSON='{"safety":{"readonlyMode":true}}'
```

Environment variables override matching fields in `ROSCLAW_CONFIG_JSON` for
transport and rosbridge connection settings.

Later phases can support:

- `local`: direct DDS through `rclnodejs`.
- `webrtc`: remote robot access through the existing RosClaw WebRTC transport.

## Codex Registration

Codex should launch the server as a local MCP stdio process.

Expected command after build:

```bash
node extensions/rosclaw-codex-mcp-server/dist/index.js
```

Example MCP server configuration:

```json
{
  "mcpServers": {
    "rosclaw": {
      "command": "node",
      "args": ["extensions/rosclaw-codex-mcp-server/dist/index.js"],
      "env": {
        "ROSCLAW_TRANSPORT_MODE": "rosbridge",
        "ROSCLAW_ROSBRIDGE_URL": "ws://localhost:9090"
      }
    }
  }
}
```

The exact Codex config file location depends on the Codex runtime being used;
the server command and environment should stay the same.

## Security Rules

Safety posture:

- Do not expose shell access through MCP.
- Do not pass through arbitrary ROS operations.
- Do not bypass RosClaw config parsing.
- Treat camera frames and robot state as potentially sensitive data.
- `readonlyMode` must be enforced.
- `allowedTopics`, `allowedServices`, and `allowedActions` must be enforced.
- `blockedTopics` must override topic allowlists.
- `requireConfirmationFor` must block write targets until a confirmation flow
  exists.
- Velocity and workspace checks must run for motion-related commands.

## Implementation Steps

1. Create `extensions/rosclaw-codex-mcp-server/`.
2. Add TypeScript build config and package metadata.
3. Add MCP SDK dependency.
4. Implement startup config parsing using `RosClawConfigSchema`.
5. Create and connect the RosClaw transport.
6. Register read-only tools:
   `ros2_list_topics`, `ros2_subscribe_once`, `ros2_param_get`, and
   `ros2_camera_snapshot`.
7. Validate with Codex against a running rosbridge server.
8. Extract reusable safety validation.
9. Register write-capable tools:
   `ros2_publish`, `ros2_param_set`, `ros2_service_call`, and
   `ros2_action_goal`.
10. Validate that write-capable tools are blocked or allowed according to
    safety config.

## Validation Plan

Minimum validation for phase one:

```bash
pnpm --filter @rosclaw/rosclaw-codex-mcp-server build
pnpm --filter @rosclaw/rosclaw-codex-mcp-server typecheck
```

Runtime validation:

1. Start ROS 2 and rosbridge.
2. Start the MCP server with `ROSCLAW_ROSBRIDGE_URL=ws://localhost:9090`.
3. Register the MCP server in Codex.
4. Ask Codex to list ROS topics.
5. Ask Codex to read one safe topic such as `/odom` or `/battery_state`.

Validate write tools only with constrained safety config and a simulator or
safe test ROS graph.

## Open Questions

- Which exact Codex MCP config location should this repository document?
- Should the MCP server live under `extensions/` or a future `packages/`
  workspace?
- Should read-only topic access also use `allowedTopics`, or should allowlists
  apply only to write operations?
- Should camera snapshots return raw base64 data, a temporary file path, or a
  reduced metadata response for Codex?
