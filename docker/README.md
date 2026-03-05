# RosClaw Docker Stack

Run ROS2, rosbridge, and (optionally) Gazebo simulation in containers so you don’t need ROS installed on your host.

## Quick start (no ROS on host)

From the **repository root**:

```bash
cd docker
docker compose up ros2
```

Then use OpenClaw on your machine with the RosClaw plugin pointing at **`ws://localhost:9090`**. See the main [README](../README.md) section **“Run without ROS installed”** for plugin install and config.

## What runs

| Service | Purpose |
|--------|---------|
| **ros2** | ROS2 Jazzy + rosbridge WebSocket (port 9090) + Gazebo + TurtleBot3. Use this when you run OpenClaw on the host. |
| **rosclaw** | Pre-built plugin image for containerized OpenClaw; optional if you run OpenClaw locally. |

## Ports

- **9090** — rosbridge WebSocket (plugin connects here)
- **11311** — ROS master (if needed by tools)

## Build

Images are built on first `docker compose up`. To rebuild:

```bash
docker compose build
```

The `ros2` image is built from the repo root so it can include `ros2_ws` and the entrypoint script.
