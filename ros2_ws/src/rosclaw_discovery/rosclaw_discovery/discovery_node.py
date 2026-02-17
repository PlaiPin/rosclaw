"""
RosClaw Discovery Node

Introspects the running ROS2 system and publishes a capability manifest
describing available topics, services, and actions. This manifest is consumed
by the OpenClaw plugin to inform the AI agent about what the robot can do.

Published topic:
  /rosclaw/capabilities  (rosclaw_msgs/msg/CapabilityManifest)

Service:
  /rosclaw/get_capabilities  (rosclaw_msgs/srv/GetCapabilities)

Parameters:
  robot_name       — Name of the robot (default: "Robot")
  robot_namespace   — Namespace filter; empty = discover all (default: "")
  publish_interval  — Seconds between manifest publications (default: 5.0)
"""

from __future__ import annotations

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, DurabilityPolicy

from rosclaw_msgs.msg import CapabilityManifest
from rosclaw_msgs.srv import GetCapabilities


# Internal ROS2 topics/services that clutter the manifest
_INTERNAL_PREFIXES = (
    "/rosout",
    "/parameter_events",
    "/rosclaw/",
)


class DiscoveryNode(Node):
    """Periodically discovers ROS2 capabilities and publishes a manifest."""

    def __init__(self) -> None:
        super().__init__("rosclaw_discovery")

        # Parameters
        self.declare_parameter("robot_name", "Robot")
        self.declare_parameter("robot_namespace", "")
        self.declare_parameter("publish_interval", 5.0)

        self.robot_name: str = self.get_parameter("robot_name").value
        self.robot_namespace: str = self.get_parameter("robot_namespace").value
        self.publish_interval: float = self.get_parameter("publish_interval").value

        # Publisher — transient local so late subscribers get the last manifest
        qos = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.manifest_pub = self.create_publisher(
            CapabilityManifest, "/rosclaw/capabilities", qos
        )

        # Service — on-demand query
        self.get_caps_srv = self.create_service(
            GetCapabilities, "/rosclaw/get_capabilities", self._handle_get_capabilities
        )

        # Timer — periodic discovery
        self.timer = self.create_timer(self.publish_interval, self._on_timer)

        self.get_logger().info(
            f"Discovery node started: robot={self.robot_name}, "
            f"namespace='{self.robot_namespace}', interval={self.publish_interval}s"
        )

    def _on_timer(self) -> None:
        """Discover capabilities and publish the manifest."""
        manifest = self._build_manifest()
        self.manifest_pub.publish(manifest)
        self.get_logger().debug(
            f"Published manifest: {len(manifest.topic_names)} topics, "
            f"{len(manifest.service_names)} services, "
            f"{len(manifest.action_names)} actions"
        )

    def _handle_get_capabilities(
        self,
        request: GetCapabilities.Request,
        response: GetCapabilities.Response,
    ) -> GetCapabilities.Response:
        """Handle on-demand capability query."""
        # Allow overriding namespace per-request
        saved_ns = self.robot_namespace
        if request.robot_namespace:
            self.robot_namespace = request.robot_namespace

        try:
            response.manifest = self._build_manifest()
            response.success = True
            response.error_message = ""
        except Exception as e:
            response.success = False
            response.error_message = str(e)
        finally:
            self.robot_namespace = saved_ns

        return response

    def _build_manifest(self) -> CapabilityManifest:
        """Query the ROS2 graph and build a CapabilityManifest message."""
        manifest = CapabilityManifest()
        manifest.robot_name = self.robot_name
        manifest.robot_namespace = self.robot_namespace
        manifest.stamp = self.get_clock().now().to_msg()

        ns_prefix = self.robot_namespace if self.robot_namespace else ""

        # Discover topics
        for name, types in self.get_topic_names_and_types():
            if not self._should_include(name, ns_prefix):
                continue
            manifest.topic_names.append(name)
            manifest.topic_types.append(types[0] if types else "")

        # Discover services
        for name, types in self.get_service_names_and_types():
            if not self._should_include(name, ns_prefix):
                continue
            manifest.service_names.append(name)
            manifest.service_types.append(types[0] if types else "")

        # Discover actions — heuristic: look for */_action/feedback topics
        feedback_suffix = "/_action/feedback"
        for name, types in self.get_topic_names_and_types():
            if name.endswith(feedback_suffix):
                action_name = name[: -len(feedback_suffix)]
                if not self._should_include(action_name, ns_prefix):
                    continue
                action_type = types[0] if types else ""
                # Convert feedback type to action type
                if action_type.endswith("_FeedbackMessage"):
                    action_type = action_type[: -len("_FeedbackMessage")]
                manifest.action_names.append(action_name)
                manifest.action_types.append(action_type)

        return manifest

    def _should_include(self, name: str, ns_prefix: str) -> bool:
        """Check if a topic/service/action should be included in the manifest."""
        # Filter by namespace if set
        if ns_prefix and not name.startswith(ns_prefix):
            return False

        # Exclude ROS2 internal topics
        for prefix in _INTERNAL_PREFIXES:
            if name.startswith(prefix):
                return False

        return True


def main() -> None:
    """Entry point for the discovery node."""
    rclpy.init()
    node = DiscoveryNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
