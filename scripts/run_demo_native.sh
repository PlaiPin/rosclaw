#!/bin/bash
# run_demo_native.sh - Start rosbridge + discovery for RosClaw demo (no Docker)
#
# Prerequisites (one-time):
#   sudo apt install -y ros-jazzy-rosbridge-suite   # or ros-humble-rosbridge-suite
#
# Usage: ./scripts/run_demo_native.sh [jazzy|humble]
# Default: jazzy

set -e

ROS_DISTRO="${1:-jazzy}"
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

source "/opt/ros/$ROS_DISTRO/setup.bash"
[[ -f "$REPO_ROOT/ros2_ws/install/setup.bash" ]] && source "$REPO_ROOT/ros2_ws/install/setup.bash"

# If rosbridge was built from source, use venv's Python deps
for _d in "$REPO_ROOT/ros2_ws/venv_rosbridge/lib/python"*/site-packages; do
    [[ -d "$_d" ]] && export PYTHONPATH="$_d:${PYTHONPATH:-}" && break
done

if ! ros2 pkg list 2>/dev/null | grep -q rosbridge_server; then
    echo "rosbridge_suite is not installed. Run once (then re-run this script):"
    echo "  sudo apt install -y ros-$ROS_DISTRO-rosbridge-suite"
    exit 1
fi

echo "Starting rosbridge WebSocket on port 9090 and rosclaw_discovery..."
echo "Connect OpenClaw plugin to: ws://localhost:9090"
echo "Press Ctrl+C to stop."
echo ""

# Start discovery in background; rosbridge in foreground so we see logs
ros2 run rosclaw_discovery discovery_node &
DISC_PID=$!
trap "kill $DISC_PID 2>/dev/null" EXIT

ros2 launch rosbridge_server rosbridge_websocket_launch.xml
