import time
import os
import numpy as np
import cv2
import logging
import base64
import socket
import requests
import threading
from fastapi import FastAPI, BackgroundTasks, Query, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import config
import face_recognition

from recognizer import FaceRecognizer
from anti_spoofing import AntiSpoofingClassifier
from scheduler import PassiveAttendanceScheduler
from cctv_processor import cctv_processor

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("FastAPI")

app = FastAPI(title="VEMU Face Recognition System Service", version="2.0.0")

@app.on_event("startup")
def startup_event():
    vemu_ascii = """\033[94m
 __      __  ______   __  __   _    _ 
 \ \    / / |  ____| |  \/  | | |  | |
  \ \  / /  | |__    | \  / | | |  | |
   \ \/ /   |  __|   | |\/| | | |  | |
    \  /    | |____  | |  | | | |__| |
     \/     |______| |_|  |_|  \____/ 
                                      \033[0m"""
    print(vemu_ascii)
    print("\033[94m***************** VEMU INSTITUTE OF TECHNOLOGY ******************\033[0m")
    print("\033[96m******** WELCOME TO VEMU FRS SYSTEM BACKEND ***********\033[0m\n")
    cctv_processor.start()
    attendance_scheduler.schedule_cron_jobs()
    threading.Thread(target=publish_frs_ip, daemon=True).start()

def publish_frs_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        logger.info(f"Detected FRS Local IP: {ip}. Publishing to MERN Backend...")
        payload = {
            "date": "2099-01-01",
            "subjectId": "FRS_SERVER_IP",
            "section": "SYSTEM",
            "period": "1",
            "records": [ip]
        }
        requests.post(f"{config.MERN_BACKEND_URL}/api/attendance/save", json=payload, timeout=5)
        logger.info("FRS IP successfully published to MERN backend for auto-discovery.")
    except Exception as e:
        logger.error(f"Failed to publish FRS IP: {e}")

@app.on_event("shutdown")
def shutdown_event():
    cctv_processor.stop()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

recognizer = FaceRecognizer()
anti_spoofer = AntiSpoofingClassifier()
attendance_scheduler = PassiveAttendanceScheduler()
cctv_processor.set_dependencies(attendance_scheduler, recognizer)

register_state = {
    "active": False,
    "roll": None,
    "samples": [],
    "status": "idle",
    "message": "",
    "last_capture_time": 0.0
}

class RegisterRequest(BaseModel):
    roll: str
    id: str

class ScanRequest(BaseModel):
    section: str
    subjectId: str
    period: str
    date: str = None
    duration: int = config.DEFAULT_SCAN_DURATION

class FrameRequest(BaseModel):
    image: str  # Base64 data URL

def decode_base64_image(base64_string):
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]
    img_data = base64.b64decode(base64_string)
    np_arr = np.frombuffer(img_data, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    return img

@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "registered_faces_count": len(recognizer.known_faces),
        "bypass_anti_spoofing": config.BYPASS_ANTI_SPOOFING
    }

@app.get("/api/registered_faces")
def get_registered_faces():
    return {
        "success": True,
        "rolls": list(recognizer.known_faces.keys())
    }

@app.post("/api/register/start")
def start_registration(data: RegisterRequest):
    global register_state
    if register_state["active"]:
        return JSONResponse(status_code=400, content={"success": False, "message": "A registration session is already active."})
    
    register_state = {
        "active": True,
        "roll": data.roll.upper().strip(),
        "samples": [],
        "status": "registering",
        "message": f"Please face the camera. Capturing biometric templates for {data.roll}.",
        "last_capture_time": 0.0
    }
    logger.info(f"Biometric registration started for Student Roll: {data.roll}")
    return {"success": True, "message": "Registration mode activated."}

@app.get("/api/register/status")
def get_registration_status():
    global register_state
    samples_count = len(register_state["samples"])
    if register_state["active"]:
        if samples_count < 3: direction = "LOOK STRAIGHT"
        elif samples_count < 6: direction = "TURN LEFT SLIGHTLY"
        elif samples_count < 9: direction = "TURN RIGHT SLIGHTLY"
        else: direction = "SMILE / TILT HEAD"
        register_state["message"] = f"GUIDE: {direction} ({samples_count}/10)"
    return {
        "active": register_state["active"],
        "roll": register_state["roll"],
        "samples_captured": samples_count,
        "status": register_state["status"],
        "message": register_state["message"]
    }

@app.post("/api/register/cancel")
def cancel_registration():
    global register_state
    register_state = {
        "active": False,
        "roll": None,
        "samples": [],
        "status": "idle",
        "message": "Registration cancelled.",
        "last_capture_time": 0.0
    }
    logger.info("Biometric registration cancelled.")
    return {"success": True}

