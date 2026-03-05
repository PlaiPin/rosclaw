# rosclaw_follow_me

ROS2 node for the **Follow Me** mission: person tracking and follower control. Publishes `geometry_msgs/Twist` to `cmd_vel` and advertises ROS2 services used by the RosClaw plugin. All Follow Me behavior is in-repo; RosClaw does not depend on external projects for this mission.

## Features

- Person detection via **RealSense** depth + **MediaPipe** Pose (or simple depth fallback / mock when unavailable).
- Follower controller maintains a configurable distance and publishes velocity commands to `cmd_vel`.
- ROS2 services: `follow_me/start`, `follow_me/stop`, `follow_me/set_distance`, `follow_me/get_status`, `follow_me/set_target`.

## Dependencies

- **ROS2** (Jazzy or compatible).
- **rosclaw_msgs** (from this workspace).
- Optional (for real camera + detection):
  - `pyrealsense2` — RealSense SDK.
  - `mediapipe` — pose detection.
  - `opencv-python` — image handling.
  - `numpy`

Without them, the node runs in mock mode (simulated person).

## Build

```bash
cd ros2_ws
colcon build --packages-select rosclaw_msgs rosclaw_follow_me
source install/setup.bash
```

## Run

```bash
ros2 run rosclaw_follow_me follow_me_node
```

**If you get "No executable found"** (e.g. on some boards), run the node as a module instead (from the same shell where you sourced the workspace):

```bash
source install/setup.bash
python3 -m rosclaw_follow_me
```

Parameters:

- `use_camera` (bool, default: true) — use RealSense when available; otherwise mock.
- `target_distance` (float, default: 1.0) — follow distance in meters.
- `cmd_vel_topic` (string, default: `cmd_vel`) — topic for Twist commands.

Example with custom topic (e.g. namespaced):

```bash
ros2 run rosclaw_follow_me follow_me_node --ros-args -p cmd_vel_topic:=robot_ns/cmd_vel
```

## Services

| Service | Type | Description |
|--------|------|-------------|
| `follow_me/start` | FollowMeStart | Start following (optional target description). |
| `follow_me/stop` | FollowMeStop | Stop following. |
| `follow_me/set_distance` | FollowMeSetDistance | Set target distance (m). |
| `follow_me/get_status` | FollowMeGetStatus | Get enabled, tracking, distances, twist. |
| `follow_me/set_target` | FollowMeSetTarget | Lock onto a person by description (closest match without VLM). |

The RosClaw plugin uses these via the **follow_robot** tool when the user says "follow me", "stop following", etc.
