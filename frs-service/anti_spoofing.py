import os
import cv2
import numpy as np
import logging
import config

logger = logging.getLogger("AntiSpoofing")

# Try importing onnxruntime
try:
    import onnxruntime as ort
    ORT_AVAILABLE = True
except ImportError:
    ORT_AVAILABLE = False
    logger.warning("onnxruntime is not installed. Anti-spoofing will default to BYPASS mode.")

class AntiSpoofingClassifier:
    def __init__(self):
        self.session = None
        self.input_name = None
        self.output_name = None
        self.input_shape = (80, 80)  # Standard input shape for MiniFASNet
        
        # Determine if we can load the model
        model_path = config.ANTI_SPOOF_MODEL_PATH
        if ORT_AVAILABLE and not config.BYPASS_ANTI_SPOOFING:
            if os.path.exists(model_path):
                try:
                    logger.info(f"Loading Silent-Face-Anti-Spoofing model: {model_path}")
                    # Load model using ONNX runtime
                    self.session = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
                    inputs = self.session.get_inputs()
                    self.input_name = inputs[0].name
                    self.input_shape = tuple(inputs[0].shape[2:])  # e.g., (80, 80)
                    self.output_name = self.session.get_outputs()[0].name
                    logger.info(f"ONNX Model loaded. Input shape required: {self.input_shape}")
                except Exception as e:
                    logger.error(f"Failed to load ONNX model. Bypassing. Error: {e}")
                    self.session = None
            else:
                logger.warning(
                    f"Model file '{model_path}' not found.\n"
                    "--> To enable real anti-spoofing, download MiniFASNetV2.onnx from Silent-Face-Anti-Spoofing repository "
                    f"and place it in: {config.ANTI_SPOOF_MODEL_DIR}\n"
                    "--> Bypassing anti-spoofing for now."
                )
        else:
            if config.BYPASS_ANTI_SPOOFING:
                logger.info("Anti-spoofing is explicitly BYPASSED in config.py")

    def _crop_face(self, img, bbox, scale=2.7):
        """
        Crops face with a scale factor matching the training pre-processing of Silent-Face-Anti-Spoofing.
        bbox format: (left, top, right, bottom)
        """
        img_h, img_w, _ = img.shape
        left, top, right, bottom = bbox
        
        w = right - left
        h = bottom - top
        
        # Calculate scaling expansion
        cx = left + w / 2
        cy = top + h / 2
        
        scaled_w = w * scale
        scaled_h = h * scale
        
        new_left = int(max(0, cx - scaled_w / 2))
        new_top = int(max(0, cy - scaled_h / 2))
        new_right = int(min(img_w, cx + scaled_w / 2))
        new_bottom = int(min(img_h, cy + scaled_h / 2))
        
        return img[new_top:new_bottom, new_left:new_right]

    def _softmax(self, x):
        e_x = np.exp(x - np.max(x))
        return e_x / e_x.sum(axis=-1, keepdims=True)

    def analyze_face(self, frame, bbox):
        """
        Analyzes a face for spoofing.
        Args:
            frame: Full opencv image frame
            bbox: Tuple/list of face coordinates (left, top, right, bottom)
        Returns:
            is_real: Boolean, True if real face, False if photo/video screen
            score: Confidence float [0.0 - 1.0] for the classification
        """
        # If bypassed or model not loaded, return Real
        if self.session is None:
            return True, 1.0

        try:
            # 1. Crop face with scaling factor
            cropped = self._crop_face(frame, bbox, scale=2.7)
            if cropped.size == 0:
                return False, 0.0

            # 2. Resize and normalize
            resized = cv2.resize(cropped, self.input_shape)
            # Convert to float, normalize, shape (H, W, C) -> (C, H, W)
            input_data = resized.astype(np.float32)
            input_data = np.transpose(input_data, (2, 0, 1))
            # Batch dimension (1, C, H, W)
            input_tensor = np.expand_dims(input_data, axis=0)

            # 3. Model Inference
            outputs = self.session.run([self.output_name], {self.input_name: input_tensor})
            raw_scores = outputs[0][0]
            
            # Softmax calculation
            probs = self._softmax(raw_scores)
            
            # Classes mapping:
            # Index 1 is typically "Real Face" in Silent-Face-Anti-Spoofing model configs.
            # Index 0 and 2 are spoofer types (e.g. photo print, screen replay).
            real_prob = probs[1]
            is_real = real_prob >= config.SPOOF_THRESHOLD
            
            return bool(is_real), float(real_prob)

        except Exception as e:
            logger.error(f"Error during anti-spoofing inference: {e}")
            return True, 1.0  # Safe fallback to prevent breaking attendance flow on exceptions
