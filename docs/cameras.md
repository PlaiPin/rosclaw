# Camera Support

The RosClaw plugin’s **ros2_camera_snapshot** tool captures a single frame from any ROS2 image topic and returns it as base64 for display in chat. With **Zenoh** (Mode D), the plugin decodes `sensor_msgs/msg/Image` and `sensor_msgs/msg/CompressedImage` from CDR; no rosbridge is required.

**After updating the plugin** (e.g. pulling code that adds Image/CompressedImage over Zenoh), **restart the OpenClaw gateway** so it loads the new code: `openclaw gateway restart`. Otherwise the assistant may still report “CDR subscribe not implemented for Image/CompressedImage”.

## Message types

- **CompressedImage** (`sensor_msgs/msg/CompressedImage`) — JPEG/PNG topics (e.g. `/camera/image_raw/compressed`). Default.
- **Image** (`sensor_msgs/msg/Image`) — Raw image topics. Use parameter `message_type: "Image"` for raw RGB or depth.

## RealSense (realsense-ros)

The [RealSense ROS2 wrapper](https://github.com/realsenseai/realsense-ros) publishes standard ROS2 topics. RosClaw supports them via `ros2_camera_snapshot` with the appropriate topic and message type.

| Use case | Topic | message_type |
|----------|--------|----------------|
| Color (compressed) | `/camera/camera/color/image_raw/compressed` | CompressedImage (default) |
| Color (raw) | `/camera/camera/color/image_raw` | Image |
| Depth | `/camera/camera/depth/image_rect_raw` | Image |
| Aligned depth to color | `/camera/camera/aligned_depth_to_color/image_raw` | Image |

Default namespace/name in realsense-ros is `camera`/`camera`; if you launch with `camera_namespace` or `camera_name`, adjust the topic prefix (e.g. `/robot1/D455_1/color/image_raw`).

### Example (Natural language)

- “What do you see?” → agent uses `ros2_camera_snapshot` with default or discovered color topic.
- For RealSense color: topic `/camera/camera/color/image_raw`, `message_type: Image`.
- For RealSense depth: topic `/camera/camera/depth/image_rect_raw`, `message_type: Image`.

Discovery: use **ros2_list_topics** to list available topics, then choose the correct topic and message type for the snapshot.

### Zenoh + robot namespace

When using Zenoh with **robot.namespace** set (e.g. for cmd_vel), camera topics are usually **not** under that namespace—they stay under `/camera/...`. The plugin now includes camera topics in discovery and defaults **ros2_camera_snapshot** to `/camera/camera/color/image_raw/compressed` (RealSense). To override, set **robot.cameraTopic** in the plugin config to your camera topic (e.g. `/camera/camera/color/image_raw/compressed`).
