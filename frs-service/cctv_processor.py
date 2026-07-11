import cv2
import time
import logging
import threading
import os
import numpy as np
from datetime import datetime
import face_recognition
from ultralytics import YOLO

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
        
        # YOLO for Person (Sleeping) Detection
        self.yolo_model = YOLO("yolov8n.pt")
        self.last_sleeping_alert_time = 0
        self.current_section_rolls = None
        
        # PTZ Advanced Grid Scan State
        self.ptz_state = "idle"
        self.ptz_last_action_time = 0
        self.ptz_grid_index = 0
        self.ptz_zoom_level = 0
        self.ptz_zoom_retries = 0
        self.grid_presets = ["1", "2", "3", "4", "5", "6"]
        self.needs_zoom_flag = False
        
        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)

    def set_dependencies(self, scheduler, recognizer):
        self.scheduler = scheduler
        self.recognizer = recognizer
        
    def connect(self):
        import requests
        source = config.CAMERA_SOURCE
        try:
            url = f"{config.BACKEND_API_URL}/cameras"
            res = requests.get(url, timeout=15)
            if res.status_code == 200:
                data = res.json().get("data", [])
                if data and len(data) > 0:
                    dept_cameras = [c for c in data if str(c.get('section', '')).startswith(config.DEPARTMENT_NAME)]
                    
                    if dept_cameras:
                        target_cam = dept_cameras[0]
                        source = target_cam.get("ipAddress", source)
                        config.CAMERA_SOURCE = source
                        
                        room_number = target_cam.get("roomNumber", "Unknown")
                        section = target_cam.get("section", "Unknown")
                        department = config.DEPARTMENT_NAME
                        total_dept_cams = len(dept_cameras)
                        
                        logger.info(f"Dynamically loaded camera from DB: {source}")
                        logger.info(f"Camera Assignment -> Room: {room_number}, Section: {section}, Department: {department}")
                        logger.info(f"Total cameras mapped to {department} department: {total_dept_cams}")
                        
                        if self.scheduler:
                            students = self.scheduler.fetch_students_in_section(section)
                            rolls = [s.get("roll") for s in students if s.get("roll")]
                            self.current_section_rolls = rolls
                            logger.info(f"Loaded {len(rolls)} registered students for Section {section}:")
                            for idx, roll in enumerate(rolls, start=1):
                                # Check if biometric data exists in embeddings.json
                                bio_status = "✅ Biometric Registered"
                                if self.recognizer and roll not in self.recognizer.known_faces:
                                    bio_status = "❌ Biometric Pending"
                                logger.info(f"  {idx}. {roll} ({bio_status})")
                    else:
                        logger.warning(f"No cameras found in MERN DB for department {config.DEPARTMENT_NAME}. Please add them via Admin panel.")
                        # Keep fallback source if any, or it will fail gracefully and retry later
                        if self.scheduler:
                            logger.info(f"No students loaded because no camera is assigned to {config.DEPARTMENT_NAME} yet.")
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
        """Run face recognition on the frame and detect sleeping students."""
        if not self.scheduler or not self.scheduler.is_scanning:
            return []

        # CLAHE Enhancement for Dark/Sunlight issues
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        l_channel, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        cl = clahe.apply(l_channel)
        limg = cv2.merge((cl, a, b))
        enhanced_bgr = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
        rgb_frame = cv2.cvtColor(enhanced_bgr, cv2.COLOR_BGR2RGB)
        
        # 1. YOLOv8 Person Detection
        yolo_results = self.yolo_model(enhanced_bgr, classes=[0], verbose=False) # class 0 is 'person'
        person_boxes = []
        if len(yolo_results) > 0:
            for r in yolo_results[0].boxes.data.tolist():
                x1, y1, x2, y2, score, class_id = r
                if score > 0.4:
                    person_boxes.append((int(x1), int(y1), int(x2), int(y2)))

        # Blur Detection: Calculate variance of Laplacian on the gray frame
        gray_frame = cv2.cvtColor(enhanced_bgr, cv2.COLOR_BGR2GRAY)

        # 2. Face Recognition
        # If camera is pausing during grid scan, we upsample by 2 for better backbench detection
        upsample = 2 if self.ptz_state == "pausing" else 1
        with config.FACE_LOCK:
            face_locations = face_recognition.face_locations(rgb_frame, model="hog", number_of_times_to_upsample=upsample)
            face_encodings = face_recognition.face_encodings(rgb_frame, face_locations) if face_locations else []

        results = []
        needs_zoom_local = False
        for (top, right, bottom, left), encoding in zip(face_locations, face_encodings):
            
            # Check blur for this specific face
            face_roi = gray_frame[top:bottom, left:right]
            if face_roi.size > 0:
                blur_val = cv2.Laplacian(face_roi, cv2.CV_64F).var()
                if blur_val < 60.0:  # Threshold for blurriness
                    needs_zoom_local = True
            
            roll_no = None
            dist = 1.0
            if self.recognizer:
                roll_no, dist = self.recognizer.match_face(encoding, allowed_rolls=self.current_section_rolls)
            
            if roll_no is not None:
                results.append((roll_no, top, right, bottom, left, "Recognized"))
                if self.scheduler:
                    self.scheduler.record_detected_face(roll_no)
            else:
                results.append(("Unknown", top, right, bottom, left, "Unknown"))
                
        if needs_zoom_local:
            self.needs_zoom_flag = True
                
        # 3. Sleeping / Head Down Detection
        if person_boxes:
            for px1, py1, px2, py2 in person_boxes:
                has_face = False
                for ftop, fright, fbottom, fleft in face_locations:
                    fx_center = (fleft + fright) // 2
                    fy_center = (ftop + fbottom) // 2
                    if px1 <= fx_center <= px2 and py1 <= fy_center <= py2:
                        has_face = True
                        break
                        
                if not has_face:
                    current_time = time.time()
                    if current_time - self.last_sleeping_alert_time > 10: # Only alert once every 10 seconds to avoid spam
                        self.last_sleeping_alert_time = current_time
                        
                        alert_frame = frame.copy()
                        cv2.rectangle(alert_frame, (px1, py1), (px2, py2), (0, 0, 255), 4)
                        cv2.putText(alert_frame, "Sleeping / Head Down", (px1, py1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
                        
                        threading.Thread(target=self._upload_sleeping_alert, args=(alert_frame,)).start()
                    break

        return results

    def _upload_sleeping_alert(self, frame_img):
        import os
        import time
        import requests
        import base64
        
        try:
            os.makedirs(os.path.join(config.DATA_DIR, "alerts"), exist_ok=True)
            timestamp = int(time.time())
            temp_path = os.path.join(config.DATA_DIR, "alerts", f"sleeping_{timestamp}.jpg")
            cv2.imwrite(temp_path, frame_img)
            
            url = f"{config.BACKEND_API_URL}/alerts/sleeping"
            with open(temp_path, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode("utf-8")
                
            data = {
                "timestamp": timestamp,
                "image": "data:image/jpeg;base64," + img_b64
            }
            
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    res = requests.post(url, json=data, timeout=30)
                    if res.status_code == 200:
                        logger.info("Sleeping alert successfully uploaded to MERN cloud.")
                        break # Success
                    else:
                        logger.warning(f"Failed to upload sleeping alert. MERN returned: {res.status_code}")
                except requests.exceptions.RequestException as req_err:
                    logger.warning(f"Attempt {attempt + 1}/{max_retries} failed to upload sleeping alert: {req_err}")
                    if attempt < max_retries - 1:
                        time.sleep(2 * (attempt + 1)) # Exponential backoff
                    else:
                        logger.error("All retries failed for uploading sleeping alert.")
                
        except Exception as e:
            logger.error(f"Error preparing/uploading sleeping alert: {e}")

    def run(self):
        self.running = True
        self.capture_thread.start()
        
        last_processed_id = None
        while self.running:
            if not self.cap or not self.cap.isOpened():
                if not self.connect():
                    logger.error("Failed to connect to CCTV. Retrying in 5 seconds...")
                    time.sleep(5)
                    continue
                logger.info("CCTV Stream Connected. Initiating processing loop.")
            
            with self.frame_lock:
                raw_frame = self.latest_raw_frame
                current_id = id(raw_frame)
                
            if raw_frame is None or current_id == last_processed_id:
                time.sleep(0.03)
                continue
                
            last_processed_id = current_id
            frame = raw_frame.copy()
            
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
            
            # 2. PTZ Advanced Grid Scan Logic
            if self.scheduler and self.scheduler.is_scanning:
                if self.ptz_state == "idle":
                    self.ptz_state = "moving_to_preset"
                    self.ptz_last_action_time = current_time
                    self.ptz_grid_index = 0
                    self.ptz_zoom_retries = 0
                    preset = self.grid_presets[self.ptz_grid_index]
                    ptz.goto_preset(preset)
                    logger.info(f"Advanced Grid Scan started. Moving to Sector {preset}.")
                
                elif self.ptz_state == "moving_to_preset":
                    # Wait 3 seconds for camera to reach preset
                    if current_time - self.ptz_last_action_time > 3.0:
                        ptz.stop()
                        self.ptz_state = "pausing"
                        self.ptz_last_action_time = current_time
                        self.needs_zoom_flag = False
                        
                elif self.ptz_state == "pausing":
                    # Pause for 3 seconds to scan the current area thoroughly
                    if current_time - self.ptz_last_action_time > 3.0:
                        if self.needs_zoom_flag and self.ptz_zoom_retries < 2:
                            # Face was blurry, zoom in and try again
                            self.ptz_state = "zooming_in"
                            self.ptz_last_action_time = current_time
                            self.ptz_zoom_retries += 1
                            ptz.move(pan_speed=0.0, tilt_speed=0.0, zoom_speed=0.5)
                            logger.info(f"Blurry faces detected in Sector {self.grid_presets[self.ptz_grid_index]}. Zooming in (Attempt {self.ptz_zoom_retries}).")
                        else:
                            # Move to next grid
                            self.ptz_grid_index += 1
                            if self.ptz_grid_index >= len(self.grid_presets):
                                # Restart grid if scan is still active
                                self.ptz_grid_index = 0
                                logger.info("Completed one full room sweep. Restarting sweep.")
                                
                            self.ptz_state = "moving_to_preset"
                            self.ptz_last_action_time = current_time
                            self.ptz_zoom_retries = 0
                            preset = self.grid_presets[self.ptz_grid_index]
                            ptz.goto_preset(preset)
                            
                elif self.ptz_state == "zooming_in":
                    # Zoom in for 1.5 seconds
                    if current_time - self.ptz_last_action_time > 1.5:
                        ptz.stop()
                        self.ptz_state = "pausing"
                        self.ptz_last_action_time = current_time
                        self.needs_zoom_flag = False
            else:
                if self.ptz_state != "idle":
                    ptz.stop()
                    self.ptz_state = "idle"
                    self.ptz_grid_index = 0
                    logger.info("Scan session ended. PTZ Advanced Grid Scan stopped.")

            # 3. AI Face Recognition
            faces = self.latest_faces  # Keep previous faces by default
            if self.motion_detected and self.scheduler and self.scheduler.is_scanning:
                # Only scan if pausing to prevent blur, but don't delete old boxes immediately
                if self.ptz_state == "pausing":
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
