import os

# 1. Backend REST API Config
# The backend API URL for fetching student rosters and logging attendance.
BACKEND_API_URL = os.environ.get("BACKEND_API_URL", "http://localhost:3000/api")

# 2. Camera Configuration
# - Set to integer 0 for local laptop webcam.
# - Set to string "http://<ip>:<port>/video" for smartphone IP Webcam.
# - Set to string "rtsp://<username>:<password>@<ip>:<port>/h264" for Maizic Smarthome RTSP Camera.
CAMERA_SOURCE = 0  # Default to local webcam for initial developer testing

# Camera stream connection settings
CAMERA_WIDTH = 640
CAMERA_HEIGHT = 480
CAMERA_RECONNECT_DELAY = 5.0  # Seconds to wait before attempting reconnect

# 3. Biometric & Recognition Thresholds
# Euclidean distance threshold for matching. 0.6 is default for face_recognition/dlib.
# Lowering this (e.g. 0.5) makes it stricter (less false positives, but more potential false negatives).
FACE_MATCH_THRESHOLD = 0.5

# Anti-Spoofing Configuration
# Path to the Silent-Face-Anti-Spoofing ONNX model.
# Can download from: https://github.com/Minivision-AI/Silent-Face-Anti-Spoofing
ANTI_SPOOF_MODEL_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "models"))
ANTI_SPOOF_MODEL_PATH = os.path.join(ANTI_SPOOF_MODEL_DIR, "MiniFASNetV2.onnx")

# Set to True to allow testing without needing the ONNX model files.
BYPASS_ANTI_SPOOFING = True  
SPOOF_THRESHOLD = 0.85  # Score above which a face is considered "Real"

# 4. Storage Directories
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "data"))
EMBEDDINGS_FILE = os.path.join(DATA_DIR, "embeddings.json")

# Ensure storage directories exist
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(ANTI_SPOOF_MODEL_DIR, exist_ok=True)

# 5. Passive Watchman Scanning Config
# Silent scans run periodically during these hours. Format: (start_time, end_time, period_name)
CLASS_PERIODS = [
    {"start": "09:00", "end": "09:50", "period": "1"},
    {"start": "09:50", "end": "10:40", "period": "2"},
    {"start": "11:00", "end": "11:50", "period": "3"},
    {"start": "11:50", "end": "12:40", "period": "4"},
    {"start": "13:30", "end": "14:20", "period": "5"},
    {"start": "14:20", "end": "15:10", "period": "6"},
    {"start": "15:10", "end": "16:00", "period": "7"}
]

# The default section and subject we are scanning for in a testing/demo environment
DEFAULT_SCAN_SECTION = "CSE-3A-S1"
DEFAULT_SCAN_SUBJECT_ID = "SUB123"
DEFAULT_SCAN_DURATION = 300  # Duration in seconds for each silent classroom scan (e.g. 5 minutes)

# Set to True to enable automatic background scheduler scans. Set to False for manual testing.
ENABLE_AUTOMATIC_CRON = False

# Global lock to serialize face detection/encoding operations and prevent concurrent dlib crashes
import threading
FACE_LOCK = threading.Lock()