@app.post("/api/register/frame")
def process_register_frame(req: FrameRequest):
    global register_state
    
    if not register_state["active"]:
        return {"success": False, "message": "Registration is not active."}
    
    try:
        frame = decode_base64_image(req.image)
        if frame is None:
            return {"success": False, "message": "Invalid image format"}
    except Exception as e:
        return {"success": False, "message": f"Error decoding image: {e}"}

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    try:
        small_rgb = cv2.resize(rgb_frame, (0, 0), fx=0.5, fy=0.5)
        with config.FACE_LOCK:
            face_locations_small = face_recognition.face_locations(small_rgb)
        face_locations = [(t * 2, r * 2, b * 2, l * 2) for (t, r, b, l) in face_locations_small]
    except Exception as e:
        logger.error(f"Error in face_locations: {e}")
        face_locations = []

    samples_count = len(register_state["samples"])
    
    if not face_locations:
        return {"success": True, "status": "no_face", "message": "ALIGN FACE INSIDE FRAME (No Face Detected)", "faces": []}
    elif len(face_locations) > 1:
        return {"success": True, "status": "multiple_faces", "message": "WARNING: KEEP ONLY ONE FACE IN FRAME", "faces": face_locations}
        
    loc = face_locations[0]
    top, right, bottom, left = loc
    bbox = (left, top, right, bottom)
    
    try:
        with config.FACE_LOCK:
            landmarks_list = face_recognition.face_landmarks(rgb_frame, [loc])
    except Exception as e:
        landmarks_list = []

    pose_ratio = 1.0
    if landmarks_list:
        landmarks = landmarks_list[0]
        if "chin" in landmarks and len(landmarks["chin"]) >= 17 and "nose_tip" in landmarks and len(landmarks["nose_tip"]) >= 3:
            chin_left_x = landmarks["chin"][0][0]
            chin_right_x = landmarks["chin"][16][0]
            nose_x = landmarks["nose_tip"][2][0]
            dx_left = abs(nose_x - chin_left_x)
            dx_right = abs(chin_right_x - nose_x)
            pose_ratio = dx_left / (dx_right + 1e-6)

    if pose_ratio < 0.30:
        current_pose = "TURN_RIGHT_EXTREME"
    elif pose_ratio < 0.65:
        current_pose = "TURN_RIGHT"
    elif pose_ratio > 3.0:
        current_pose = "TURN_LEFT_EXTREME"
    elif pose_ratio > 1.45:
        current_pose = "TURN_LEFT"
    else:
        current_pose = "LOOK_STRAIGHT"

    if samples_count < 3:
        target_pose = "LOOK_STRAIGHT"
        direction = "LOOK STRAIGHT"
    elif samples_count < 6:
        target_pose = "TURN_LEFT"
        direction = "TURN LEFT SLIGHTLY"
    elif samples_count < 9:
        target_pose = "TURN_RIGHT"
        direction = "TURN RIGHT SLIGHTLY"
    else:
        target_pose = "LOOK_STRAIGHT"
        direction = "SMILE / TILT HEAD"

    pose_matched = (current_pose == target_pose) or (samples_count >= 9)

    is_real, spoof_score = anti_spoofer.analyze_face(frame, bbox)

    if not is_real:
        return {"success": True, "status": "spoof", "message": f"SPOOF DETECTED! Registration suspended. ({spoof_score:.2f})", "faces": [loc]}

    if not pose_matched:
        if "EXTREME" in current_pose and target_pose in current_pose:
            dyn_msg = f"You turned too much. Turn back slightly. ({samples_count}/10)"
        elif "RIGHT" in current_pose and target_pose == "TURN_LEFT":
            dyn_msg = f"No, you are turning right. PLEASE {direction} ({samples_count}/10)"
        elif "LEFT" in current_pose and target_pose == "TURN_RIGHT":
            dyn_msg = f"No, you are turning left. PLEASE {direction} ({samples_count}/10)"
        elif current_pose != "LOOK_STRAIGHT" and target_pose == "LOOK_STRAIGHT":
            dyn_msg = f"Please do not turn. LOOK STRAIGHT ({samples_count}/10)"
        else:
            dyn_msg = f"PLEASE {direction} ({samples_count}/10)"
        
        return {"success": True, "status": "wrong_pose", "message": dyn_msg, "faces": [loc]}

    current_time = time.time()
    if current_time - register_state.get("last_capture_time", 0.0) >= 1.5:
        with config.FACE_LOCK:
            encoding = face_recognition.face_encodings(rgb_frame, [loc])[0]
        register_state["samples"].append(encoding)
        register_state["last_capture_time"] = current_time
        logger.info(f"Captured sample {len(register_state['samples'])}/10 for {register_state['roll']}")
        
    if len(register_state["samples"]) >= 10:
        avg_encoding = np.mean(register_state["samples"], axis=0).tolist()
        roll = register_state["roll"]
        recognizer.known_faces[roll] = avg_encoding
        recognizer.save_embeddings()
        
        register_state["active"] = False
        register_state["status"] = "success"
        register_state["message"] = f"Face registered successfully for student {roll}."
        logger.info(f"Biometric template successfully written for {roll}")
        return {"success": True, "status": "success", "message": register_state["message"], "faces": [loc]}

    samples_count = len(register_state["samples"])
    return {"success": True, "status": "capturing", "message": f"GUIDE: {direction} ({samples_count}/10) - CAPTURED", "faces": [loc]}


