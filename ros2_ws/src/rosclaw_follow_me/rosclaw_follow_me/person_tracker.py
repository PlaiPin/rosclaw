"""
PersonTracker - RealSense + MediaPipe Person Detection

Uses pyrealsense2 for depth + color frames and MediaPipe Pose
for fast person detection with 3D position estimation.
"""

import time
import numpy as np
from dataclasses import dataclass, field
from typing import Optional
import threading

try:
    import pyrealsense2 as rs
    REALSENSE_AVAILABLE = True
except ImportError:
    REALSENSE_AVAILABLE = False
    print("[WARN] pyrealsense2 not available - using mock camera")

try:
    import mediapipe as mp
    # Check if using new Tasks API (0.10.x+) or legacy Solutions API
    if hasattr(mp, 'solutions'):
        MEDIAPIPE_API = 'solutions'
    elif hasattr(mp, 'tasks'):
        MEDIAPIPE_API = 'tasks'
    else:
        MEDIAPIPE_API = None
    MEDIAPIPE_AVAILABLE = MEDIAPIPE_API is not None
    if not MEDIAPIPE_AVAILABLE:
        print("[WARN] mediapipe installed but no compatible API found")
except ImportError:
    MEDIAPIPE_AVAILABLE = False
    MEDIAPIPE_API = None
    print("[WARN] mediapipe not available - using mock detection")

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False


@dataclass
class DetectedPerson:
    """Represents a detected person with 3D position."""
    id: int
    x: float  # meters, positive = right of camera
    y: float  # meters, positive = down
    z: float  # meters, depth/distance from camera
    confidence: float  # 0.0 to 1.0
    bbox: tuple[int, int, int, int]  # x, y, width, height in pixels
    landmarks: Optional[list] = None  # MediaPipe pose landmarks
    last_seen: float = field(default_factory=time.time)

    @property
    def distance(self) -> float:
        """Euclidean distance from camera."""
        return np.sqrt(self.x**2 + self.y**2 + self.z**2)

    def __repr__(self):
        return f"Person #{self.id}: x={self.x:.2f}m, y={self.y:.2f}m, z={self.z:.2f}m (conf={self.confidence:.2f})"


