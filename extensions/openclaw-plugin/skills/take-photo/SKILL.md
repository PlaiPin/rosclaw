# Take Photo

## When to Use

Use this skill when the user wants to see what the robot sees. **Always call the tool**—do not assume the transport cannot decode camera topics; RosClaw supports Image and CompressedImage over Zenoh and rosbridge.
- "What do you see?"
- "Take a photo"
- "Show me the camera"
- "Send me a picture"

## Steps

1. **Capture image**: Use `ros2_camera_snapshot` to grab a frame from the camera topic.
2. **Return the image**: The tool returns the image data which will be displayed inline in the chat.

## Examples

**Default / compressed:**
```
Tool: ros2_camera_snapshot
Topic: /camera/image_raw/compressed
```

**RealSense color (raw Image):**
```
Tool: ros2_camera_snapshot
Topic: /camera/camera/color/image_raw
message_type: Image
```

**RealSense depth (raw Image):**
```
Tool: ros2_camera_snapshot
Topic: /camera/camera/depth/image_rect_raw
message_type: Image
```

## Tips

- Default camera topic is `/camera/image_raw/compressed` (CompressedImage). Use `ros2_list_topics` to find other camera topics if the default isn't available.
- For **RealSense** (realsense-ros): use topic `/camera/camera/color/image_raw` with `message_type: Image` for RGB, or `/camera/camera/color/image_raw/compressed` with default for compressed. Depth: `/camera/camera/depth/image_rect_raw` with `message_type: Image`.
- If the user asks about a specific direction, note that you can only show what the robot's camera is currently pointed at.
- For multiple cameras, ask which one the user wants to see.
