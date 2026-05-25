import time
import numpy as np
import cv2
import logging
import base64
from fastapi import FastAPI, BackgroundTasks, Query, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import config
import face_recognition

from recognizer import FaceRecognizer
from anti_spoofing import AntiSpoofingClassifier
from scheduler import PassiveAttendanceScheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("FastAPI")

app = FastAPI(title="VEMU Face Recognition System Service", version="2.0.0")

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

    if pose_ratio < 0.65:
        current_pose = "TURN_RIGHT"
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

    pose_matched = (current_pose == target_pose) or (samples_count == 9)

    is_real, spoof_score = anti_spoofer.analyze_face(frame, bbox)

    if not is_real:
        return {"success": True, "status": "spoof", "message": f"SPOOF DETECTED! Registration suspended. ({spoof_score:.2f})", "faces": [loc]}

    if not pose_matched:
        return {"success": True, "status": "wrong_pose", "message": f"PLEASE {direction} ({samples_count}/10)", "faces": [loc]}

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
