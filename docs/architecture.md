# RosClaw System Architecture

RosClaw supports three deployment modes depending on where OpenClaw runs
relative to the robot. The AI Gateway layer and ROS2 layer remain the same
across all modes — only the transport between them changes.

---

## AI Gateway Layer (common to all modes)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              MESSAGING LAYER                                     │
│                                                                                  │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│    │ WhatsApp │  │ Telegram │  │ Discord  │  │  Slack   │  │ Web Chat │        │
│    └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│         └──────────────┴──────┬─────┴──────────────┴─────────────┘               │
└───────────────────────────────┼──────────────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           AI GATEWAY LAYER                                       │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │                        OPENCLAW GATEWAY                                    │  │
│  │   ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────────┐     │  │
│  │   │   Sessions   │  │   AI Agent      │  │   Memory / State         │     │  │
│  │   │  (per-user)  │  │  (intent →      │  │  (cross-conversation)    │     │  │
│  │   │              │  │   tool calls)   │  │                          │     │  │
│  │   └──────────────┘  └───────┬─────────┘  └──────────────────────────┘     │  │
│  └─────────────────────────────┼─────────────────────────────────────────────┘  │
│                                ▼                                                 │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │                       ROSCLAW PLUGIN                                       │  │
│  │                                                                            │  │
│  │  ┌─────────────────────────────────────────────────────────────────────┐   │  │
│  │  │                    TOOL REGISTRY                                     │   │  │
│  │  │                                                                      │   │  │
│  │  │  ros2_publish    ros2_subscribe_once    ros2_service_call            │   │  │
│  │  │  ros2_action_goal   ros2_param_get/set  ros2_list_topics            │   │  │
│  │  │  ros2_camera_snapshot                                                │   │  │
│  │  └──────────────────────────────┬──────────────────────────────────────┘   │  │
│  │                                 │                                          │  │
│  │  ┌──────────────┐  ┌───────────▼──────────┐  ┌─────────────────────┐      │  │
│  │  │   SKILLS     │  │  SAFETY VALIDATOR    │  │  ROBOT CONTEXT      │      │  │
│  │  │              │  │                      │  │                     │      │  │
│  │  │ navigate-to  │  │ before_tool_call     │  │ before_agent_start  │      │  │
│  │  │ take-photo   │  │  · velocity limits   │  │  · capabilities    │      │  │
│  │  │ check-status │  │  · workspace bounds  │  │  · topics/services │      │  │
│  │  │ pick-object  │  │  · blocked ops       │  │  · safety config   │      │  │
│  │  └──────────────┘  └──────────┬───────────┘  └─────────────────────┘      │  │
│  │                               │                                            │  │
│  │  ┌────────────────────────────┤   ┌──────────────────────────────────┐     │  │
│  │  │  /estop COMMAND            │   │  TRANSPORT ADAPTER               │     │  │
│  │  │  (bypasses AI entirely)    │   │  (mode-dependent, see below)     │     │  │
│  │  └────────────────────────────┘   └──────────────┬───────────────────┘     │  │
│  └──────────────────────────────────────────────────┼────────────────────────┘  │
└─────────────────────────────────────────────────────┼────────────────────────────┘
                                                      │
                                                      ▼
                                          ┌───────────────────────┐
                                          │  Mode A, B, or C      │
                                          │  (see below)          │
                                          └───────────────────────┘
