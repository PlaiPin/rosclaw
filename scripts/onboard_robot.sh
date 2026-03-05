#!/bin/bash
# onboard_robot.sh - Interactive onboarding for a new RosClaw robot
#
# Run from the rosclaw repo root. Asks whether you're on the robot or the
# gateway, then runs the right setup and prints a checklist.
#
# Usage: ./scripts/onboard_robot.sh

set -e

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"

echo ""
echo "  ╭─────────────────────────────────────────╮"
echo "  │   RosClaw — Onboard a new robot          │"
echo "  ╰─────────────────────────────────────────╯"
echo ""

# Where are we?
echo "Where is this script running?"
echo "  1) On the ROBOT (Ubuntu + ROS2) — set up rosbridge and run bridges"
echo "  2) On the GATEWAY (where OpenClaw runs) — set up the RosClaw plugin"
echo "  3) Do BOTH (robot and gateway on this machine)"
echo ""
read -p "Choice [1/2/3]: " choice
choice=${choice:-1}

run_robot() {
  echo ""
  echo "--- Robot setup ---"
  read -p "ROS2 distro (jazzy/humble) [auto]: " distro
  if [[ -n "$distro" ]]; then
    "$REPO_ROOT/scripts/setup_robot.sh" --ros-distro "$distro"
  else
    "$REPO_ROOT/scripts/setup_robot.sh"
  fi
}

run_gateway() {
  echo ""
  echo "--- Gateway plugin setup ---"
  read -p "Rosbridge URL (e.g. ws://localhost:9090 or ws://ROBOT_IP:9090) [skip]: " url
  read -p "Robot namespace for cmd_vel (e.g. robot3946b404c33e4aa39a8d16deb1c5c593) [skip]: " ns
  args=()
  [[ -n "$url" ]] && args+=(--rosbridge-url "$url")
  [[ -n "$ns" ]]  && args+=(--robot-namespace "$ns")
  "$REPO_ROOT/scripts/setup_gateway_plugin.sh" "${args[@]}"
}

case "$choice" in
  1) run_robot ;;
  2) run_gateway ;;
  3) run_robot; run_gateway ;;
  *) echo "Invalid choice."; exit 1 ;;
esac

echo ""
echo "  ╭─────────────────────────────────────────╮"
echo "  │   Onboarding checklist                   │"
echo "  ╰─────────────────────────────────────────╯"
echo ""
if [[ "$choice" == "1" || "$choice" == "3" ]]; then
  echo "  On the robot:"
  echo "    [ ] Start bridges:  ./scripts/run_demo_native.sh"
  echo "    [ ] (Optional) Open firewall for port 9090 if gateway is remote: sudo ufw allow 9090/tcp"
fi
if [[ "$choice" == "2" || "$choice" == "3" ]]; then
  echo "  On the gateway:"
  echo "    [ ] Restart OpenClaw:  systemctl --user restart openclaw-gateway.service"
  echo "    [ ] Enable RosClaw plugin in the dashboard (Plugins, not Channels)"
  echo "    [ ] Set plugin config: rosbridge URL, robot namespace (if needed)"
fi
echo ""
echo "  Full guide: docs/robot-setup.md"
echo ""
