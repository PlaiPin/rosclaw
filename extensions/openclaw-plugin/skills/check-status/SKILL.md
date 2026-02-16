# Check Status

## When to Use

Use this skill when the user asks about the robot's state:
- "How's the robot doing?"
- "What's the battery level?"
- "Check the sensors"
- "Is anything wrong?"

## Steps

1. **Battery**: Use `ros2_subscribe_once` on `/battery_state` to read battery level and charging status.
2. **Position**: Use `ros2_subscribe_once` on `/odom` or `/amcl_pose` to get the robot's current position.
3. **Diagnostics**: Use `ros2_subscribe_once` on `/diagnostics` to check for warnings or errors.
4. **Sensors**: Check `/scan` for LIDAR status, `/camera/image_raw` for camera availability.

## Example: Check battery

```
Tool: ros2_subscribe_once
Topic: /battery_state
Type: sensor_msgs/msg/BatteryState
```

Report the percentage, voltage, and whether the robot is charging.

## Tips

- Summarize the status in a human-readable format.
- Highlight any warnings or abnormal values.
- If a sensor topic is unavailable, note it as "not reporting" rather than failing.
