#!/usr/bin/env bash
# configure_rosclaw.sh — Configure RosClaw plugin: transport mode, namespace, and optional Docker
#
# Updates ~/.openclaw/openclaw.json (or OPENCLAW_CONFIG) with plugins.entries.rosclaw.config
# so that transport.mode, rosbridge.url, zenoh.routerEndpoint, robot.namespace, etc. are set.
#
# Usage:
#   ./scripts/configure_rosclaw.sh [OPTIONS]
#   ./scripts/configure_rosclaw.sh --interactive
#
# Options:
#   --mode MODE       A|B|C|D or local|rosbridge|webrtc|zenoh
#   --namespace NS    Robot namespace (e.g. robot-uuid) → topics like /robot-uuid/cmd_vel
#   --robot-ip IP     For Mode B: robot IP/hostname (sets rosbridge.url = ws://IP:9090)
#   --zenoh-endpoint  For Mode D: Zenoh router endpoint (e.g. ws://localhost:10000)
#   --zenoh-domain    For Mode D: domain ID (default 0)
#   --docker          For demo: use Mode B and start Docker ROS2+rosbridge (ws://localhost:9090)
#   --interactive     Prompt for mode and namespace
#   --config FILE     OpenClaw config path (default: $HOME/.openclaw/openclaw.json or OPENCLAW_CONFIG)
#
# Mode summary:
#   A / local   — Everything on robot (OpenClaw + ROS2 on same machine)
#   B / rosbridge — Robot on network; plugin connects via rosbridge (ws://robot-ip:9090)
#   C / webrtc  — Remote robot (WebRTC); set signaling URL, robot ID/key in plugin config
#   D / zenoh   — Robot uses Zenoh RMW; plugin connects to Zenoh router

set -e

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OPENCLAW_JSON="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"
MODE=""
NAMESPACE=""
ROBOT_IP=""
ZENOH_ENDPOINT=""
ZENOH_DOMAIN="0"
DOCKER=false
INTERACTIVE=false

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \?//'
  echo ""
  echo "Examples:"
  echo "  ./scripts/configure_rosclaw.sh --mode B --robot-ip 192.168.1.50 --namespace mybot"
  echo "  ./scripts/configure_rosclaw.sh --mode D --zenoh-endpoint ws://localhost:10000"
  echo "  ./scripts/configure_rosclaw.sh --docker"
  echo "  ./scripts/configure_rosclaw.sh --interactive"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help) usage ;;
    --mode)        MODE="$2";   shift 2 ;;
    --namespace)   NAMESPACE="$2"; shift 2 ;;
    --robot-ip)    ROBOT_IP="$2";   shift 2 ;;
    --zenoh-endpoint) ZENOH_ENDPOINT="$2"; shift 2 ;;
    --zenoh-domain)   ZENOH_DOMAIN="${2:-0}"; shift 2 ;;
    --docker)      DOCKER=true; shift ;;
    --interactive) INTERACTIVE=true; shift ;;
    --config)      OPENCLAW_JSON="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

# Map friendly mode to transport mode
resolve_mode() {
  local m="$1"
  case "$m" in
    A|local)       echo "local" ;;
    B|rosbridge)   echo "rosbridge" ;;
    C|webrtc)      echo "webrtc" ;;
    D|zenoh)       echo "zenoh" ;;
    *)             echo "$m" ;;
  esac
}

if [[ "$INTERACTIVE" == true ]]; then
  echo "=============================================="
  echo "  RosClaw configuration"
  echo "=============================================="
  echo ""
  echo "Mode A — Everything on robot (OpenClaw on robot, transport = local)"
  echo "Mode B — Connected robot (OpenClaw here, robot on network; transport = rosbridge)"
  echo "Mode C — Remote robot / WebRTC (robot behind NAT; transport = webrtc)"
  echo "Mode D — Zenoh (robot uses Zenoh RMW; transport = zenoh)"
  echo ""
  read -r -p "Choose mode (A/B/C/D) [B]: " mode_choice
  mode_choice="${mode_choice:-B}"
  MODE=$(resolve_mode "$mode_choice")

  read -r -p "Robot namespace (empty for global topics) []: " NAMESPACE

  if [[ "$MODE" == "rosbridge" ]]; then
    if [[ "$DOCKER" != true ]]; then
      read -r -p "Robot IP or hostname (for rosbridge URL) [localhost]: " ROBOT_IP
      ROBOT_IP="${ROBOT_IP:-localhost}"
    else
      ROBOT_IP="localhost"
    fi
  fi

  if [[ "$MODE" == "zenoh" ]]; then
    read -r -p "Zenoh router endpoint (e.g. ws://localhost:10000) [ws://localhost:10000]: " ZENOH_ENDPOINT
    ZENOH_ENDPOINT="${ZENOH_ENDPOINT:-ws://localhost:10000}"
  fi
fi

# Docker implies Mode B + localhost
if [[ "$DOCKER" == true ]]; then
  MODE="rosbridge"
  ROBOT_IP="localhost"
