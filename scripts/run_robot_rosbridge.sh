#!/bin/bash
# run_robot_rosbridge.sh - Start rosbridge WebSocket server on the robot
#
# Run this on the robot so the RosClaw plugin (OpenClaw) can connect to ROS2.
# Usage: ./scripts/run_robot_rosbridge.sh [humble|jazzy]
# Default ROS distro: humble

set -e

ROS_DISTRO="${1:-jazzy}"
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [[ -f "/opt/ros/$ROS_DISTRO/setup.bash" ]]; then
    source "/opt/ros/$ROS_DISTRO/setup.bash"
else
    echo "ROS2 $ROS_DISTRO not found. Usage: $0 [humble|jazzy]"
    exit 1
fi

if [[ -f "$REPO_ROOT/ros2_ws/install/setup.bash" ]]; then
    source "$REPO_ROOT/ros2_ws/install/setup.bash"
fi

# If rosbridge was built from source, use venv's Python deps (tornado, pymongo, cbor2)
for _d in "$REPO_ROOT/ros2_ws/venv_rosbridge/lib/python"*/site-packages; do
    [[ -d "$_d" ]] && export PYTHONPATH="$_d:${PYTHONPATH:-}" && break
done

if ! ros2 pkg list 2>/dev/null | grep -q rosbridge_server; then
    echo "rosbridge_suite not found. Install it with:"
    echo "  sudo apt install -y ros-$ROS_DISTRO-rosbridge-suite"
    exit 1
fi

echo "Starting rosbridge WebSocket server on port 9090 (ROS_DISTRO=$ROS_DISTRO)"
exec ros2 launch rosbridge_server rosbridge_websocket_launch.xml
