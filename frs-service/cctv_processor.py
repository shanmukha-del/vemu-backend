import cv2
import time
import logging
import threading
import os
import numpy as np
from datetime import datetime
import face_recognition

import config
from ptz_controller import ptz
logger = logging.getLogger("CCTVProcessor")

class CCTVProcessor(threading.Thread):
    def __init__(self):
        super().__init__()
        self.daemon = True
        self.running = False
        self.cap = None
        
        # Motion detection (Background Subtractor MOG2)
        self.back_sub = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=50, detectShadows=True)
        self.min_contour_area = 3000  
        
        self.motion_detected = False
        self.last_motion_time = 0
        self.motion_timeout = 2.0  
        
        # Threading buffers
        self.latest_raw_frame = None
        self.latest_faces = [] # Store async bounding boxes
        self.frame_lock = threading.Lock()
        
        self.scheduler = None
        self.recognizer = None
        
        # PTZ Auto Tour State
        self.ptz_state = "idle"
        self.ptz_last_action_time = 0
        self.ptz_pans_done = 0
        self.ptz_direction = 0.5  # Positive = right
        
        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)

    def set_dependencies(self, scheduler, recognizer):
        self.scheduler = scheduler
        self.recognizer = recognizer
        
    def connect(self):
        import requests
        source = config.CAMERA_SOURCE
        try:
            url = f"{config.BACKEND_API_URL}/cameras"
            res = requests.get(url, timeout=5)
            if res.status_code == 200:
                data = res.json().get("data", [])
                if data and len(data) > 0:
                    source = data[0].get("ipAddress", source)
                    config.CAMERA_SOURCE = source
                    logger.info(f"Dynamically loaded camera from database: {source}")
        except Exception as e:
            logger.warning(f"Could not fetch dynamic camera URL from DB, using fallback. Error: {e}")

        logger.info(f"Connecting to CCTV stream: {source}")
        
        if isinstance(source, str) and source.startswith("rtsp://"):
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|allowed_media_types;video"
            import re
            ip_match = re.search(r'@([0-9\.]+):?', source)
            if ip_match:
                cam_ip = ip_match.group(1)
                ptz.set_camera(cam_ip)
            
        if self.cap is not None:
            self.cap.release()
            
        self.cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
        if hasattr(cv2, 'CAP_PROP_BUFFERSIZE'):
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
            
        return self.cap.isOpened()

    def _capture_loop(self):
        """Zero-lag dedicated thread for pulling frames from the camera."""
        fail_count = 0
        while self.running:
            if self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret:
                    fail_count = 0
                    with self.frame_lock:
                        self.latest_raw_frame = frame
                else:
                    fail_count += 1
                    if fail_count > 30:
                        logger.error("Camera stream timed out. Forcing reconnect...")
                        self.cap.release()
                        fail_count = 0
                    time.sleep(0.01)
            else:
                time.sleep(0.5)

    def process_faces(self, frame):
        """Run face recognition on the frame."""
        if not self.scheduler or not self.scheduler.is_scanning:
            return []

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Scale down for faster and more reliable HOG processing
        small_frame = cv2.resize(rgb_frame, (0, 0), fx=0.5, fy=0.5)
        
        with config.FACE_LOCK:
            # upsample=2 for much higher accuracy on smaller faces
            face_locations = face_recognition.face_locations(small_frame, model="hog", number_of_times_to_upsample=2)
            if not face_locations:
                return []
            face_encodings = face_recognition.face_encodings(small_frame, face_locations)

        results = []
        for (top, right, bottom, left), encoding in zip(face_locations, face_encodings):
            top, right, bottom, left = top * 2, right * 2, bottom * 2, left * 2
            
            roll_no = None
            dist = 1.0
            if self.recognizer:
                roll_no, dist = self.recognizer.match_face(encoding)
            
            if roll_no is not None:
                results.append((roll_no, top, right, bottom, left, "Recognized"))
                if self.scheduler:
                    self.scheduler.record_detected_face(roll_no)
            else:
                results.append(("Unknown", top, right, bottom, left, "Unknown"))
                
        return results

    def run(self):
        self.running = True
        self.capture_thread.start()
        
        while self.running:
            if not self.cap or not self.cap.isOpened():
                if not self.connect():
                    logger.error("Failed to connect to CCTV. Retrying in 5 seconds...")
                    time.sleep(5)
                    continue
                logger.info("CCTV Stream Connected. Initiating processing loop.")
            
            with self.frame_lock:
                frame = self.latest_raw_frame.copy() if self.latest_raw_frame is not None else None
                
            if frame is None:
                time.sleep(0.05)
                continue
                
            # 1. Motion Detection
            fg_mask = self.back_sub.apply(frame)
            _, fg_mask = cv2.threshold(fg_mask, 200, 255, cv2.THRESH_BINARY)
            fg_mask = cv2.erode(fg_mask, None, iterations=1)
            fg_mask = cv2.dilate(fg_mask, None, iterations=2)
            contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            motion_this_frame = False
            for contour in contours:
                if cv2.contourArea(contour) > self.min_contour_area:
                    motion_this_frame = True
                    break
            
            current_time = time.time()
            if motion_this_frame:
                if not self.motion_detected:
                    logger.info("Motion detected!")
                self.motion_detected = True
                self.last_motion_time = current_time
            elif self.motion_detected and (current_time - self.last_motion_time > self.motion_timeout):
                self.motion_detected = False
            
            # 2. PTZ Auto Tour Logic
            if self.scheduler and self.scheduler.is_scanning:
                if self.ptz_state == "idle":
                    self.ptz_state = "moving"
                    self.ptz_last_action_time = current_time
                    ptz.move(pan_speed=self.ptz_direction, tilt_speed=0.0)
                    logger.info("Continuous Auto-Tour started.")
                
                elif self.ptz_state == "moving":
                    # Move for 1.5 seconds
                    if current_time - self.ptz_last_action_time > 1.5:
                        ptz.stop()
                        self.ptz_state = "pausing"
                        self.ptz_last_action_time = current_time
                        self.ptz_pans_done += 1
                        
                        if self.ptz_pans_done >= 4:
                            self.ptz_direction *= -1
                            self.ptz_pans_done = 0
                            
                elif self.ptz_state == "pausing":
                    # Pause for 2 seconds to scan the current area thoroughly without blur
                    if current_time - self.ptz_last_action_time > 2.0:
                        self.ptz_state = "moving"
                        self.ptz_last_action_time = current_time
                        ptz.move(pan_speed=self.ptz_direction, tilt_speed=0.0)
            else:
                if self.ptz_state != "idle":
                    ptz.stop()
                    self.ptz_state = "idle"
                    self.ptz_pans_done = 0
                    logger.info("Scan session ended. PTZ Auto-Tour stopped.")

            # 3. AI Face Recognition
            faces = self.latest_faces  # Keep previous faces by default
            if self.motion_detected and self.scheduler and self.scheduler.is_scanning:
                # Only scan if pausing to prevent blur, but don't delete old boxes immediately
                if self.ptz_state != "moving":
                    faces = self.process_faces(frame)
                else:
                    # Clear boxes when camera actually moves to avoid floating boxes
                    faces = []
            
            with self.frame_lock:
                self.latest_faces = faces
                
            time.sleep(0.01)

        if self.cap:
            self.cap.release()

    def get_latest_frame(self):
        """Returns the raw uncompressed 0-lag frame with async bounding boxes overlaid."""
        with self.frame_lock:
            if self.latest_raw_frame is None:
                return None
            frame = self.latest_raw_frame.copy()
            faces = self.latest_faces
            
        for (roll, top, right, bottom, left, status) in faces:
            color = (0, 255, 0) if roll != "Unknown" else (0, 0, 255)
            cv2.rectangle(frame, (left, top), (right, bottom), color, 2)
            cv2.putText(frame, roll, (left, top - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)
            
        return frame

    def stop(self):
        self.running = False
        if self.cap:
            self.cap.release()

cctv_processor = CCTVProcessor()
