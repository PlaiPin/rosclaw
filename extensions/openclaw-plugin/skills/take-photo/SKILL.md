# Take Photo

## When to Use

Use this skill when the user wants to see what the robot sees:
- "What do you see?"
- "Take a photo"
- "Show me the camera"
- "Send me a picture"

## Steps

1. **Capture image**: Use `ros2_camera_snapshot` to grab a frame from the camera topic.
2. **Return the image**: The tool returns the image data which will be displayed inline in the chat.

## Example

```
Tool: ros2_camera_snapshot
Topic: /camera/image_raw/compressed
```

## Tips

- Default camera topic is `/camera/image_raw/compressed`. Use `ros2_list_topics` to find other camera topics if the default isn't available.
- If the user asks about a specific direction, note that you can only show what the robot's camera is currently pointed at.
- For multiple cameras, ask which one the user wants to see.