fi

# If no mode chosen, show current config and exit
if [[ -z "$MODE" ]]; then
  echo "Config file: $OPENCLAW_JSON"
  if [[ -f "$OPENCLAW_JSON" ]] && command -v jq &>/dev/null; then
    echo ""
    jq '.plugins.entries.rosclaw.config // "not set"' "$OPENCLAW_JSON" 2>/dev/null || echo "Could not read plugin config."
  else
    echo "Use --mode, --interactive, or --help."
  fi
  exit 0
fi

TRANSPORT_MODE=$(resolve_mode "$MODE")

echo "=============================================="
echo "  RosClaw configuration"
echo "=============================================="
echo "  Config: $OPENCLAW_JSON"
echo "  Mode:   $TRANSPORT_MODE"
[[ -n "$NAMESPACE" ]]    && echo "  Namespace: $NAMESPACE"
[[ -n "$ROBOT_IP" ]]     && echo "  Rosbridge: ws://${ROBOT_IP}:9090"
[[ -n "$ZENOH_ENDPOINT" ]] && echo "  Zenoh:     $ZENOH_ENDPOINT"
echo ""

# Ensure config file and plugins.entries.rosclaw exist
if [[ ! -f "$OPENCLAW_JSON" ]]; then
  echo "Config file not found: $OPENCLAW_JSON"
  echo "Create it by running OpenClaw configure once, or set OPENCLAW_CONFIG."
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "jq is required to update the config file. Install jq or edit $OPENCLAW_JSON manually:"
  echo ""
  echo "  transport.mode: $TRANSPORT_MODE"
  [[ -n "$NAMESPACE" ]]    && echo "  robot.namespace: $NAMESPACE"
  if [[ "$TRANSPORT_MODE" == "rosbridge" ]]; then
    echo "  rosbridge.url: ws://${ROBOT_IP:-localhost}:9090"
  fi
  if [[ "$TRANSPORT_MODE" == "zenoh" ]]; then
    echo "  zenoh.routerEndpoint: ${ZENOH_ENDPOINT:-ws://localhost:10000}"
    echo "  zenoh.domainId: $ZENOH_DOMAIN"
  fi
  exit 1
fi

# Build the config fragment we want under plugins.entries.rosclaw.config
# jq: merge existing config with our overrides
CONFIG_OVERRIDES='.transport.mode = "'"$TRANSPORT_MODE"'"'
[[ -n "$NAMESPACE" ]] && CONFIG_OVERRIDES="$CONFIG_OVERRIDES | .robot.namespace = \"$NAMESPACE\""

if [[ "$TRANSPORT_MODE" == "rosbridge" ]]; then
  CONFIG_OVERRIDES="$CONFIG_OVERRIDES | .rosbridge.url = \"ws://${ROBOT_IP:-localhost}:9090\""
fi

if [[ "$TRANSPORT_MODE" == "zenoh" ]]; then
  CONFIG_OVERRIDES="$CONFIG_OVERRIDES | .zenoh.routerEndpoint = \"${ZENOH_ENDPOINT:-ws://localhost:10000}\""
  CONFIG_OVERRIDES="$CONFIG_OVERRIDES | .zenoh.domainId = ($ZENOH_DOMAIN | tonumber)"
  CONFIG_OVERRIDES="$CONFIG_OVERRIDES | .zenoh.keyFormat = \"ros2dds\""
fi

# Read current config, ensure structure, merge, write back
TMP=$(mktemp)
jq '
  .plugins.entries.rosclaw.config = ((.plugins.entries.rosclaw.config // {}) | '"$CONFIG_OVERRIDES"')
' "$OPENCLAW_JSON" > "$TMP" && mv "$TMP" "$OPENCLAW_JSON"

echo "Updated $OPENCLAW_JSON with transport.mode=$TRANSPORT_MODE and selected options."
echo ""

if [[ "$DOCKER" == true ]]; then
  echo "Starting Docker stack (ROS2 + rosbridge) in background..."
  if [[ -f "$REPO_ROOT/docker/docker-compose.yml" ]]; then
    (cd "$REPO_ROOT" && docker compose -f docker/docker-compose.yml up -d ros2) || true
    echo "Run: docker compose -f docker/docker-compose.yml logs -f ros2"
  else
    echo "docker/docker-compose.yml not found; start your ROS2+rosbridge stack manually."
  fi
  echo ""
fi

echo "Next steps:"
echo "  1. Restart the OpenClaw gateway so the plugin picks up the new config."
echo "  2. For Mode B: ensure rosbridge is running on the robot (e.g. ros2 launch rosbridge_server rosbridge_websocket_launch.xml)."
echo "  3. For Mode D: ensure Zenoh router is running with zenoh-plugin-remote-api and ROS2 uses RMW_IMPLEMENTATION=rmw_zenoh_cpp."
echo ""
echo "See docs/robot-setup.md for details."
