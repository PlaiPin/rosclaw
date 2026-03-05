# RosClaw

> [!IMPORTANT]
> **This project is undergoing a major re-architecture and migration to separate repos.** Check back soon for updates, or reach out on X [@irvinxyz](https://x.com/irvinxyz) to follow along.

**Natural language control of ROS2 robots through messaging apps, powered by AI agents.**

RosClaw connects [OpenClaw](https://github.com/openclaw) to [ROS2](https://docs.ros.org/) (the Robot Operating System) through an intelligent plugin layer. Send a message on Telegram, WhatsApp, Discord, or Slack — the robot moves. Connect to your own robot or "lease" any robot registered into our portal globally. Each robot registers their own profile with capabilitie.

Whethere it's a cute desk robot or a humanoid robot, all you have to do is install our OpenClaw extension and run our ROS2 packakge.

<p align="center">
  <a href="https://x.com/livinoffwater/status/2017172436119331133">
    <img src="assets/thumbnail-1.jpg" alt="RosClaw Demo Video" width="380" />
  </a>
  &nbsp;&nbsp;
  <a href="">
    <img src="assets/thumbnail-2.jpg" alt="RosClaw Demo" width="380" />
  </a>
  <br />
  <em>Click to watch the demos</em>
</p>

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

### Run without ROS installed (Docker + OpenClaw on your machine)

If you don’t have ROS on your host (e.g. macOS with only OpenClaw and Docker):

1. **Start the simulation in Docker** (from the repo root):
   ```bash
   cd docker
   docker compose up ros2
   ```
   This runs ROS2, rosbridge, and Gazebo in a container and exposes rosbridge at `localhost:9090`.

2. **Build the RosClaw plugin** (in the repo root):
   ```bash
   pnpm install
   pnpm build
   ```

3. **Install the plugin into OpenClaw** from the local path:
   ```bash
   openclaw plugins install -l ./extensions/openclaw-plugin
   ```
   Use the path to your cloned `rosclaw` repo (e.g. `/Users/you/Projects/rosclaw/extensions/openclaw-plugin` if needed).

4. **Configure the plugin** in OpenClaw with rosbridge URL **`ws://localhost:9090`** (this is the default).

5. Start OpenClaw and use your configured messaging channel; the plugin will talk to the simulation in Docker over WebSocket.

### Run on your own robot (Ubuntu + ROS2)

**New robot?** Use the onboarding wizard: `./scripts/onboard_robot.sh` (run from the repo root). It guides you through robot-side and/or gateway-side setup.

For manual steps, see **[Robot Setup Guide](docs/robot-setup.md)**. Quick path: `./scripts/setup_robot.sh` on the robot, `./scripts/setup_gateway_plugin.sh` where OpenClaw runs, then `./scripts/run_demo_native.sh` to start the bridges.

### Phase 3: Teleop Web App

When the gateway supports plugin HTTP routes, open the **teleop web app** in a browser for live camera and twist controls:

- **URL:** `http://<gateway-host>:<port>/rosclaw/teleop/` (e.g. `http://localhost:18789/rosclaw/teleop/`)
- Supports 2D webcam and RealSense; if multiple camera streams exist, choose the source from a dropdown.
- See [Teleop (Phase 3)](docs/teleop.md) for config and requirements.

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
