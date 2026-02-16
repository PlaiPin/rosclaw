# Pick Object

## When to Use

Use this skill when the user wants the robot to pick up or manipulate an object:
- "Pick up the red block"
- "Grab the cup from the table"
- "Move the object to the left"

## Status

**Phase 2** — This skill requires MoveIt2 action integration, which is not yet implemented.

## Planned Steps

1. Identify the target object (via camera or user description)
2. Plan a grasp using MoveIt2
3. Execute the pick motion
4. Confirm success or report failure

## Dependencies

- MoveIt2 action server
- `ros2_action_goal` tool (Phase 2)
- Camera for object detection (optional)
