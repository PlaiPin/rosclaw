"""
FollowerController - Robot Follow Control Logic

Computes Twist commands (linear_x, angular_z) for a differential drive robot
to follow a target person at a specified distance.

Also supports manual teleoperation commands:
- Move forward/backward for distance or time
- Turn left/right by angle
- Raw velocity commands
"""

import time
import threading
from dataclasses import dataclass, field
from typing import Optional, Callable
from enum import Enum
import math

from .person_tracker import DetectedPerson


class ControlMode(Enum):
    """Current control mode."""
    IDLE = "idle"
    FOLLOW = "follow"
    MANUAL = "manual"


@dataclass
class ManualCommand:
    """A manual movement command."""
    command_type: str  # "move", "turn", "velocity"
    linear_vel: float = 0.0  # m/s
    angular_vel: float = 0.0  # rad/s
    distance: Optional[float] = None  # meters (for move)
    angle: Optional[float] = None  # radians (for turn)
    duration: Optional[float] = None  # seconds
    start_time: float = 0.0
    completed: bool = False


@dataclass
class Twist:
    """ROS-compatible Twist message structure."""
    linear_x: float = 0.0   # Forward/backward velocity (m/s)
    linear_y: float = 0.0   # Lateral velocity (m/s) - usually 0 for diff drive
    linear_z: float = 0.0   # Vertical velocity (m/s) - usually 0
    angular_x: float = 0.0  # Roll rate (rad/s) - usually 0
    angular_y: float = 0.0  # Pitch rate (rad/s) - usually 0
    angular_z: float = 0.0  # Yaw rate (rad/s) - turning

    def __repr__(self):
        return f"Twist(linear_x={self.linear_x:.3f} m/s, angular_z={self.angular_z:.3f} rad/s)"

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            'linear': {'x': self.linear_x, 'y': self.linear_y, 'z': self.linear_z},
            'angular': {'x': self.angular_x, 'y': self.angular_y, 'z': self.angular_z}
        }

    def is_zero(self) -> bool:
        """Check if this is a zero/stop command."""
        return abs(self.linear_x) < 0.001 and abs(self.angular_z) < 0.001


@dataclass
class ControllerConfig:
    """Configuration for the follower controller."""
    # Target distance
    target_distance: float = 1.0  # meters
    
    # Velocity limits
    max_linear_vel: float = 0.5   # m/s
    max_angular_vel: float = 1.0  # rad/s
    
    # Proportional gains
    Kp_distance: float = 0.5  # Gain for distance error
    Kp_angular: float = 1.5   # Gain for angular error
    
    # Deadzones (ignore small errors)
    distance_deadzone: float = 0.05  # 5cm
    angular_deadzone: float = 0.05   # ~3 degrees
    
    # Smoothing (exponential moving average)
    smoothing_factor: float = 0.3  # 0 = no smoothing, 1 = instant response
    
    # Watchdog
    watchdog_timeout: float = 0.5  # seconds without detection before stopping


