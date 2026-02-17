# RosClaw

## What This Is

RosClaw is a ROS2 + OpenClaw integration that enables natural language control of robots through messaging apps (WhatsApp, Telegram, Discord, Slack). An AI agent translates user intent into ROS2 commands via the rosbridge WebSocket protocol.

## Architecture

```
User (messaging app) → OpenClaw Gateway → RosClaw Plugin → rosbridge_server → ROS2 robots
```

### Key Components

| Component | Path | Purpose |
|---|---|---|
| `@rosclaw/openclaw-plugin` | `extensions/openclaw-plugin/` | OpenClaw extension: tools, hooks, services, commands |
| `@rosclaw/openclaw-canvas` | `extensions/openclaw-canvas/` | Real-time dashboard (Phase 3 — not yet implemented) |
| `rosclaw_discovery` | `ros2_ws/src/rosclaw_discovery/` | ROS2 node for capability auto-discovery |
| `rosclaw_msgs` | `ros2_ws/src/rosclaw_msgs/` | Custom ROS2 message/service definitions |
| `rosclaw_agent` | `ros2_ws/src/rosclaw_agent/` | ROS2 agent node for WebRTC ↔ DDS bridge (Mode C robot-side) |

### Transport Layer

The transport abstraction lives inside the plugin at `extensions/openclaw-plugin/src/transport/`. It supports three modes:

| Mode | Adapter | Description |
|---|---|---|
| `rosbridge` (default) | `transport/rosbridge/` | WebSocket to rosbridge_server (Mode B) |
| `local` | `transport/local/` | Direct DDS on same machine (Mode A — stub) |
| `webrtc` | `transport/webrtc/` | WebRTC data channel via signaling server (Mode C — stub) |

## Monorepo Structure

- **`extensions/`** — OpenClaw plugin extensions (pnpm workspaces)
- **`ros2_ws/`** — ROS2 colcon workspace
- **`docker/`** — Docker Compose and Dockerfiles
- **`examples/`** — Demo projects
- **`docs/`** — Architecture and design docs

## Key Commands

```bash
pnpm install          # Install all dependencies
pnpm typecheck        # Type-check all packages
```

## Conventions

- **ESM-only**: All packages use `"type": "module"`
- **TypeScript strict mode**: `ES2022` target, `NodeNext` module resolution
- **jiti-loaded**: OpenClaw loads plugin `.ts` source directly at runtime — no build step
- **pnpm workspaces**: Workspace root covers `extensions/*`
- **npm scope**: `@rosclaw/`
- **ROS2 package prefix**: `rosclaw_`
- **Config validation**: Zod schemas in `src/config.ts`, parsed once in `register()`
- **Stub pattern**: Unimplemented code has `// TODO:` markers with proper type signatures

## Tech Stack

- TypeScript (ESM, strict)
- pnpm workspaces
- Zod (config validation)
- ROS2 Jazzy Jalisco
- rosbridge_suite (WebSocket bridge to ROS2)
- OpenClaw plugin API
- Docker / Docker Compose