```

## ROS2 Layer (common to all modes)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              ROS2 LAYER                                          │
│                                                                                  │
│                           ROS2 DDS Bus                                           │
│         ┌──────────┬──────────┬──────────┬──────────┐                            │
│         ▼          ▼          ▼          ▼          ▼                            │
│  ┌────────────┐┌────────┐┌────────┐┌─────────┐┌──────────────┐                  │
│  │  /cmd_vel  ││ /odom  ││/camera ││/battery ││/diagnostics  │  ...             │
│  │  (Twist)   ││(Odom)  ││(Image) ││(State)  ││(DiagArray)   │                  │
│  └─────┬──────┘└───┬────┘└───┬────┘└────┬────┘└──────┬───────┘                  │
│        │           │         │          │            │                            │
│  ┌─────▼───────────▼─────────▼──────────▼────────────▼────────────────────┐      │
│  │                         ROBOT HARDWARE                                  │      │
│  │                                                                         │      │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │      │
│  │  │  Motors  │  │  Camera  │  │  LIDAR   │  │   IMU    │   ...         │      │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘               │      │
│  └─────────────────────────────────────────────────────────────────────────┘      │
│                                                                                   │
│  ┌─────────────────────────────────┐  ┌───────────────────────────────────┐       │
│  │  rosclaw_discovery              │  │  Nav2 / MoveIt2 / Other Stacks   │       │
│  │  (capability introspection)     │  │  (navigation, manipulation)       │       │
│  └─────────────────────────────────┘  └───────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Deployment Mode A: Same Machine

OpenClaw runs directly on the robot's computer. The plugin talks to ROS2
natively through the local DDS bus — no network transport needed. The user
only interacts through messaging apps over the internet.

Best for: single-robot setups, embedded deployments, edge devices with
internet access.

```
    User (Telegram, WhatsApp, etc.)
                 │
                 │  internet
                 ▼
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│                        ROBOT MACHINE                                     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  OPENCLAW + ROSCLAW PLUGIN                                        │  │
│  │                                                                    │  │
│  │  AI Agent → Safety Validator → Tool Execution                     │  │
│  └──────────────────────┬─────────────────────────────────────────────┘  │
│                         │                                                │
│                         │ direct (local DDS / rclnodejs)                 │
│                         ▼                                                │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  ROS2 DDS Bus                                                      │  │
│  │  /cmd_vel  /odom  /camera  /battery  /diagnostics  ...            │  │
│  └──────────────────────┬─────────────────────────────────────────────┘  │
│                         ▼                                                │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  ROBOT HARDWARE   (motors, camera, LIDAR, IMU)                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘

Transport: none (same process / local IPC)
Latency:   ~ms
NAT issue:  none — only outbound internet needed for messaging APIs
```

---

## Deployment Mode B: Local Network

OpenClaw runs on a separate machine on the same network as the robot
(e.g. a laptop, local server, or dev workstation). The plugin connects to
rosbridge_server on the robot via WebSocket over LAN.

Best for: development, testing, multi-robot labs, on-premises deployments
where everything is on the same network.

```
    User (Telegram, WhatsApp, etc.)
                 │
                 │  internet
                 ▼
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐     ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│  LOCAL SERVER / DEV MACHINE    │     │  ROBOT                          │
│                                │     │                                 │
│  ┌──────────────────────────┐  │     │  ┌───────────────────────────┐  │
│  │  OPENCLAW + ROSCLAW      │  │     │  │  rosbridge_server         │  │
│  │  PLUGIN                  │──┼─────┼─►│  (WebSocket → ROS2 DDS)   │  │
│  │                          │  │ LAN │  └─────────────┬─────────────┘  │
│  │  rosbridge-client lib    │  │ WS  │                │                │
│  └──────────────────────────┘  │     │                ▼                │
│                                │     │  ┌───────────────────────────┐  │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘     │  │  ROS2 DDS Bus             │  │
                                       │  │  /cmd_vel  /odom  ...     │  │
                                       │  └─────────────┬─────────────┘  │
                                       │                ▼                │
                                       │  ┌───────────────────────────┐  │
                                       │  │  ROBOT HARDWARE           │  │
                                       │  └───────────────────────────┘  │
                                       │                                 │
                                       └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘

