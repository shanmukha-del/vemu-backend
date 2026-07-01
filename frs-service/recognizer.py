import os
import json
import numpy as np
import face_recognition
import logging
import config

logger = logging.getLogger("Recognizer")

class FaceRecognizer:
    def __init__(self):
        self.embeddings_file = config.EMBEDDINGS_FILE
        self.known_faces = {}
        self.load_embeddings()

    def load_embeddings(self):
        if os.path.exists(self.embeddings_file):
            try:
                with open(self.embeddings_file, 'r') as f:
                    self.known_faces = json.load(f)
                logger.info(f"Loaded {len(self.known_faces)} biometric templates.")
            except Exception as e:
                logger.error(f"Failed to read embeddings file: {e}. Starting fresh.")
                self.known_faces = {}
        else:
            logger.info("No embeddings file found. Initializing empty database.")
            self.known_faces = {}

    def save_embeddings(self):
        try:
            os.makedirs(os.path.dirname(self.embeddings_file), exist_ok=True)
            with open(self.embeddings_file, 'w') as f:
                json.dump(self.known_faces, f, indent=4)
        except Exception as e:
            logger.error(f"Failed to save embeddings: {e}")

    def register_face(self, roll_number, image_array):
        # Convert BGR to RGB (OpenCV uses BGR, face_recognition uses RGB)
        # Note: In the new implementation, decoding might already yield RGB,
        # but to be safe, assume image_array is RGB from the /register endpoint.
        face_locations = face_recognition.face_locations(image_array)
        if len(face_locations) == 0:
            return False, "No face detected in the image."
        if len(face_locations) > 1:
            return False, "Multiple faces detected. Please ensure only one person is in the frame."

        face_encodings = face_recognition.face_encodings(image_array, face_locations)
        if not face_encodings:
            return False, "Could not extract face features."

        self.known_faces[roll_number] = face_encodings[0].tolist()
        self.save_embeddings()
        return True, "Face registered successfully."

    def recognize_face(self, image_array, tolerance=config.FACE_MATCH_THRESHOLD):
        if not self.known_faces:
            return None, "No faces are registered in the system."

        face_locations = face_recognition.face_locations(image_array)
        if len(face_locations) == 0:
            return None, "No face detected."

        # Process the largest face if multiple
        largest_face_idx = 0
        if len(face_locations) > 1:
            max_area = 0
            for i, (top, right, bottom, left) in enumerate(face_locations):
                area = (bottom - top) * (right - left)
                if area > max_area:
                    max_area = area
                    largest_face_idx = i

        target_location = [face_locations[largest_face_idx]]
        face_encodings = face_recognition.face_encodings(image_array, target_location)
        
        if not face_encodings:
            return None, "Could not extract features."

        unknown_encoding = face_encodings[0]

        # Prepare known data
        known_roll_numbers = list(self.known_faces.keys())
        known_encodings = [np.array(enc) for enc in self.known_faces.values()]

        # Compute distances
        face_distances = face_recognition.face_distance(known_encodings, unknown_encoding)
        
        best_match_index = np.argmin(face_distances)
        if face_distances[best_match_index] <= tolerance:
            return known_roll_numbers[best_match_index], float(face_distances[best_match_index])
        
        return "UNKNOWN", float(face_distances[best_match_index])

    def match_face(self, unknown_encoding, tolerance=config.FACE_MATCH_THRESHOLD):
        if not self.known_faces:
            return None, 1.0

        known_roll_numbers = list(self.known_faces.keys())
        known_encodings = [np.array(enc) for enc in self.known_faces.values()]

        face_distances = face_recognition.face_distance(known_encodings, unknown_encoding)
        best_match_index = np.argmin(face_distances)
        
        if face_distances[best_match_index] <= tolerance:
            return known_roll_numbers[best_match_index], float(face_distances[best_match_index])
        
        return None, float(face_distances[best_match_index])
