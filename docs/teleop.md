# Phase 3: Teleop Web App

The RosClaw plugin can serve a **remote teleop web page** (Phase 3) when the OpenClaw gateway exposes HTTP route registration. The page provides:

- **Live camera** — stream from a ROS2 Image/CompressedImage topic (2D webcam or RealSense)
- **Camera source selector** — when multiple camera streams are available, choose which one to view
- **Twist controls** — Forward, Back, Left, Right, Stop, and a speed slider

The same page works with **Zenoh**, **rosbridge**, **local**, and **webrtc** transport modes.

## Opening the teleop page

1. Ensure the OpenClaw gateway is running with the RosClaw plugin loaded and **transport connected** (so camera and cmd_vel topics are available).
2. In a browser, open (use **no space** between host and path):
   ```
   http://127.0.0.1:18789/rosclaw/teleop/
   ```
   Or use your gateway host and the port you use for the OpenClaw web UI. Path must be exactly `/rosclaw/teleop/` with a trailing slash.

3. The page loads the camera source list and shows the first available stream. Use the **Speed** slider and the **Fwd / Back / Left / Right / Stop** buttons to drive the robot.

**If you see the OpenClaw chat dashboard instead of the teleop page:**

- **Wrong URL**: Use the URL with **no space** (e.g. `http://127.0.0.1:18789/rosclaw/teleop/`). A typo like `...18789/ /rosclaw/teleop` will hit the main app and show the chat.
- **Plugin routes not registered**: Check gateway logs. If you see `RosClaw teleop: registerHttpRoute not available, skipping routes`, your OpenClaw build does not expose plugin HTTP routes, so `/rosclaw/teleop/` is never registered and the server serves the main app for that path.
- **Wrong port**: Use the same port as the OpenClaw web UI (the port where the gateway’s HTTP server listens).

**Diagnostic:** Open **`http://127.0.0.1:18789/rosclaw/teleop/ping`**. If you see JSON `{"ok":true,"rosclaw":"teleop"}`, plugin routes are active (then try `/rosclaw/teleop/index.html`). If you see the chat UI, the gateway is not routing to the plugin. Check logs for `RosClaw teleop routes registered` vs `registerHttpRoute not available`. Use an OpenClaw build that supports plugin HTTP routes (e.g. v2026.2.15+).


## Requirements

- The gateway must support **plugin HTTP routes** (`registerHttpRoute`). If not available, the plugin skips teleop route registration and logs: `RosClaw teleop: registerHttpRoute not available, skipping routes`.
- At least one **camera topic** of type `sensor_msgs/msg/Image` or `sensor_msgs/msg/CompressedImage` (for the camera endpoint we use CompressedImage; raw Image topics return 501 with a hint to use a compressed topic).
- **cmd_vel** must be published to the robot (same as chat teleop); configure `robot.namespace` or `teleop.cmdVelTopic` if your robot uses a namespaced cmd_vel.

## Config (optional)

In the RosClaw plugin config you can set:

| Key | Description |
|-----|-------------|
| `teleop.cameraTopic` | Default camera topic when only one source or as default selection. Falls back to `robot.cameraTopic` then RealSense default. |
| `teleop.cameraTopics` | Explicit list of `{ topic, label? }` for the source selector; if empty, sources are derived from `listTopics()` filtered by Image/CompressedImage. |
| `teleop.cmdVelTopic` | Override for cmd_vel topic (default from robot namespace). |
| `teleop.speedDefault` | Default linear speed (0.1–2 m/s). |
| `teleop.cameraPollMs` | Camera poll interval in ms (50–2000). |

## API (for reference)

| Route | Method | Description |
|-------|--------|-------------|
| `/rosclaw/teleop/` | GET | Teleop web page (HTML). |
| `/rosclaw/teleop/ping` | GET | Diagnostic: returns `{"ok":true,"rosclaw":"teleop"}` if plugin routes are active. |
| `/rosclaw/teleop/sources` | GET | JSON array of `{ topic, label? }` camera sources. |
| `/rosclaw/teleop/camera` | GET | Latest frame as image/jpeg (or image/png). Query: `topic`, optional `type=compressed`. |
| `/rosclaw/teleop/twist` | POST | Publish twist. Body: `{ linear_x?, linear_y?, linear_z?, angular_x?, angular_y?, angular_z? }`. Safety limits are applied. |
