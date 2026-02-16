# RosClaw

**Natural language control of ROS2 robots through messaging apps, powered by AI agents.**

RosClaw connects [OpenClaw](https://github.com/openclaw) (a self-hosted AI gateway for messaging apps) to [ROS2](https://docs.ros.org/) (the Robot Operating System) through an intelligent plugin layer. Send a message on WhatsApp, Telegram, Discord, or Slack — the robot moves.

## How It Works

```
User (WhatsApp/Telegram/Discord/Slack)
        |
        v
OpenClaw Gateway (AI Agent + Tools + Memory)
        |
        v  RosClaw Plugin
rosbridge_server (WebSocket)
        |
        v  ROS2 DDS
Robots: Nav2, MoveIt2, cameras, sensors
```

1. A user sends a natural language message through any messaging app
2. OpenClaw's AI agent receives the message and uses ROS2 tools registered by the RosClaw plugin
3. The agent translates intent into ROS2 operations (topic publish, service call, action goal)
4. The robot acts, and the agent streams feedback back to the chat

## Project Structure

```
rosclaw/
├── packages/
│   └── rosbridge-client/         # @rosclaw/rosbridge-client — TypeScript rosbridge WebSocket client
├── extensions/
│   ├── openclaw-plugin/          # @rosclaw/openclaw-plugin — Core OpenClaw extension
│   └── openclaw-canvas/          # @rosclaw/openclaw-canvas — Real-time dashboard (Phase 3)
├── ros2_ws/src/
│   ├── rosclaw_discovery/        # ROS2 capability auto-discovery node
│   └── rosclaw_msgs/             # Custom ROS2 message/service definitions
├── docker/                       # Docker Compose stack
└── examples/                     # Demo projects
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for simulation)

### Install & Build

```bash
pnpm install
pnpm build
```

### Run the Demo Stack

```bash
cd docker
docker compose up
```

This starts ROS2 + rosbridge + Gazebo. Then configure your OpenClaw instance to use the RosClaw plugin with `ws://localhost:9090`.

### Try It

Send a message to your robot:
- **"Move forward 1 meter"** — publishes velocity to `/cmd_vel`
- **"Navigate to the kitchen"** — sends a Nav2 goal
- **"What do you see?"** — captures a camera frame
- **"Check the battery"** — reads `/battery_state`
- **`/estop`** — emergency stop (bypasses AI)

## Packages

| Package | Description |
|---|---|
| [`@rosclaw/rosbridge-client`](packages/rosbridge-client/) | Standalone TypeScript client for the rosbridge WebSocket protocol |
| [`@rosclaw/openclaw-plugin`](extensions/openclaw-plugin/) | OpenClaw extension: tools, hooks, skills, commands for ROS2 control |
| [`@rosclaw/openclaw-canvas`](extensions/openclaw-canvas/) | Real-time robot dashboard (Phase 3) |
| [`rosclaw_discovery`](ros2_ws/src/rosclaw_discovery/) | ROS2 Python node for capability auto-discovery |
| [`rosclaw_msgs`](ros2_ws/src/rosclaw_msgs/) | Custom ROS2 message/service definitions |

## Agent Tools

The AI agent has access to these ROS2 tools:

| Tool | Description |
|---|---|
| `ros2_publish` | Publish messages to any ROS2 topic |
| `ros2_subscribe_once` | Read the latest message from a topic |
| `ros2_service_call` | Call a ROS2 service |
| `ros2_action_goal` | Send action goals with feedback (Phase 2) |
| `ros2_param_get/set` | Get/set ROS2 node parameters |
| `ros2_list_topics` | Discover available topics |
| `ros2_camera_snapshot` | Capture a camera frame |

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm typecheck        # Type-check without emitting
pnpm clean            # Remove build artifacts
```

## License

Apache-2.0
