import cv2
import os

# Force TCP for RTSP
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

url = 'rtsp://admin:ZnUeV53P@192.168.0.112/live/ch00_0'
print(f"Testing {url} with TCP...")
cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
if cap.isOpened():
    ret, frame = cap.read()
    if ret:
        print("Success! Frame shape:", frame.shape)
    else:
        print("Opened but failed to read frame (even with TCP).")
    cap.release()
else:
    print("Failed to open.")
