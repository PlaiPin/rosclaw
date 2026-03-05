# Zenoh setup for RosClaw (Mode D)

RosClaw can connect to a Zenoh router so you can control a robot that uses **zenoh-bridge-ros2dds** (or ROS 2 with Zenoh RMW). The plugin uses the **zenoh-ts** JavaScript library, which connects **only via WebSocket** to the **zenoh-plugin-remote-api** on the router.

## Two ways to connect to the same router

| Client | Protocol | Endpoint example |
|--------|----------|------------------|
| Native Zenoh (Rust, C, Python, etc.) | TCP | `tcp/127.0.0.1:7447` |
| **zenoh-ts** (RosClaw plugin) | **WebSocket** | `ws://127.0.0.1:10000` |

If you only run `zenohd` with default settings, it listens on `tcp/7447`. Native tools (e.g. `z_sub -e tcp/127.0.0.1:7447`) will see traffic, but **RosClaw will not** until the router also exposes the remote-api WebSocket.

## Install on macOS (Homebrew)

Install the Zenoh router and the WebSocket (remote-api) plugin so RosClaw can connect:

```bash
brew tap eclipse-zenoh/homebrew-zenoh
brew install zenoh
brew install zenoh-plugin-remote-api
```

If the tap or package names differ, see [Eclipse Zenoh installation](https://zenoh.io/docs/getting-started/installation/). Then follow “Run zenohd” below.

## Run zenohd with the remote-api plugin

1. **Install** `zenohd` and `zenoh-plugin-remote-api` (e.g. on macOS: `brew install zenoh zenoh-plugin-remote-api` after tapping `eclipse-zenoh/homebrew-zenoh`; see [Eclipse Zenoh](https://zenoh.io/docs/getting-started/installation/) for other platforms).

2. **Create a config file** that loads the plugin and sets the WebSocket port (e.g. `zenohd-rosclaw.json5`):

   ```json5
   {
     "plugins": {
       "remote_api": {
         "websocket_port": "10000"
       }
     }
   }
   ```

   Or use the one in this repo: `scripts/zenohd-rosclaw.json5`.

3. **Start the router** with that config:

   ```bash
   zenohd -c scripts/zenohd-rosclaw.json5
   ```

   Or, if you use a different path:

   ```bash
   zenohd -c /path/to/zenohd-rosclaw.json5
   ```

4. **Configure RosClaw** with Zenoh transport and WebSocket endpoint:

   ```bash
   ./scripts/configure_rosclaw.sh --mode zenoh --zenoh-endpoint ws://localhost:10000
   ```

   In OpenClaw plugin config: **Zenoh Router Endpoint** = `ws://localhost:10000` (or `ws://<router-ip>:10000` if the router is on another host).

5. **Restart the OpenClaw gateway.** The plugin will connect to the same zenohd via WebSocket and see the same keys as native clients using `tcp/7447`.

## Using zenoh-bridge-ros2dds

- On the **Mac**: run **zenohd only** (the router), with `zenohd-rosclaw.json5`. Do not run the bridge on the Mac.
- On the **robot**: run **zenoh-bridge-ros2dds** (the **bridge** executable), **not zenohd**. The bridge connects to the Mac’s zenohd and forwards Zenoh ↔ ROS 2. If you run zenohd on the robot, the robot is a second router and cmd_vel from RosClaw (which goes to the Mac’s router) never reaches the bridge that talks to ROS 2.
- Set RosClaw **zenoh.keyFormat** to **`ros2dds`** (default) so topic keys match the bridge.

### Checklist: Mac vs robot

| Machine | Run this | Config |
|---------|----------|--------|
| **Mac** | `zenohd` (router) | `zenohd-rosclaw.json5` |
| **Robot** | `zenoh-bridge-ros2dds` (bridge) | `zenoh-bridge-ros2dds-robot.json5` (edit `connect.endpoints` to Mac IP) |

### Robot bridge config (allow cmd_vel)

So that Twist commands from RosClaw reach the robot, the bridge on the robot must be allowed to bridge **subscribers** (Zenoh → ROS2). If you use an **allow** config, you must list both publishers and subscribers; otherwise unlisted types are disabled. Use the example in this repo:

- **`scripts/zenoh-bridge-ros2dds-robot.json5`** — sets `"mode": "client"` (bridge connects to the Mac's zenohd), `connect.endpoints` to the Zenoh router, and `plugins.ros2dds.allow` for subscribers (e.g. `.+/cmd_vel`) and publishers (`.+`). Edit `connect.endpoints` and replace `192.168.0.241` with your Mac’s IP (where zenohd runs), then on the robot run: `zenoh-bridge-ros2dds -c /path/to/zenoh-bridge-ros2dds-robot.json5`. From the robot, verify the Mac is reachable: `ping <mac-ip>` and `nc -zv <mac-ip> 7447`; on the Mac, zenohd must listen on all interfaces (not only localhost). **Do not use this file with zenohd** — zenohd does not load the ros2dds plugin and will panic on `allow`.

## Viewing gateway logs (macOS)

The gateway runs as a LaunchAgent. Logs:

- **stdout:** `~/.openclaw/logs/gateway.log`
- **stderr:** `~/.openclaw/logs/gateway.err.log`

Watch live: `tail -f ~/.openclaw/logs/gateway.err.log`. Look for `[RosClaw] Zenoh connected to ...` (success) or `WebSocket has been disconnected from remote-api-plugin: 1006` (Zenoh WebSocket failed).

## Troubleshooting

- **“RosClaw doesn’t see topics” but `z_sub -e tcp/127.0.0.1:7447 -k '**'` does**  
  RosClaw uses zenoh-ts and must connect to the **WebSocket** port of **zenoh-plugin-remote-api** (e.g. 10000). Start zenohd with a config that loads the remote_api plugin and `websocket_port: "10000"`, and set the plugin’s Zenoh Router Endpoint to `ws://localhost:10000`.

- **Connection refused to ws://localhost:10000**  
  zenohd is not running with zenoh-plugin-remote-api, or the plugin is bound to another port. Check the plugin config and the port in RosClaw.

- **"WebSocket has been disconnected from remote-api-plugin: 1006" in gateway.err.log**  
  zenoh-ts could not establish or keep a WebSocket to the router. Start **zenohd with the remote-api config** (port 10000) **before** starting the OpenClaw gateway. Verify: run `zenohd -c scripts/zenohd-rosclaw.json5`, then `lsof -i :10000` or `nc -zv localhost 10000`; you should see the listener. Then start or restart the gateway. On macOS, gateway logs are in `~/.openclaw/logs/gateway.log` and `~/.openclaw/logs/gateway.err.log`; use `tail -f ~/.openclaw/logs/gateway.err.log` to watch.

- **Topics still empty after connecting**  
  Ensure the robot’s zenoh-bridge-ros2dds is connected to this same router and is publishing. Use `z_sub -e tcp/127.0.0.1:7447 -k '**'` to confirm traffic; then restart the gateway so RosClaw reconnects and lists topics.

- **robot.namespace is set but the robot does not move (no messages on ros2 topic echo)**  
  On the robot you must run **zenoh-bridge-ros2dds** (the bridge), not zenohd. Then: RosClaw publishes to the Zenoh key `robot3946.../cmd_vel`. Check: (1) **Bridge mode** — use `"mode": "client"` in the bridge config so it connects to the Mac's zenohd instead of running a second router (default is router; two routers must peer correctly for data to flow). (2) **Bridge IP** — `connect.endpoints` must be your Mac’s **actual** IP and reachable from the robot (e.g. Mac 192.168.0.241 and robot 192.168.0.x; wrong subnet like 192.168.1.241 causes “Unable to connect … deadline has elapsed”). (3) **Bridge allow list** — if zenoh-bridge-ros2dds uses an `allow` config, ensure `subscribers` includes `.+/cmd_vel` and the full topic e.g. `/robot3946.../cmd_vel`. (4) **Connectivity** — from the robot: `ping <mac-ip>` and `nc -zv <mac-ip> 7447`; on the Mac, zenohd must listen on all interfaces (not only localhost). (5) **Same router** — the robot bridge must connect to the same zenohd as the gateway. (6) **Gateway logs** — after a move command, look for `[RosClaw] Zenoh publish: key=...`. (7) **Zenoh side** — on the Mac run `z_sub -e tcp/127.0.0.1:7447 -k 'robot3946b404c33e4aa39a8d16deb1c5c593/cmd_vel'` and send a move; if you see data, the gateway is publishing and the issue is the bridge or network on the robot.

- **zenohd stops running on the Mac (exits on its own)**  
  Run zenohd in the **foreground** in a dedicated terminal to see why it exits: `zenohd -c scripts/zenohd-rosclaw.json5`. If it crashes when the robot’s bridge connects, check the last lines of output (e.g. panic, segfault, or “connection closed”). To keep it running in the background: `nohup zenohd -c scripts/zenohd-rosclaw.json5 >> ~/zenohd.log 2>&1 &` and inspect `~/zenohd.log` if it stops again. On macOS you can also run it as a LaunchAgent (similar to the OpenClaw gateway) so it restarts on failure.
