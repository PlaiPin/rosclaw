# Follow Me Mission (native)

## When to Use

Use when the user wants the robot to follow them:
- "Follow me"
- "Start following"
- "Stop following"

## Prerequisites

- **Default (depth-only):** Robot has a depth camera (e.g. RealSense) so Follow Me can use depth vs target distance. No Ollama required.
- **Optional (Ollama):** Set **followMe.useOllama** to true to use Qwen for person detection and left/right steering. Then Ollama + vision model (e.g. qwen3-vl:2b) must be reachable. "What do you see?" uses the **chat assistant's vision model**; Follow Me does not call that model (the plugin cannot invoke the chat from its loop). So by default Follow Me uses depth only.
- Plugin **followMe.cameraTopic** should match the robot’s camera topic.

## Steps

1. **Start** — Use `follow_robot` with `action: "start"`. A loop runs in the plugin: camera → Qwen VLM → cmd_vel. The robot will try to find a person and follow ~0.5 m behind (configurable via followMe.targetDistance).
2. **Stop** — Use `follow_robot` with `action: "stop"`. Stops the loop and sends zero twist.
3. **Status** — Use `follow_robot` with `action: "status"` to see if Follow Me is active.

## Tool: follow_robot

- **action**: `start` | `stop` | `status`

No external apps or ROS2 Follow Me nodes; this is the native OpenClaw + RosClaw implementation.

## Example: "Follow me"

```
Tool: follow_robot
action: start
```

## Example: "Stop following"

```
Tool: follow_robot
action: stop
```

## Depth (RealSense) — recommended if motors don’t move

- If the robot has a RealSense (or other depth camera), set **followMe.depthTopic** (e.g. `/camera/camera/depth/image_rect_raw`). Follow Me will then use **real distance** in meters vs **followMe.targetDistance** to decide forward/back. When depth is configured, the robot will **approach or back off based on depth even if the VLM is uncertain** (person_visible false); the VLM is still used for left/right steering when it sees a person.
- For “how far am I from the robot?” use **ros2_depth_distance**. It returns the median distance in meters at the center of the depth image.

## Tips

- To “stay 2 meters back”, set **followMe.targetDistance** to 2. With **followMe.depthTopic** set, the loop uses real depth vs this target.
- **Default: depth only.** No spinning when depth is missing—robot stops. Distance for follow is always from **RealSense depth** (stay within followMe.targetDistance, e.g. 0.5 m). The plugin cannot call OpenClaw's chat vision from the loop.
- **OpenAI / chat vision:** To use the same model as "what do you see" (e.g. OpenAI), set **followMe.visionCallbackUrl** to an HTTP endpoint that accepts POST `{ "image": "<base64>" }` and returns JSON `{ "person_visible": true|false, "position": "left"|"center"|"right", "distance_hint": "close"|"medium"|"far" }`. That endpoint can call OpenAI (or any vision API) and return this format. Follow distance is still from RealSense depth.
- **follow_me_see** runs the Ollama pipeline (when useOllama is on) on one frame. Use **ollama_status** when useOllama is on and detections are missing.
