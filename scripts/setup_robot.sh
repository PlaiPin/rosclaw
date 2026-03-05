#!/bin/bash
# setup_robot.sh - One-time robot-side setup for RosClaw (no Docker)
#
# Run this on the robot after cloning the repo. It builds the workspace,
# installs rosbridge (apt or from source), and prepares run scripts.
#
# Usage: ./scripts/setup_robot.sh [--ros-distro jazzy|humble] [--skip-apt]
#   --ros-distro  ROS2 distro (default: auto-detect from /opt/ros)
#   --skip-apt    Skip suggesting sudo apt install; go straight to from-source if needed

set -e

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ROS2_WS="$REPO_ROOT/ros2_ws"
SKIP_APT=false
ROS_DISTRO=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --ros-distro) ROS_DISTRO="$2"; shift 2 ;;
    --skip-apt)   SKIP_APT=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "=============================================="
echo "  RosClaw robot setup"
echo "=============================================="
echo ""

# Detect ROS distro if not set
if [[ -z "$ROS_DISTRO" ]]; then
  for d in /opt/ros/*/; do
    if [[ -d "$d" && -f "${d}setup.bash" ]]; then
      ROS_DISTRO=$(basename "$d")
      echo "Detected ROS2 distro: $ROS_DISTRO"
      break
    fi
  done
fi
if [[ -z "$ROS_DISTRO" ]]; then
  echo "No ROS2 installation found in /opt/ros. Install ROS2 (Humble or Jazzy) first."
  exit 1
fi

if [[ ! -f "/opt/ros/$ROS_DISTRO/setup.bash" ]]; then
  echo "ROS2 $ROS_DISTRO not found at /opt/ros/$ROS_DISTRO"
  exit 1
fi

# 1. Build ros2_ws
echo ""
echo "[1/3] Building ROS2 workspace (rosclaw_msgs, rosclaw_discovery, rosclaw_agent)..."
source "/opt/ros/$ROS_DISTRO/setup.bash"
cd "$ROS2_WS"
if [[ ! -f install/setup.bash ]]; then
  colcon build --symlink-install
else
  echo "Workspace already built; re-building to be sure..."
  colcon build --symlink-install
fi
echo "Workspace OK."
echo ""

# 2. Rosbridge: try apt, else from source
echo "[2/3] Rosbridge WebSocket server..."
if ros2 pkg list 2>/dev/null | grep -q rosbridge_server; then
  echo "rosbridge_suite already available."
else
  if [[ "$SKIP_APT" != true ]]; then
    echo "Attempting to install rosbridge_suite via apt (may prompt for sudo)..."
    if sudo apt-get update -qq 2>/dev/null && sudo apt-get install -y "ros-$ROS_DISTRO-rosbridge-suite" 2>/dev/null; then
      echo "rosbridge_suite installed via apt."
    else
      echo "apt install failed or skipped. Building from source..."
      "$REPO_ROOT/scripts/install_rosbridge_from_source.sh" "$ROS_DISTRO"
    fi
  else
    echo "Building rosbridge from source (--skip-apt)..."
    "$REPO_ROOT/scripts/install_rosbridge_from_source.sh" "$ROS_DISTRO"
  fi
fi
echo ""

# 3. Quick check
echo "[3/3] Verifying..."
source "/opt/ros/$ROS_DISTRO/setup.bash"
source "$ROS2_WS/install/setup.bash"
for _d in "$ROS2_WS/venv_rosbridge/lib/python"*/site-packages; do
  [[ -d "$_d" ]] && export PYTHONPATH="$_d:${PYTHONPATH:-}" && break
done
if ros2 pkg list 2>/dev/null | grep -q rosbridge_server; then
  echo "rosbridge_server: OK"
else
  echo "WARNING: rosbridge_server still not found. Run: ./scripts/install_rosbridge_from_source.sh $ROS_DISTRO"
fi
for pkg in rosclaw_msgs rosclaw_discovery; do
  if ros2 pkg list 2>/dev/null | grep -q "^${pkg}$"; then echo "$pkg: OK"; else echo "$pkg: missing"; fi
done
echo ""

echo "=============================================="
echo "  Robot setup complete"
echo "=============================================="
echo ""
echo "Start the bridges on this robot with:"
echo "  ./scripts/run_demo_native.sh $ROS_DISTRO"
echo ""
echo "Then on the machine where OpenClaw runs, install and enable the plugin:"
echo "  ./scripts/setup_gateway_plugin.sh"
echo ""
echo "See docs/robot-setup.md for full options and troubleshooting."
echo ""
