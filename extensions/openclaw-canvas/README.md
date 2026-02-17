# @rosclaw/openclaw-canvas

Real-time robot dashboard via OpenClaw's Canvas/A2UI system.

**Status: Phase 3 — not yet implemented.**

## Why This Exists

The primary RosClaw interface is chat (WhatsApp, Telegram, Discord, Slack). Chat works well for supervisory and mission-level commands ("navigate to the kitchen", "check the battery"), but some use cases need more than text:

- **Live camera feeds** — streaming video doesn't fit in a message thread
- **Real-time telemetry** — continuously updating sensor data, battery, IMU
- **Teleoperation** — joystick-style control requiring low-latency, high-frequency updates (>10Hz)
- **Map visualization** — SLAM maps with live robot position overlay

The canvas extension supplements the chat interface with a web-based dashboard rendered through OpenClaw's Canvas/A2UI system — a web frontend that connects to the OpenClaw gateway and lets plugins define rich interactive UI.

## How It Would Work

OpenClaw's gateway is a WebSocket server. Messaging apps connect on one side, but it also exposes a typed RPC protocol. Plugins can register custom RPC methods via `api.registerGatewayMethod()` that any client (including a web dashboard) can call.

The canvas extension would consume robot data through the **main RosClaw plugin**, which already owns the rosbridge connection and manages the transport lifecycle. Rather than opening a second connection to rosbridge, the canvas calls gateway methods that the main plugin exposes.

```
Browser (dashboard)
    │
    └── WebSocket to OpenClaw Gateway
            │
            ├── Canvas/A2UI renderer (UI panels defined by this extension)
            │
            └── Gateway methods (registered by @rosclaw/openclaw-plugin)
                    │
                    └── rosbridge transport (single managed connection)
                            │
                            └── ROS2 DDS → Robots
```

### Why not connect to rosbridge directly?

The original design had a standalone `@rosclaw/rosbridge-client` package that both the main plugin and canvas would import independently. That package was collapsed into the main plugin's internal `src/transport/` during refactoring — the transport code is no longer shared.

Two options exist for Phase 3:

| Approach | Pros | Cons |
|----------|------|------|
| **Gateway-only** — canvas calls gateway methods exposed by the main plugin | Single rosbridge connection; auth/safety handled in one place; simpler | All data funneled through the gateway; potential bottleneck for high-frequency streams |
| **Re-extract shared transport** — pull rosbridge client back into `packages/rosbridge-client/` | Direct browser-to-rosbridge for low-latency streams (camera, telemetry) | Two connections to manage; duplicated auth; canvas bypasses safety hooks |

The gateway-only approach is the likely starting point. If latency becomes an issue for camera feeds or teleoperation, the transport can be re-extracted later.

### Example gateway methods the main plugin would register

| Method | Description |
|--------|-------------|
| `rosclaw.listTopics` | Return discovered topics, services, actions |
| `rosclaw.subscribe` | Open a streaming subscription to a topic |
| `rosclaw.getCamera` | Grab a camera frame and return it |
| `rosclaw.getRobotState` | Current robot pose, battery, diagnostics |
| `rosclaw.sendVelocity` | Teleoperation velocity commands (pass through safety hooks) |

## Planned Features

- Live camera stream viewer
- Sensor telemetry panels (battery, IMU, LIDAR)
- 2D map with robot position (Nav2 integration)
- Virtual joystick for direct teleoperation
- Action progress visualization (navigation goals, arm trajectories)

## Current State

The extension registers with OpenClaw but does nothing:

```typescript
export function register(api) {
  api.log.info("RosClaw Canvas extension loaded (Phase 3 — not yet implemented)");
}
```

## Prerequisites

Before implementing this extension, the main `@rosclaw/openclaw-plugin` needs to register gateway methods (see [Issue #10](../docs/openclaw-plugin-review.md) — currently deferred).