Transport: WebSocket (ws://robot-ip:9090) via rosbridge protocol
Latency:   ~ms (LAN)
NAT issue:  none — both machines are on the same network
```

---

## Deployment Mode C: Cloud / Remote

OpenClaw runs on a cloud server or VPS. The robot is on a remote network
(factory, warehouse, field) behind NAT/firewall. Neither side can directly
reach the other. A WebRTC connection with STUN/TURN handles NAT traversal
so both sides can establish peer-to-peer communication.

Best for: production deployments, remote operations, fleet management,
when operators and robots are in different locations.

```
    User (Telegram, WhatsApp, etc.)
                 │
                 │  internet
                 ▼
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│  CLOUD / VPS                   │                  │  ROBOT (behind NAT/firewall)   │
│                                │                  │                                │
│  ┌──────────────────────────┐  │                  │  ┌──────────────────────────┐  │
│  │  OPENCLAW + ROSCLAW      │  │                  │  │  RosClaw Agent Node      │  │
│  │  PLUGIN                  │  │                  │  │  (ROS2 node)             │  │
│  │                          │  │                  │  │                          │  │
│  │  WebRTC data channel     │◄─┼── P2P or TURN ──┼─►│  WebRTC data channel     │  │
│  └──────────────────────────┘  │    (encrypted)   │  └────────────┬─────────────┘  │
│                                │                  │               │                │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                  │               │ local DDS      │
                                       ┌─────────┐ │               ▼                │
                                       │  STUN / │ │  ┌──────────────────────────┐  │
                                       │  TURN   │ │  │  ROS2 DDS Bus            │  │
                                       │  Server │ │  │  /cmd_vel  /odom  ...    │  │
                                       └─────────┘ │  └────────────┬─────────────┘  │
                                                    │               ▼                │
                                                    │  ┌──────────────────────────┐  │
                                                    │  │  ROBOT HARDWARE          │  │
                                                    │  └──────────────────────────┘  │
                                                    │                                │
                                                    └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘

Transport: WebRTC data channel (STUN for NAT traversal, TURN as relay fallback)
Latency:   ~10-100ms (internet, varies)
NAT issue:  solved — both sides connect outbound to STUN/TURN, then P2P
```

In Mode C, the robot runs a **RosClaw Agent Node** (`rosclaw_agent`) — a
lightweight ROS2 node that connects outbound to the signaling/TURN server
and establishes a WebRTC data channel with the cloud-side plugin. Commands
and feedback flow over this encrypted peer-to-peer channel. Neither side
needs a public IP or open inbound ports.

---

## Transport Adapter Abstraction

All plugin tools call `getTransport()` instead of directly using a specific
client library. The `RosTransport` interface (`@rosclaw/transport`) provides
a unified API for all three deployment modes:

```
  Plugin Tools (ros2_publish, ros2_subscribe_once, ...)
       │
       ▼
  getTransport(): RosTransport
       │
       ├── RosbridgeTransport  (Mode B — @rosclaw/rosbridge-client)
       │     └── WebSocket → rosbridge_server → ROS2 DDS
       │
       ├── LocalTransport      (Mode A — @rosclaw/transport-local, stub)
       │     └── rclnodejs → ROS2 DDS directly
       │
       └── WebRTCTransport     (Mode C — @rosclaw/transport-webrtc, stub)
             └── WebRTC data channel → rosclaw_agent → ROS2 DDS
```

The `createTransport(config)` factory in `@rosclaw/transport` uses dynamic
`import()` to load the correct adapter by mode, so unused adapters and their
dependencies are never loaded.

---

## Data Flow Example

```
  User (Telegram)                RosClaw                        Robot
       │                            │                              │
       │  "Move forward 2 meters"   │                              │
       │───────────────────────────►│                              │
       │                            │                              │
       │              AI Agent selects ros2_publish                │
       │              Safety hook validates (0.5 m/s < 1.0 limit) │
       │                            │                              │
       │                            │  publish /cmd_vel            │
       │                            │─────────────────────────────►│
       │                            │  (via Mode A, B, or C)       │  Motors
       │                            │                              │  engage
       │                            │  subscribe /odom             │
       │                            │◄─────────────────────────────│
       │                            │                              │
       │  "Done! Moved 2m forward"  │                              │
       │◄───────────────────────────│                              │
       │                            │                              │
```
