# Navigate To

## When to Use

Use this skill when the user wants the robot to move to a specific location, such as:
- "Go to the kitchen"
- "Navigate to position (3, 2)"
- "Move to waypoint B"
- "Drive to the charging station"

## How It Works

Navigation uses the Nav2 stack via the `navigate_to_pose` action server. The robot plans a path from its current position to the goal and follows it while avoiding obstacles.

## Steps

1. **Determine the goal position**: Ask the user for coordinates if not provided, or map a named location to coordinates.
2. **Check the robot's current position**: Use `ros2_subscribe_once` on `/amcl_pose` to get the current pose.
3. **Send the navigation goal**: Use `ros2_action_goal` (Phase 2) or `ros2_publish` to the appropriate Nav2 topic.
4. **Monitor progress**: Periodically check `/navigate_to_pose/_action/status` for completion.
5. **Report result**: Tell the user when the robot has arrived or if navigation failed.

## Example: Navigate to coordinates

```
Tool: ros2_publish
Topic: /goal_pose
Type: geometry_msgs/msg/PoseStamped
Message:
{
  "header": {
    "frame_id": "map"
  },
  "pose": {
    "position": { "x": 3.0, "y": 2.0, "z": 0.0 },
    "orientation": { "x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0 }
  }
}
```

## Safety Notes

- Always confirm the goal is within workspace limits before sending.
- If the robot reports a navigation failure, inform the user and suggest alternatives.
- The user can say `/estop` at any time to immediately halt the robot.