class PersonTracker:
    """
    Tracks people using RealSense depth camera and MediaPipe Pose.
    
    Provides real-time detection at ~30 Hz with 3D position estimation.
    """

    def __init__(self, use_camera: bool = True):
        self.use_camera = use_camera and REALSENSE_AVAILABLE
        self.running = False
        self.lock = threading.Lock()
        
        # Detected persons (thread-safe access via lock)
        self._persons: list[DetectedPerson] = []
        self._latest_color_frame: Optional[np.ndarray] = None
        self._latest_depth_frame: Optional[np.ndarray] = None
        
        # Tracking state
        self._next_person_id = 1
        self._tracking_history: dict[int, DetectedPerson] = {}
        
        # Camera intrinsics (will be set from RealSense)
        self.fx = 600.0  # focal length x (pixels)
        self.fy = 600.0  # focal length y (pixels)
        self.cx = 320.0  # principal point x
        self.cy = 240.0  # principal point y
        self.depth_scale = 0.001  # depth units to meters
        
        # RealSense pipeline
        self.pipeline = None
        self.align = None
        
        # MediaPipe
        self.mp_pose = None
        self.pose = None
        
        if self.use_camera:
            self._init_realsense()
        
        if MEDIAPIPE_AVAILABLE:
            self._init_mediapipe()

    def _init_realsense(self):
        """Initialize RealSense camera pipeline."""
        try:
            self.pipeline = rs.pipeline()
            config = rs.config()
            
            # Configure streams
            config.enable_stream(rs.stream.depth, 640, 480, rs.format.z16, 30)
            config.enable_stream(rs.stream.color, 640, 480, rs.format.bgr8, 30)
            
            # Start pipeline
            profile = self.pipeline.start(config)
            
            # Get depth scale
            depth_sensor = profile.get_device().first_depth_sensor()
            self.depth_scale = depth_sensor.get_depth_scale()
            
            # Get camera intrinsics
            depth_stream = profile.get_stream(rs.stream.depth)
            intrinsics = depth_stream.as_video_stream_profile().get_intrinsics()
            self.fx = intrinsics.fx
            self.fy = intrinsics.fy
            self.cx = intrinsics.ppx
            self.cy = intrinsics.ppy
            
            # Align depth to color
            self.align = rs.align(rs.stream.color)
            
            print(f"[INFO] RealSense initialized: {intrinsics.width}x{intrinsics.height}")
            print(f"[INFO] Depth scale: {self.depth_scale}")
            
        except Exception as e:
            print(f"[ERROR] Failed to initialize RealSense: {e}")
            self.use_camera = False
            self.pipeline = None

    def _init_mediapipe(self):
        """Initialize MediaPipe Pose."""
        if MEDIAPIPE_API == 'solutions':
            # Legacy API (mediapipe < 0.10)
            self.mp_pose = mp.solutions.pose
            self.pose = self.mp_pose.Pose(
                static_image_mode=False,
                model_complexity=1,  # 0=lite, 1=full, 2=heavy
                enable_segmentation=False,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5
            )
            print("[INFO] MediaPipe Pose initialized (solutions API)")
        elif MEDIAPIPE_API == 'tasks':
            # New Tasks API (mediapipe >= 0.10)
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision as mp_vision
            
            # For Tasks API, we need to download the model
            # We'll use a simpler approach with pose landmarker
            try:
                base_options = mp_python.BaseOptions(
                    model_asset_path=self._get_pose_model_path()
                )
                options = mp_vision.PoseLandmarkerOptions(
                    base_options=base_options,
                    running_mode=mp_vision.RunningMode.VIDEO,
                    num_poses=5,
                    min_pose_detection_confidence=0.5,
                    min_tracking_confidence=0.5
                )
                self.pose = mp_vision.PoseLandmarker.create_from_options(options)
                self.mp_pose = None  # Not used in Tasks API
                self._mp_vision = mp_vision
                print("[INFO] MediaPipe Pose initialized (tasks API)")
            except Exception as e:
                print(f"[WARN] Failed to init MediaPipe Tasks: {e}")
                print("[INFO] Falling back to simple detection")
                self.pose = None
                self.mp_pose = None
        else:
            self.pose = None
            self.mp_pose = None
    
    def _get_pose_model_path(self) -> str:
        """Get or download the pose landmarker model."""
        import os
        import urllib.request
        
        model_dir = os.path.expanduser("~/.cache/mediapipe")
        os.makedirs(model_dir, exist_ok=True)
        model_path = os.path.join(model_dir, "pose_landmarker_lite.task")
        
        if not os.path.exists(model_path):
            print("[INFO] Downloading MediaPipe pose model...")
            url = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
            urllib.request.urlretrieve(url, model_path)
            print("[INFO] Model downloaded")
        
        return model_path

    def start(self):
        """Start the tracking loop in a background thread."""
        if self.running:
            return
        
        self.running = True
        self._thread = threading.Thread(target=self._tracking_loop, daemon=True)
        self._thread.start()
        print("[INFO] PersonTracker started")

    def stop(self):
        """Stop the tracking loop."""
        self.running = False
        if hasattr(self, '_thread'):
            self._thread.join(timeout=1.0)
        
        if self.pipeline:
            self.pipeline.stop()
        
        if self.pose:
            self.pose.close()
        
        print("[INFO] PersonTracker stopped")

    def _tracking_loop(self):
        """Main tracking loop running at ~30 Hz."""
        while self.running:
            try:
                if self.use_camera and self.pipeline:
                    self._process_camera_frame()
                else:
                    self._generate_mock_data()
                
                time.sleep(1/30)  # Target 30 Hz
                
            except Exception as e:
                print(f"[ERROR] Tracking loop error: {e}")
                time.sleep(0.1)

    def _process_camera_frame(self):
        """Process a frame from the RealSense camera."""
        frames = self.pipeline.wait_for_frames()
        
        # Align depth to color
        aligned_frames = self.align.process(frames)
        depth_frame = aligned_frames.get_depth_frame()
        color_frame = aligned_frames.get_color_frame()
        
        if not depth_frame or not color_frame:
            return
        
        # Convert to numpy
        depth_image = np.asanyarray(depth_frame.get_data())
        color_image = np.asanyarray(color_frame.get_data())
        
        # Store latest frames
        with self.lock:
            self._latest_color_frame = color_image.copy()
            self._latest_depth_frame = depth_image.copy()
        
        # Detect people
        persons = self._detect_persons(color_image, depth_image)
        
        # Update tracked persons with ID continuity
        self._update_tracking(persons)

    def _detect_persons(self, color_image: np.ndarray, depth_image: np.ndarray) -> list[DetectedPerson]:
        """Detect persons in the frame using MediaPipe."""
        if not MEDIAPIPE_AVAILABLE or self.pose is None:
            # Fall back to simple detection if no MediaPipe
            return self._simple_detect_persons(color_image, depth_image)
        
        h, w = color_image.shape[:2]
        
        if MEDIAPIPE_API == 'solutions':
            return self._detect_persons_solutions(color_image, depth_image)
        elif MEDIAPIPE_API == 'tasks':
            return self._detect_persons_tasks(color_image, depth_image)
        else:
            return self._simple_detect_persons(color_image, depth_image)

    def _detect_persons_solutions(self, color_image: np.ndarray, depth_image: np.ndarray) -> list[DetectedPerson]:
        """Detect using legacy Solutions API."""
        # Convert BGR to RGB for MediaPipe
        rgb_image = cv2.cvtColor(color_image, cv2.COLOR_BGR2RGB) if CV2_AVAILABLE else color_image
        
        # Process with MediaPipe
        results = self.pose.process(rgb_image)
        
        if not results.pose_landmarks:
            return []
        
        persons = []
        h, w = color_image.shape[:2]
        
        # Get landmarks
        landmarks = results.pose_landmarks.landmark
        
        # Calculate bounding box from pose landmarks
        x_coords = [lm.x * w for lm in landmarks if lm.visibility > 0.5]
        y_coords = [lm.y * h for lm in landmarks if lm.visibility > 0.5]
        
        if not x_coords or not y_coords:
            return []
        
        # Bounding box with padding
        padding = 20
        x_min = max(0, int(min(x_coords)) - padding)
        y_min = max(0, int(min(y_coords)) - padding)
        x_max = min(w, int(max(x_coords)) + padding)
        y_max = min(h, int(max(y_coords)) + padding)
        
        bbox = (x_min, y_min, x_max - x_min, y_max - y_min)
        
        # Get center point (use hip center for more stable depth)
        left_hip = landmarks[self.mp_pose.PoseLandmark.LEFT_HIP]
        right_hip = landmarks[self.mp_pose.PoseLandmark.RIGHT_HIP]
        
        center_x = int((left_hip.x + right_hip.x) / 2 * w)
        center_y = int((left_hip.y + right_hip.y) / 2 * h)
        
        # Clamp to image bounds
        center_x = max(0, min(w - 1, center_x))
        center_y = max(0, min(h - 1, center_y))
        
        # Get depth at center (average over small region for stability)
        depth_region = depth_image[
            max(0, center_y - 5):min(h, center_y + 5),
            max(0, center_x - 5):min(w, center_x + 5)
        ]
        
        # Filter out zero/invalid depths
        valid_depths = depth_region[depth_region > 0]
        if len(valid_depths) == 0:
            return []
        
        depth_value = np.median(valid_depths) * self.depth_scale  # Convert to meters
        
        # Convert pixel to 3D coordinates
        x_3d = (center_x - self.cx) * depth_value / self.fx
        y_3d = (center_y - self.cy) * depth_value / self.fy
        z_3d = depth_value
        
        # Calculate confidence from landmark visibility
        visibility_sum = sum(lm.visibility for lm in landmarks)
        confidence = visibility_sum / len(landmarks)
        
        person = DetectedPerson(
            id=0,  # Will be assigned in _update_tracking
            x=x_3d,
            y=y_3d,
            z=z_3d,
            confidence=confidence,
            bbox=bbox,
            landmarks=[(lm.x, lm.y, lm.z, lm.visibility) for lm in landmarks]
        )
        
        persons.append(person)
        
        return persons

    def _detect_persons_tasks(self, color_image: np.ndarray, depth_image: np.ndarray) -> list[DetectedPerson]:
        """Detect using new Tasks API (MediaPipe 0.10+)."""
        h, w = color_image.shape[:2]
        
        # Convert to RGB
        rgb_image = cv2.cvtColor(color_image, cv2.COLOR_BGR2RGB) if CV2_AVAILABLE else color_image
        
        # Create MediaPipe Image
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_image)
        
        # Get timestamp in milliseconds
        timestamp_ms = int(time.time() * 1000)
        
        # Detect poses
        try:
            results = self.pose.detect_for_video(mp_image, timestamp_ms)
        except Exception as e:
            print(f"[WARN] Pose detection failed: {e}")
            return []
        
        if not results.pose_landmarks:
            return []
        
        persons = []
        
        # Process each detected pose
        for pose_idx, pose_landmarks in enumerate(results.pose_landmarks):
            landmarks = pose_landmarks
            
            # Calculate bounding box
            x_coords = [lm.x * w for lm in landmarks if lm.visibility > 0.5]
            y_coords = [lm.y * h for lm in landmarks if lm.visibility > 0.5]
            
            if not x_coords or not y_coords:
                continue
            
            padding = 20
            x_min = max(0, int(min(x_coords)) - padding)
            y_min = max(0, int(min(y_coords)) - padding)
            x_max = min(w, int(max(x_coords)) + padding)
            y_max = min(h, int(max(y_coords)) + padding)
            
            bbox = (x_min, y_min, x_max - x_min, y_max - y_min)
            
            # Get center point (use hip landmarks - indices 23 and 24 in Tasks API)
            left_hip = landmarks[23] if len(landmarks) > 23 else landmarks[0]
            right_hip = landmarks[24] if len(landmarks) > 24 else landmarks[0]
            
            center_x = int((left_hip.x + right_hip.x) / 2 * w)
            center_y = int((left_hip.y + right_hip.y) / 2 * h)
            
            center_x = max(0, min(w - 1, center_x))
            center_y = max(0, min(h - 1, center_y))
            
            # Get depth
            depth_region = depth_image[
                max(0, center_y - 5):min(h, center_y + 5),
                max(0, center_x - 5):min(w, center_x + 5)
            ]
            
            valid_depths = depth_region[depth_region > 0]
            if len(valid_depths) == 0:
                continue
            
            depth_value = np.median(valid_depths) * self.depth_scale
            
            x_3d = (center_x - self.cx) * depth_value / self.fx
            y_3d = (center_y - self.cy) * depth_value / self.fy
            z_3d = depth_value
            
            visibility_sum = sum(lm.visibility for lm in landmarks)
            confidence = visibility_sum / len(landmarks)
            
            person = DetectedPerson(
                id=0,
                x=x_3d,
                y=y_3d,
                z=z_3d,
                confidence=confidence,
                bbox=bbox,
                landmarks=[(lm.x, lm.y, lm.z, lm.visibility) for lm in landmarks]
            )
            
            persons.append(person)
        
        return persons

    def _simple_detect_persons(self, color_image: np.ndarray, depth_image: np.ndarray) -> list[DetectedPerson]:
        """Simple depth-based person detection fallback."""
        h, w = color_image.shape[:2]
        
        # Simple approach: find the largest depth blob in the center region
        # This is a basic fallback when MediaPipe is not available
        
        # Focus on center 60% of the image
        margin_x = int(w * 0.2)
        margin_y = int(h * 0.1)
        
        center_depth = depth_image[margin_y:h-margin_y, margin_x:w-margin_x]
        
        # Find valid depth values between 0.5m and 4m
        min_depth = int(0.5 / self.depth_scale)
        max_depth = int(4.0 / self.depth_scale)
        
        valid_mask = (center_depth > min_depth) & (center_depth < max_depth)
        
        if not np.any(valid_mask):
            return []
        
        # Find the center of the valid region
        y_indices, x_indices = np.where(valid_mask)
        
        if len(x_indices) == 0:
            return []
        
        center_x = int(np.median(x_indices)) + margin_x
        center_y = int(np.median(y_indices)) + margin_y
        
        # Get depth at that point
        depth_value = depth_image[center_y, center_x] * self.depth_scale
        
        if depth_value <= 0:
            return []
        
        # Convert to 3D
        x_3d = (center_x - self.cx) * depth_value / self.fx
        y_3d = (center_y - self.cy) * depth_value / self.fy
        z_3d = depth_value
        
        # Create a rough bounding box
        bbox = (margin_x, margin_y, w - 2*margin_x, h - 2*margin_y)
        
        person = DetectedPerson(
            id=0,
            x=x_3d,
            y=y_3d,
            z=z_3d,
            confidence=0.5,  # Low confidence for simple detection
            bbox=bbox,
            landmarks=None
        )
        
        return [person]

    def _update_tracking(self, new_persons: list[DetectedPerson]):
        """Update tracking with ID continuity based on position."""
        current_time = time.time()
        
        # Match new detections to existing tracked persons
        for person in new_persons:
            best_match_id = None
            best_match_dist = float('inf')
            
            # Find closest existing person
            for tracked_id, tracked in self._tracking_history.items():
                # Only match if seen recently (within 500ms)
                if current_time - tracked.last_seen > 0.5:
                    continue
                
                # Calculate 3D distance
                dist = np.sqrt(
                    (person.x - tracked.x)**2 +
                    (person.y - tracked.y)**2 +
                    (person.z - tracked.z)**2
                )
                
                # Match if within 0.5m (person couldn't have moved further in one frame)
                if dist < 0.5 and dist < best_match_dist:
                    best_match_dist = dist
                    best_match_id = tracked_id
            
            if best_match_id is not None:
                person.id = best_match_id
            else:
                person.id = self._next_person_id
                self._next_person_id += 1
            
            person.last_seen = current_time
            self._tracking_history[person.id] = person
        
        # Clean up old tracks
        stale_ids = [
            pid for pid, p in self._tracking_history.items()
            if current_time - p.last_seen > 2.0  # Remove after 2 seconds
        ]
        for pid in stale_ids:
            del self._tracking_history[pid]
        
        # Update current persons list
        with self.lock:
            self._persons = new_persons.copy()

    def _generate_mock_data(self):
        """Generate mock person data for testing without camera."""
        t = time.time()
        
        # Simulate a person moving back and forth
        x = 0.3 * np.sin(t * 0.5)  # Side to side
        z = 1.5 + 0.5 * np.sin(t * 0.3)  # Forward/back
        
        mock_person = DetectedPerson(
            id=1,
            x=x,
            y=0.0,
            z=z,
            confidence=0.9,
            bbox=(200, 100, 200, 300),
            last_seen=t
        )
        
        with self.lock:
            self._persons = [mock_person]
            
            # Generate mock color frame
            if CV2_AVAILABLE:
                frame = np.zeros((480, 640, 3), dtype=np.uint8)
                # Draw a simple rectangle for the person
                cv2.rectangle(frame, (200, 100), (400, 400), (0, 255, 0), 2)
                cv2.putText(frame, f"Person #1 z={z:.2f}m", (200, 90),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                self._latest_color_frame = frame

    @property
    def persons(self) -> list[DetectedPerson]:
        """Get current list of detected persons (thread-safe)."""
        with self.lock:
            return self._persons.copy()

    @property
    def latest_frame(self) -> Optional[np.ndarray]:
        """Get latest color frame (thread-safe)."""
        with self.lock:
            if self._latest_color_frame is not None:
                return self._latest_color_frame.copy()
            return None

    def get_annotated_frame(self) -> Optional[np.ndarray]:
        """Get color frame with detection annotations."""
        frame = self.latest_frame
        if frame is None or not CV2_AVAILABLE:
            return frame
        
        persons = self.persons
        
        for person in persons:
            x, y, w, h = person.bbox
            
            # Draw bounding box
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            
            # Draw label
            label = f"#{person.id} z={person.z:.2f}m"
            cv2.putText(frame, label, (x, y - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        
        return frame

    def get_person_by_id(self, person_id: int) -> Optional[DetectedPerson]:
        """Get a specific person by ID."""
        for person in self.persons:
            if person.id == person_id:
                return person
        return None

    def get_closest_person(self) -> Optional[DetectedPerson]:
        """Get the closest detected person."""
        persons = self.persons
        if not persons:
            return None
        return min(persons, key=lambda p: p.distance)
