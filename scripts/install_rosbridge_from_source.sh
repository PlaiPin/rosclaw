#!/bin/bash
# install_rosbridge_from_source.sh - Build and install rosbridge_suite from source
#
# Use this when apt install ros-<distro>-rosbridge-suite fails (e.g. 404).
# Usage: ./scripts/install_rosbridge_from_source.sh [jazzy|humble]
# Default: jazzy

set -e

ROS_DISTRO="${1:-jazzy}"
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ROS2_WS="$REPO_ROOT/ros2_ws"
SRC="$ROS2_WS/src"
BRIDGE_REPO="$SRC/rosbridge_suite_repo"

echo "Installing rosbridge_suite from source for ROS2 $ROS_DISTRO"
echo "Workspace: $ROS2_WS"
echo ""

source "/opt/ros/$ROS_DISTRO/setup.bash"

# Python deps required by rosbridge_server (tornado). Use a venv to avoid touching system Python.
VENV_ROSBRIDGE="$ROS2_WS/venv_rosbridge"
if [[ ! -d "$VENV_ROSBRIDGE" ]]; then
    echo "Creating venv for rosbridge at $VENV_ROSBRIDGE..."
    python3 -m venv "$VENV_ROSBRIDGE"
fi
echo "Installing Python deps in venv (tornado, pymongo, cbor2, ujson)..."
"$VENV_ROSBRIDGE/bin/pip" install --quiet tornado pymongo cbor2 ujson
echo "Venv ready. Run scripts will set PYTHONPATH automatically."

# Clone repo (ros2 branch) if not present
if [[ ! -d "$BRIDGE_REPO" ]]; then
    echo "Cloning RobotWebTools/rosbridge_suite (branch ros2)..."
    git clone -b ros2 --depth 1 https://github.com/RobotWebTools/rosbridge_suite.git "$BRIDGE_REPO"
else
    echo "Repo already at $BRIDGE_REPO, pulling latest..."
    (cd "$BRIDGE_REPO" && git fetch origin ros2 && git checkout ros2 && git pull --ff-only)
fi

# Symlink packages into src so colcon finds them (avoid name clash: repo dir is rosbridge_suite_repo)
for pkg in rosapi_msgs rosbridge_msgs rosbridge_library rosapi rosbridge_server rosbridge_suite; do
    if [[ -d "$BRIDGE_REPO/$pkg" ]]; then
        if [[ -L "$SRC/$pkg" ]]; then
            rm -f "$SRC/$pkg"
        fi
        if [[ ! -e "$SRC/$pkg" ]]; then
            ln -sf "$(basename "$BRIDGE_REPO")/$pkg" "$SRC/$pkg"
            echo "Linked $pkg"
        fi
    fi
done

# Build (skip tests so we don't need ament_cmake_mypy)
echo ""
echo "Building workspace (this may take a few minutes)..."
cd "$ROS2_WS"
colcon build --symlink-install --packages-up-to rosbridge_server --cmake-args -DBUILD_TESTING=OFF

echo ""
echo "Done. Source and run rosbridge with:"
echo "  source /opt/ros/$ROS_DISTRO/setup.bash"
echo "  source $ROS2_WS/install/setup.bash"
echo "  ros2 launch rosbridge_server rosbridge_websocket_launch.xml"
echo ""
echo "Or use: ./scripts/run_robot_rosbridge.sh $ROS_DISTRO"
echo "Or:     ./scripts/run_demo_native.sh $ROS_DISTRO"
