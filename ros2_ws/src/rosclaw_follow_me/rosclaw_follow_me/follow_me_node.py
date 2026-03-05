"""
Follow Me ROS2 node.

Runs person tracking (RealSense + MediaPipe) and follower controller.
Publishes geometry_msgs/Twist to cmd_vel and advertises Follow Me services
for the RosClaw plugin.
"""

from __future__ import annotations

import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist as TwistMsg
from rosclaw_msgs.srv import (
    FollowMeStart,
    FollowMeStop,
    FollowMeSetDistance,
    FollowMeGetStatus,
    FollowMeSetTarget,
)

from .person_tracker import PersonTracker
from .follower_controller import FollowerController, ControllerConfig


def _twist_to_msg(linear_x: float, angular_z: float) -> TwistMsg:
    msg = TwistMsg()
    msg.linear.x = float(linear_x)
    msg.linear.y = 0.0
    msg.linear.z = 0.0
    msg.angular.x = 0.0
    msg.angular.y = 0.0
    msg.angular.z = float(angular_z)
    return msg


class FollowMeNode(Node):
    """ROS2 node: person tracking, follower control, cmd_vel publishing, Follow Me services."""

    def __init__(self) -> None:
        super().__init__("follow_me_node")

        self.declare_parameter("use_camera", True)
        self.declare_parameter("target_distance", 1.0)
        self.declare_parameter("cmd_vel_topic", "cmd_vel")

        use_camera = self.get_parameter("use_camera").value
        target_distance = float(self.get_parameter("target_distance").value)
        cmd_vel_topic = self.get_parameter("cmd_vel_topic").value

        self.tracker = PersonTracker(use_camera=use_camera)
        config = ControllerConfig(target_distance=target_distance)
        self.controller = FollowerController(config=config)

        self._cmd_vel_pub = self.create_publisher(TwistMsg, cmd_vel_topic, 10)
        self._control_timer = self.create_timer(1.0 / 30.0, self._control_callback)

        self.create_service(FollowMeStart, "follow_me/start", self._handle_start)
        self.create_service(FollowMeStop, "follow_me/stop", self._handle_stop)
        self.create_service(
            FollowMeSetDistance, "follow_me/set_distance", self._handle_set_distance
        )
        self.create_service(
            FollowMeGetStatus, "follow_me/get_status", self._handle_get_status
        )
        self.create_service(
            FollowMeSetTarget, "follow_me/set_target", self._handle_set_target
        )

        self.tracker.start()
        self.get_logger().info(
            f"Follow Me node started: cmd_vel={cmd_vel_topic}, "
            f"target_distance={target_distance}m, use_camera={use_camera}"
        )

    def _get_target_person(self):
        """Resolve target person from controller target_person_id or closest."""
        persons = self.tracker.persons
        if not persons:
            return None
        tid = self.controller.target_person_id
        if tid is not None:
            for p in persons:
                if p.id == tid:
                    return p
        return min(persons, key=lambda p: p.distance)

    def _control_callback(self) -> None:
        """Run at 30 Hz: update controller and publish cmd_vel."""
        target = self._get_target_person()
        twist = self.controller.update(target)
        msg = _twist_to_msg(twist.linear_x, twist.angular_z)
        self._cmd_vel_pub.publish(msg)

    def _handle_start(
        self, request: FollowMeStart.Request, response: FollowMeStart.Response
    ) -> FollowMeStart.Response:
        desc = request.target_description.strip() if request.target_description else ""
        if desc:
            self.controller.start(target_description=desc)
            response.success = True
            response.message = f"Started following: {desc}"
        else:
            self.controller.start()
            response.success = True
            response.message = "Started following closest person"
        return response

    def _handle_stop(
        self, request: FollowMeStop.Request, response: FollowMeStop.Response
    ) -> FollowMeStop.Response:
        self.controller.stop()
        response.success = True
        response.message = "Stopped following"
        return response

    def _handle_set_distance(
        self,
        request: FollowMeSetDistance.Request,
        response: FollowMeSetDistance.Response,
    ) -> FollowMeSetDistance.Response:
        d = float(request.distance)
        if d < 0.2 or d > 5.0:
            response.success = False
            response.target_distance = self.controller.config.target_distance
            return response
        self.controller.set_target_distance(d)
        response.success = True
        response.target_distance = self.controller.config.target_distance
        return response

    def _handle_get_status(
        self,
        request: FollowMeGetStatus.Request,
        response: FollowMeGetStatus.Response,
    ) -> FollowMeGetStatus.Response:
        response.success = True
        response.enabled = self.controller.enabled
        response.tracking = (
            self.controller.mode.value == "follow" and self._get_target_person() is not None
        )
        response.target_distance = self.controller.config.target_distance
        response.target_person_id = int(self.controller.target_person_id or 0)
        response.target_description = self.controller.target_description or ""
        response.persons_detected = len(self.tracker.persons)
        target = self._get_target_person()
        response.current_distance = float(target.z) if target else 0.0
        t = self.controller._last_twist
        response.twist.linear.x = t.linear_x
        response.twist.angular.z = t.angular_z
        response.error_message = ""
        return response

    def _handle_set_target(
        self,
        request: FollowMeSetTarget.Request,
        response: FollowMeSetTarget.Response,
    ) -> FollowMeSetTarget.Response:
        desc = (request.description or "").strip()
        if not desc:
            response.success = False
            response.message = "Missing description"
            return response
        persons = self.tracker.persons
        if not persons:
            response.success = False
            response.person_id = 0
            response.confidence = 0.0
            response.message = "No persons detected"
            return response
        # Without VLM we lock to closest person and store description
        closest = min(persons, key=lambda p: p.distance)
        self.controller.set_target_person(closest.id)
        self.controller.target_description = desc
        response.success = True
        response.person_id = int(closest.id)
        response.confidence = float(closest.confidence)
        response.message = f"Locked onto person #{closest.id} (closest match)"
        return response


def main(args=None):
    rclpy.init(args=args)
    node = FollowMeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.tracker.stop()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
