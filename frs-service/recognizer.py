import os
import json
import numpy as np
import face_recognition
import logging
import config

logger = logging.getLogger("Recognizer")

class FaceRecognizer:
    """
    Manages local storage of 128-d face embeddings, generates embeddings,
    and performs Euclidean distance matching against registered students.
    """
    def __init__(self):
        self.embeddings_file = config.EMBEDDINGS_FILE
        self.known_faces = {}  # Format: { "roll_number": [float, float, ... (128 values)] }
        self.load_embeddings()

    def load_embeddings(self):
        """Loads registered face embeddings from local storage."""
        if os.path.exists(self.embeddings_file):
            try:
                with open(self.embeddings_file, 'r') as f:
                    self.known_faces = json.load(f)
                logger.info(f"Loaded {len(self.known_faces)} biometric templates from local storage.")
            except Exception as e:
                logger.error(f"Failed to read embeddings file: {e}. Starting fresh.")
                self.known_faces = {}
        else:
            logger.info("No embeddings file found. Initializing empty templates database.")
            self.known_faces = {}

    def save_embeddings(self):
        """Saves current face embeddings to local JSON file."""
        try:
            with open(self.embeddings_file, 'w') as f:
                json.dump(self.known_faces, f, indent=4)
            logger.info("Biometric templates successfully saved to disk.")
        except Exception as e:
            logger.error(f"Failed to write embeddings to disk: {e}")

    def register_student_face(self, roll_number, frame):
        """
        Extracts face embedding from a frame and saves it for a student.
        Args:
            roll_number: Student Roll Number string
            frame: OpenCV image frame containing a face
        Returns:
            (success, message)
        """
        # Convert OpenCV BGR to face_recognition RGB
        rgb_frame = cv2_to_rgb(frame)
        
        # Find all face locations and encodings in the frame
        try:
            with config.FACE_LOCK:
                face_locations = face_recognition.face_locations(rgb_frame)
        except Exception as e:
            logger.error(f"Error in face_locations during registration: {e}. Shape: {rgb_frame.shape}, dtype: {rgb_frame.dtype}")
            return False, f"Image processing error: {e}"
        
        if not face_locations:
            return False, "No face detected in the image."
        if len(face_locations) > 1:
            return False, "Multiple faces detected. Please register one person at a time."
        
        # Generate 128-d encodings
        try:
            with config.FACE_LOCK:
                face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)
        except Exception as e:
            logger.error(f"Error in face_encodings during registration: {e}")
            return False, f"Face encoding error: {e}"
        if not face_encodings:
            return False, "Could not generate face embedding. Please try again with better lighting."
        
        # Convert NumPy array to Python list for JSON compatibility
        encoding_list = face_encodings[0].tolist()
        self.known_faces[roll_number.upper()] = encoding_list
        self.save_embeddings()
        return True, f"Successfully registered face for student {roll_number}."

    def match_face(self, face_encoding):
        """
        Matches a face encoding against known faces using Euclidean distance.
        Args:
            face_encoding: 128-d NumPy array of the face to match
        Returns:
            roll_number: Matched Roll Number or None
            distance: The minimum Euclidean distance score
        """
        if not self.known_faces:
            return None, 1.0

        # Extract names and encodings arrays
        roll_numbers = list(self.known_faces.keys())
        known_encodings = [np.array(emb) for emb in self.known_faces.values()]

        # Compute Euclidean distance using face_recognition utility
        distances = face_recognition.face_distance(known_encodings, face_encoding)
        
        if len(distances) == 0:
            return None, 1.0

        min_idx = np.argmin(distances)
        min_distance = distances[min_idx]

        if min_distance <= config.FACE_MATCH_THRESHOLD:
            return roll_numbers[min_idx], float(min_distance)
        
        return None, float(min_distance)


def cv2_to_rgb(frame):
    """Converts OpenCV BGR image to RGB format required by face_recognition."""
    # Ensure image has 3 dimensions (H, W, C)
    if len(frame.shape) == 2:
        frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
    # Ensure exactly 3 channels (convert BGRA to BGR)
    if frame.shape[2] == 4:
        frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
    # Force 8-bit unsigned integer type
    frame = frame.astype(np.uint8)
    return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