@app.post("/api/scan/trigger")
def trigger_manual_scan(data: ScanRequest):
    success = attendance_scheduler.execute_passive_scan(
        section=data.section,
        subject_id=data.subjectId,
        period=data.period,
        date=data.date,
        duration_seconds=data.duration
    )
    if success:
        return {"success": True, "message": f"Scan initiated for {data.section} (Period {data.period}, Date {data.date or 'today'})."}
    else:
        return JSONResponse(status_code=400, content={"success": False, "message": "A scan is already in progress."})

@app.get("/api/scan/status")
def get_scan_status():
    return {
        "is_scanning": attendance_scheduler.is_scanning
    }

@app.post("/api/scan/frame")
def process_scan_frame(req: FrameRequest):
    try:
        frame = decode_base64_image(req.image)
        if frame is None:
            return {"success": False, "message": "Invalid image"}
    except Exception as e:
        return {"success": False, "message": "Decode error"}

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    try:
        small_rgb = cv2.resize(rgb_frame, (0, 0), fx=0.5, fy=0.5)
        with config.FACE_LOCK:
            face_locations_small = face_recognition.face_locations(small_rgb)
        face_locations = [(t * 2, r * 2, b * 2, l * 2) for (t, r, b, l) in face_locations_small]
    except Exception as e:
        logger.error(f"Error in face_locations: {e}")
        face_locations = []

    results = []

    if face_locations:
        with config.FACE_LOCK:
            face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)

        for loc, encoding in zip(face_locations, face_encodings):
            top, right, bottom, left = loc
            bbox = (left, top, right, bottom)
            
            is_real, spoof_score = anti_spoofer.analyze_face(frame, bbox)
            
            if is_real:
                roll, dist = recognizer.match_face(encoding)
                if roll:
                    attendance_scheduler.record_detected_face(roll)
                    results.append({
                        "loc": loc,
                        "label": f"{roll} (Real, {dist:.2f})",
                        "color": "green"
                    })
                else:
                    results.append({
                        "loc": loc,
                        "label": "Real Face (Unknown)",
                        "color": "yellow"
                    })
            else:
                results.append({
                    "loc": loc,
                    "label": f"Spoofed Face! ({spoof_score:.2f})",
                    "color": "red"
                })

    return {"success": True, "faces": results, "is_scanning": attendance_scheduler.is_scanning}

def generate_mjpeg_stream():
    while True:
        frame = cctv_processor.get_latest_frame()
        if frame is not None:
            # Encode frame to JPEG
            ret, buffer = cv2.imencode('.jpg', frame)
            if ret:
                frame_bytes = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        # If no frame or failed to encode, wait a bit
        time.sleep(0.05)

@app.get("/api/cctv/stream")
def cctv_stream():
    return StreamingResponse(generate_mjpeg_stream(), media_type="multipart/x-mixed-replace; boundary=frame")

def generate_preview_stream(url: str):
    # For generic IPs without RTSP, you might need http://<ip>/video, but we'll try directly first
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    start_time = time.time()
    try:
        while True:
            # Auto-disconnect after 12 seconds to save resources
            if time.time() - start_time > 12:
                break
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.1)
                continue
                
            frame = cv2.resize(frame, (640, 480))
            ret2, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            if ret2:
                frame_bytes = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(0.05)
    finally:
        cap.release()

@app.get("/api/cctv/preview")
def cctv_preview(url: str):
    return StreamingResponse(generate_preview_stream(url), media_type="multipart/x-mixed-replace; boundary=frame")

@app.get("/api/cctv/snapshot")
def cctv_snapshot(url: str):
    if url.startswith("rtsp://"):
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|allowed_media_types;video"
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    try:
        # Give it a tiny bit of time to open stream and read a frame
        ret, frame = cap.read()
        if not ret:
            # Try once more
            time.sleep(1.0)
            ret, frame = cap.read()
            
        if ret:
            frame = cv2.resize(frame, (640, 480))
            ret2, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            if ret2:
                return Response(content=buffer.tobytes(), media_type="image/jpeg")
    finally:
        cap.release()
        
    return JSONResponse(status_code=400, content={"success": False, "message": "Failed to grab snapshot"})