class FollowerController:
    """
    Computes velocity commands to follow a target person.
    
    Uses proportional control with smoothing, deadzones, and safety limits.
    Also supports manual teleoperation commands.
    """

    def __init__(self, config: Optional[ControllerConfig] = None):
        self.config = config or ControllerConfig()
        
        # State
        self.enabled = False
        self.mode = ControlMode.IDLE
        self.target_person_id: Optional[int] = None
        self.target_description: Optional[str] = None
        
        # Manual control state
        self._manual_command: Optional[ManualCommand] = None
        self._manual_start_position = 0.0  # Estimated position for distance tracking
        self._manual_start_angle = 0.0  # Estimated angle for turn tracking
        self._command_queue: list[ManualCommand] = []
        self._queue_lock = threading.Lock()
        
        # Smoothing state
        self._smoothed_linear = 0.0
        self._smoothed_angular = 0.0
        
        # Watchdog
        self._last_detection_time = 0.0
        
        # Last computed twist
        self._last_twist = Twist()
        
        # Odometry estimation (simple integration)
        self._estimated_distance = 0.0
        self._estimated_angle = 0.0
        self._last_update_time = time.time()
        
        # Statistics
        self._update_count = 0
        self._start_time = time.time()

    def start(self, target_description: Optional[str] = None):
        """Start following mode."""
        self.enabled = True
        self.mode = ControlMode.FOLLOW
        self.target_description = target_description
        self._last_detection_time = time.time()
        self._cancel_manual_commands()
        print(f"[CONTROLLER] Started following" + 
              (f" target: '{target_description}'" if target_description else ""))

    def stop(self):
        """Stop all movement and zero velocities."""
        self.enabled = False
        self.mode = ControlMode.IDLE
        self._smoothed_linear = 0.0
        self._smoothed_angular = 0.0
        self._last_twist = Twist()
        self._cancel_manual_commands()
        print("[CONTROLLER] Stopped")

    # ==========================================
    # Manual Teleoperation Commands
    # ==========================================

    def move(self, distance: float, velocity: Optional[float] = None) -> dict:
        """
        Move forward (positive) or backward (negative) by a distance.
        
        Args:
            distance: Distance in meters (positive=forward, negative=backward)
            velocity: Optional velocity in m/s (default: 0.3 m/s)
            
        Returns:
            Status dict
        """
        vel = velocity if velocity is not None else 0.3
        vel = min(abs(vel), self.config.max_linear_vel)
        if distance < 0:
            vel = -vel
        
        duration = abs(distance / vel) if vel != 0 else 0
        
        cmd = ManualCommand(
            command_type="move",
            linear_vel=vel,
            angular_vel=0.0,
            distance=abs(distance),
            duration=duration,
            start_time=time.time()
        )
        
        self._start_manual_command(cmd)
        
        return {
            'status': 'ok',
            'command': 'move',
            'distance': distance,
            'velocity': vel,
            'estimated_duration': duration
        }

    def turn(self, angle_degrees: float, angular_velocity: Optional[float] = None) -> dict:
        """
        Turn left (positive) or right (negative) by an angle.
        
        Args:
            angle_degrees: Angle in degrees (positive=left/CCW, negative=right/CW)
            angular_velocity: Optional angular velocity in rad/s (default: 0.5 rad/s)
            
        Returns:
            Status dict
        """
        angle_rad = math.radians(angle_degrees)
        vel = angular_velocity if angular_velocity is not None else 0.5
        vel = min(abs(vel), self.config.max_angular_vel)
        if angle_degrees < 0:
            vel = -vel
        
        duration = abs(angle_rad / vel) if vel != 0 else 0
        
        cmd = ManualCommand(
            command_type="turn",
            linear_vel=0.0,
            angular_vel=vel,
            angle=abs(angle_rad),
            duration=duration,
            start_time=time.time()
        )
        
        self._start_manual_command(cmd)
        
        return {
            'status': 'ok',
            'command': 'turn',
            'angle_degrees': angle_degrees,
            'angular_velocity': vel,
            'estimated_duration': duration
        }

    def move_for_time(self, duration: float, velocity: float = 0.3) -> dict:
        """
        Move forward/backward for a specified duration.
        
        Args:
            duration: Time in seconds
            velocity: Velocity in m/s (positive=forward, negative=backward)
            
        Returns:
            Status dict
        """
        vel = max(-self.config.max_linear_vel, 
                  min(self.config.max_linear_vel, velocity))
        
        cmd = ManualCommand(
            command_type="move",
            linear_vel=vel,
            angular_vel=0.0,
            duration=duration,
            start_time=time.time()
        )
        
        self._start_manual_command(cmd)
        
        return {
            'status': 'ok',
            'command': 'move_for_time',
            'duration': duration,
            'velocity': vel
        }

    def set_velocity(self, linear: float = 0.0, angular: float = 0.0, 
                     duration: Optional[float] = None) -> dict:
        """
        Set raw velocity command.
        
        Args:
            linear: Linear velocity in m/s
            angular: Angular velocity in rad/s
            duration: Optional duration in seconds (None = until next command)
            
        Returns:
            Status dict
        """
        linear = max(-self.config.max_linear_vel, 
                     min(self.config.max_linear_vel, linear))
        angular = max(-self.config.max_angular_vel, 
                      min(self.config.max_angular_vel, angular))
        
        cmd = ManualCommand(
            command_type="velocity",
            linear_vel=linear,
            angular_vel=angular,
            duration=duration,
            start_time=time.time()
        )
        
        self._start_manual_command(cmd)
        
        return {
            'status': 'ok',
            'command': 'velocity',
            'linear': linear,
            'angular': angular,
            'duration': duration
        }

    def queue_command(self, cmd_type: str, **kwargs) -> dict:
        """Add a command to the queue to execute after current command."""
        with self._queue_lock:
            if cmd_type == "move":
                distance = kwargs.get('distance', 1.0)
                velocity = kwargs.get('velocity', 0.3)
                vel = min(abs(velocity), self.config.max_linear_vel)
                if distance < 0:
                    vel = -vel
                duration = abs(distance / vel) if vel != 0 else 0
                cmd = ManualCommand(
                    command_type="move",
                    linear_vel=vel,
                    distance=abs(distance),
                    duration=duration
                )
            elif cmd_type == "turn":
                angle = kwargs.get('angle', 90)
                angle_rad = math.radians(angle)
                vel = kwargs.get('angular_velocity', 0.5)
                vel = min(abs(vel), self.config.max_angular_vel)
                if angle < 0:
                    vel = -vel
                duration = abs(angle_rad / vel) if vel != 0 else 0
                cmd = ManualCommand(
                    command_type="turn",
                    angular_vel=vel,
                    angle=abs(angle_rad),
                    duration=duration
                )
            elif cmd_type == "wait":
                duration = kwargs.get('duration', 1.0)
                cmd = ManualCommand(
                    command_type="velocity",
                    linear_vel=0,
                    angular_vel=0,
                    duration=duration
                )
            else:
                return {'status': 'error', 'message': f'Unknown command type: {cmd_type}'}
            
            self._command_queue.append(cmd)
            
            return {
                'status': 'ok',
                'message': f'Command queued (queue length: {len(self._command_queue)})',
                'queue_length': len(self._command_queue)
            }

    def execute_sequence(self, commands: list[dict]) -> dict:
        """
        Execute a sequence of movement commands.
        
        Args:
            commands: List of command dicts, e.g.:
                [
                    {"type": "move", "distance": 1.0},
                    {"type": "turn", "angle": -90},
                    {"type": "move", "distance": 2.0},
                    {"type": "wait", "duration": 1.0}
                ]
                
        Returns:
            Status dict
        """
        self._cancel_manual_commands()
        
        for cmd_dict in commands:
            cmd_type = cmd_dict.get('type', cmd_dict.get('command'))
            self.queue_command(cmd_type, **cmd_dict)
        
        # Start first command
        self._start_next_queued_command()
        
        return {
            'status': 'ok',
            'message': f'Executing sequence of {len(commands)} commands',
            'commands': len(commands)
        }

    def _start_manual_command(self, cmd: ManualCommand):
        """Start executing a manual command."""
        self.mode = ControlMode.MANUAL
        self.enabled = True
        self._manual_command = cmd
        self._manual_command.start_time = time.time()
        self._manual_start_position = self._estimated_distance
        self._manual_start_angle = self._estimated_angle
        print(f"[CONTROLLER] Manual {cmd.command_type}: "
              f"linear={cmd.linear_vel:.2f}m/s, angular={cmd.angular_vel:.2f}rad/s"
              + (f", duration={cmd.duration:.1f}s" if cmd.duration else ""))

    def _cancel_manual_commands(self):
        """Cancel current manual command and clear queue."""
        self._manual_command = None
        with self._queue_lock:
            self._command_queue.clear()

    def _start_next_queued_command(self):
        """Start the next command in the queue."""
        with self._queue_lock:
            if self._command_queue:
                cmd = self._command_queue.pop(0)
                self._start_manual_command(cmd)
            else:
                # Queue empty, stop
                self._manual_command = None
                self.mode = ControlMode.IDLE
                self.enabled = False
                print("[CONTROLLER] Command sequence complete")

    def _update_manual_command(self) -> Twist:
        """Update manual command execution and return twist."""
        if not self._manual_command:
            return Twist()
        
        cmd = self._manual_command
        elapsed = time.time() - cmd.start_time
        
        # Check completion conditions
        completed = False
        
        if cmd.duration is not None and elapsed >= cmd.duration:
            completed = True
        
        if cmd.command_type == "move" and cmd.distance is not None:
            traveled = abs(self._estimated_distance - self._manual_start_position)
            if traveled >= cmd.distance:
                completed = True
        
        if cmd.command_type == "turn" and cmd.angle is not None:
            turned = abs(self._estimated_angle - self._manual_start_angle)
            if turned >= cmd.angle:
                completed = True
        
        if completed:
            cmd.completed = True
            print(f"[CONTROLLER] Manual command completed")
            self._start_next_queued_command()
            if self._manual_command is None:
                return Twist()
            cmd = self._manual_command
        
        return Twist(linear_x=cmd.linear_vel, angular_z=cmd.angular_vel)

    def get_manual_status(self) -> dict:
        """Get status of manual control."""
        cmd = self._manual_command
        if not cmd:
            return {
                'active': False,
                'queue_length': len(self._command_queue)
            }
        
        elapsed = time.time() - cmd.start_time
        remaining = (cmd.duration - elapsed) if cmd.duration else None
        
        return {
            'active': True,
            'command_type': cmd.command_type,
            'linear_vel': cmd.linear_vel,
            'angular_vel': cmd.angular_vel,
            'elapsed': elapsed,
            'remaining': remaining,
            'queue_length': len(self._command_queue)
        }

    def set_target_distance(self, distance: float):
        """Set the target follow distance in meters."""
        self.config.target_distance = max(0.3, min(5.0, distance))  # Clamp 0.3-5m
        print(f"[CONTROLLER] Target distance set to {self.config.target_distance:.2f}m")

    def set_target_person(self, person_id: int):
        """Lock onto a specific person ID."""
        self.target_person_id = person_id
        print(f"[CONTROLLER] Locked onto Person #{person_id}")

    def clear_target_person(self):
        """Clear target lock, follow closest person."""
        self.target_person_id = None
        self.target_description = None
        print("[CONTROLLER] Target cleared, following closest person")

    def update(self, target_person: Optional[DetectedPerson]) -> Twist:
        """
        Compute velocity command based on mode and target.
        
        Args:
            target_person: The person to follow, or None if not detected
            
        Returns:
            Twist command
        """
        self._update_count += 1
        current_time = time.time()
        dt = current_time - self._last_update_time
        self._last_update_time = current_time
        
        # Update odometry estimation from last twist
        if dt > 0 and dt < 1.0:  # Sanity check
            self._estimated_distance += self._last_twist.linear_x * dt
            self._estimated_angle += self._last_twist.angular_z * dt
        
        # If disabled, return zero
        if not self.enabled:
            return Twist()
        
        # Handle manual control mode
        if self.mode == ControlMode.MANUAL:
            twist = self._update_manual_command()
            self._last_twist = twist
            
            # Print status periodically
            if self._update_count % 30 == 0:
                cmd = self._manual_command
                if cmd:
                    print(f"[MANUAL] {cmd.command_type}: "
                          f"linear={twist.linear_x:.2f}m/s, angular={twist.angular_z:.2f}rad/s")
            
            return twist
        
        # Follow mode - need a target person
        if self.mode != ControlMode.FOLLOW:
            return Twist()
        
        # Watchdog check
        if target_person is None:
            if current_time - self._last_detection_time > self.config.watchdog_timeout:
                # Watchdog triggered - stop
                if self._update_count % 30 == 0:  # Print every ~1 second at 30Hz
                    print("[CONTROLLER] Watchdog: No person detected, stopping")
                self._smoothed_linear = 0.0
                self._smoothed_angular = 0.0
                self._last_twist = Twist()
                return Twist()
            else:
                # Brief dropout, maintain last command
                return self._last_twist
        
        self._last_detection_time = current_time
        
        # Calculate errors
        distance_error = target_person.z - self.config.target_distance
        angular_error = -math.atan2(target_person.x, target_person.z)  # Negative because x>0 means person is to the right
        
        # Apply deadzones
        if abs(distance_error) < self.config.distance_deadzone:
            distance_error = 0.0
        if abs(angular_error) < self.config.angular_deadzone:
            angular_error = 0.0
        
        # Compute raw velocities (proportional control)
        linear_cmd = self.config.Kp_distance * distance_error
        angular_cmd = self.config.Kp_angular * angular_error
        
        # Clamp to limits
        linear_cmd = max(-self.config.max_linear_vel, 
                         min(self.config.max_linear_vel, linear_cmd))
        angular_cmd = max(-self.config.max_angular_vel, 
                          min(self.config.max_angular_vel, angular_cmd))
        
        # Apply smoothing (exponential moving average)
        alpha = self.config.smoothing_factor
        self._smoothed_linear = alpha * linear_cmd + (1 - alpha) * self._smoothed_linear
        self._smoothed_angular = alpha * angular_cmd + (1 - alpha) * self._smoothed_angular
        
        # Create twist
        twist = Twist(
            linear_x=self._smoothed_linear,
            angular_z=self._smoothed_angular
        )
        
        self._last_twist = twist
        
        # Print status periodically
        if self._update_count % 10 == 0:  # Every ~0.3s at 30Hz
            self._print_status(target_person, twist, distance_error, angular_error)
        
        return twist

    def _print_status(self, person: DetectedPerson, twist: Twist,
                      dist_err: float, ang_err: float):
        """Print formatted status to console."""
        print(f"[DETECTION] Person #{person.id}: "
              f"distance={person.z:.2f}m, x={person.x:.2f}m "
              f"(conf={person.confidence:.0%})")
        
        print(f"[TARGET] Following Person #{person.id} "
              f"(target: {self.config.target_distance:.1f}m, "
              f"error: {dist_err:+.2f}m)")
        
        print(f"[TWIST] linear_x={twist.linear_x:+.3f} m/s, "
              f"angular_z={twist.angular_z:+.3f} rad/s")
        print()  # Blank line for readability

    def get_status(self) -> dict:
        """Get current controller status."""
        status = {
            'enabled': self.enabled,
            'mode': self.mode.value,
            'target_distance': self.config.target_distance,
            'target_person_id': self.target_person_id,
            'target_description': self.target_description,
            'last_twist': self._last_twist.to_dict(),
            'max_linear_vel': self.config.max_linear_vel,
            'max_angular_vel': self.config.max_angular_vel,
            'watchdog_timeout': self.config.watchdog_timeout,
            'update_count': self._update_count,
            'uptime': time.time() - self._start_time
        }
        
        # Add manual control status if active
        if self.mode == ControlMode.MANUAL:
            status['manual'] = self.get_manual_status()
        
        return status

    @staticmethod
    def print_twist(twist: Twist):
        """Print a twist command in ROS-compatible format."""
        print("---")
        print("linear:")
        print(f"  x: {twist.linear_x:.6f}")
        print(f"  y: {twist.linear_y:.6f}")
        print(f"  z: {twist.linear_z:.6f}")
        print("angular:")
        print(f"  x: {twist.angular_x:.6f}")
        print(f"  y: {twist.angular_y:.6f}")
        print(f"  z: {twist.angular_z:.6f}")
        print("---")
