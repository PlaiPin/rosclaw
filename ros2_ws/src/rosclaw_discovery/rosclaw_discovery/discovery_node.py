"""
RosClaw Discovery Node

Introspects the running ROS2 system and publishes a capability manifest
describing available topics, services, and actions. This manifest is consumed
by the OpenClaw plugin to inform the AI agent about what the robot can do.
"""

# TODO: Implement discovery node
# - Periodically query the ROS2 graph for topics, services, and actions
# - Publish a JSON capability manifest to a well-known topic
# - Support filtering by namespace
# - Handle dynamic changes (new nodes coming online/offline)


def main() -> None:
    """Entry point for the discovery node."""
    # TODO: Initialize rclpy, create node, spin
    # import rclpy
    # from rclpy.node import Node
    # from std_msgs.msg import String
    #
    # rclpy.init()
    # node = DiscoveryNode()
    # rclpy.spin(node)
    # node.destroy_node()
    # rclpy.shutdown()
    print("rosclaw_discovery: not yet implemented")


if __name__ == "__main__":
    main()
