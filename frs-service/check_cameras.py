import cv2
import os
import numpy as np

output_dir = r"C:\Users\DELL\OneDrive\Desktop\fsd project\frs-service"
os.makedirs(output_dir, exist_ok=True)

print("Probing camera with different settings...")

configs = [
    {"name": "DSHOW_default", "backend": cv2.CAP_DSHOW, "width": None, "height": None, "fourcc": None},
    {"name": "DSHOW_640x480", "backend": cv2.CAP_DSHOW, "width": 640, "height": 480, "fourcc": None},
    {"name": "DSHOW_MJPG_640x480", "backend": cv2.CAP_DSHOW, "width": 640, "height": 480, "fourcc": "MJPG"},
    {"name": "DSHOW_YUYV_640x480", "backend": cv2.CAP_DSHOW, "width": 640, "height": 480, "fourcc": "YUYV"},
    {"name": "MSMF_MJPG_640x480", "backend": cv2.CAP_MSMF, "width": 640, "height": 480, "fourcc": "MJPG"},
]

for conf in configs:
    name = conf["name"]
    print(f"\nTesting config: {name}")
    cap = cv2.VideoCapture(0, conf["backend"])
    if not cap.isOpened():
        print(f"  Failed to open camera with backend {conf['backend']}.")
        continue
    
    if conf["width"] is not None:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, conf["width"])
    if conf["height"] is not None:
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, conf["height"])
    if conf["fourcc"] is not None:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*conf["fourcc"]))
    
    # Warm up camera
    for i in range(5):
        cap.read()
        
    ret, frame = cap.read()
    if ret and frame is not None:
        mean_val = frame.mean()
        print(f"  Grabbed successfully. Shape: {frame.shape}, Mean pixel value: {mean_val:.2f}")
        out_path = os.path.join(output_dir, f"test_{name}.jpg")
        cv2.imwrite(out_path, frame)
        print(f"  Saved image to: {out_path}")
    else:
        print("  Failed to grab frame.")
        
    cap.release()
