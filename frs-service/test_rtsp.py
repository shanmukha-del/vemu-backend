import cv2

urls = [
    'rtsp://admin:ZnUeV53P@192.168.0.112:554/live/ch00_1',
    'rtsp://admin:ZnUeV53P@192.168.0.112:554/live/ch00_0',
    'rtsp://admin:ZnUeV53P@192.168.0.112:554/h264',
    'rtsp://122541897:ZnUeV53P@192.168.0.112:554/live/ch00_1',
    'rtsp://192.168.0.112:554/live/ch00_1'
]

for url in urls:
    print(f"Testing {url}...")
    cap = cv2.VideoCapture(url)
    if cap.isOpened():
        ret, frame = cap.read()
        if ret:
            print(f"SUCCESS! Connected and read frame from {url}")
            cap.release()
            break
        else:
            print(f"Connected but failed to read frame from {url}")
    else:
        print(f"Failed to open {url}")
    cap.release()
