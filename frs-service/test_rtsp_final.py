import cv2
import time

url = 'rtsp://admin:ZnUeV53P@192.168.0.112/live/ch00_0'
print(f"Testing {url}...")
cap = cv2.VideoCapture(url)
if cap.isOpened():
    ret, frame = cap.read()
    if ret:
        print("Success! Frame shape:", frame.shape)
    else:
        print("Opened but failed to read frame.")
    cap.release()
else:
    print("Failed to open.")
