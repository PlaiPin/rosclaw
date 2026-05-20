# RosClaw Claude Code Plugin

This plugin connects Claude Code to RosClaw through the existing MCP stdio server.
It contributes:

- a Claude Code plugin manifest
- an MCP server entry named `rosclaw`
- a `rosclaw-ops` skill for safe ROS2 inspection and operation workflows

## Prerequisites

Build the RosClaw MCP server from the repository root:

```bash
pnpm install
pnpm --filter @rosclaw/rosclaw-codex-mcp-server build
```

Start ROS2 and `rosbridge_server` so the configured URL is reachable. The default
URL is `ws://localhost:9090`.

## Use Locally

From the RosClaw repository root:

```bash
claude --plugin-dir ./extensions/rosclaw-claude-plugin
```

Then verify the plugin and MCP server from Claude Code:

```text
/plugin
/mcp
```

By default the plugin enables RosClaw safety `readonlyMode`. Disable it only for
simulators or controlled robot sessions with an explicit safety config.

## Configuration

The plugin prompts for:

- `rosbridge_url`: rosbridge WebSocket URL
- `readonly_mode`: whether write-capable ROS tools are blocked

For non-standard checkouts, set `ROSCLAW_MCP_SERVER_PATH` to the built server:

```bash
export ROSCLAW_MCP_SERVER_PATH=/path/to/rosclaw/extensions/rosclaw-codex-mcp-server/dist/index.js
```
