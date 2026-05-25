import time
import requests
import logging
from datetime import datetime
import threading
import re
import config

logger = logging.getLogger("Scheduler")

def parse_section_label(label):
    if not label or not isinstance(label, str):
        return None
    match = re.match(r"^([A-Z]+)-(\d)([A-Z]+)(?:-S(\d))?$", label)
    if match:
        return {
            "dept": match.group(1),
            "year": match.group(2),
            "section": match.group(3),
            "semester": match.group(4) if match.group(4) else None
        }
    return None

class PassiveAttendanceScheduler:
    """
    Automates silent classroom attendance scanning.
    Fetches student rosters via REST API, maps Roll Numbers to MongoDB MERN IDs,
    and accepts recognized student faces to register attendance.
    """
    def __init__(self):
        self.is_scanning = False
        self.scan_lock = threading.Lock()
        self.detected_rolls = set()

    def fetch_students_mapping(self):
        try:
            url = f"{config.BACKEND_API_URL}/students"
            res = requests.get(url, timeout=10)
            if res.status_code == 200:
                body = res.json()
                if body.get("success"):
                    students_list = body.get("data", [])
                    roll_to_id = {s["roll"].upper().strip(): s["id"] for s in students_list if "roll" in s and "id" in s}
                    return roll_to_id
        except Exception as e:
            logger.error(f"Network error querying students database: {e}")
        return {}

    def fetch_students_in_section(self, section_label):
        try:
            url = f"{config.BACKEND_API_URL}/students"
            res = requests.get(url, timeout=10)
            if res.status_code == 200:
                body = res.json()
                if body.get("success"):
                    students = body.get("data", [])
                    parsed = parse_section_label(section_label)
                    if parsed:
                        filtered = []
                        for s in students:
                            if s.get("dept", "").upper().strip() != parsed["dept"].upper().strip(): continue
                            if str(s.get("year", "")).strip() != str(parsed["year"]).strip(): continue
                            if s.get("section", "").upper().strip() != parsed["section"].upper().strip(): continue
                            if parsed["semester"] and s.get("semester"):
                                if str(s.get("semester", "")).strip() != str(parsed["semester"]).strip(): continue
                            filtered.append(s)
                        return filtered
                    else:
                        return [s for s in students if s.get("section") == section_label or s.get("dept") in section_label]
        except Exception as e:
            logger.error(f"Error fetching section students: {e}")
        return []

    def execute_passive_scan(self, section, subject_id, period, duration_seconds=None, date=None):
        """
        Starts a scan session that allows external frames to feed into it.
        """
        if duration_seconds is None:
            duration_seconds = config.DEFAULT_SCAN_DURATION

        with self.scan_lock:
            if self.is_scanning:
                logger.warning("A face recognition scan is already in progress.")
                return False
            self.is_scanning = True
            self.detected_rolls = set()

        thread = threading.Thread(
            target=self._scan_timer,
            args=(section, subject_id, period, duration_seconds, date),
            name="PassiveScanTimer"
        )
        thread.daemon = True
        thread.start()
        logger.info(f"Scan session initialized for Section: {section}, Period: {period}")
        return True

    def record_detected_face(self, roll):
        """Called by the API endpoint when a real matched face is detected."""
        if not self.is_scanning:
            return
        
        if roll:
            roll = roll.upper().strip()
            self.detected_rolls.add(roll)

    def _scan_timer(self, section, subject_id, period, duration_seconds, date=None):
        try:
            roll_to_id = self.fetch_students_mapping()
            section_students = self.fetch_students_in_section(section)
            
            if not section_students:
                logger.error(f"No students found in section '{section}'. Aborting scan.")
                with self.scan_lock:
                    self.is_scanning = False
                return

            section_student_ids = [s["id"] for s in section_students]
            
            logger.info(f"Waiting {duration_seconds}s for frontend to send frames...")
            time.sleep(duration_seconds)
            
            # Timer finished, compile results
            attendance_records = {sid: "absent" for sid in section_student_ids}
            
            for roll in self.detected_rolls:
                student_mern_id = roll_to_id.get(roll)
                if student_mern_id in attendance_records:
                    attendance_records[student_mern_id] = "present"
                    
            logger.info(f"Scan complete. Detected students: {list(self.detected_rolls)}")
            
            self._submit_attendance(section, subject_id, period, attendance_records, date)

        except Exception as e:
            logger.error(f"Error in passive scan timer: {e}")
        finally:
            with self.scan_lock:
                self.is_scanning = False
                self.detected_rolls = set()

    def _submit_attendance(self, section, subject_id, period, records, date=None):
        try:
            today_str = date if date else datetime.now().strftime("%Y-%m-%d")
            payload = {
                "date": today_str,
                "subjectId": subject_id,
                "section": section,
                "period": str(period),
                "records": records,
                "teacherId": "FRS_WATCHMAN"
            }
            
            url = f"{config.BACKEND_API_URL}/attendance/save"
            logger.info(f"Sending attendance payload to MERN API: {url}")
            res = requests.post(url, json=payload, timeout=10)
            
            if res.status_code == 200:
                logger.info(f"Silent Watchman successfully marked attendance for {section} period {period}!")
            else:
                logger.error(f"MERN backend rejected attendance. Status: {res.status_code}")
        except Exception as e:
            logger.error(f"Failed to post attendance to MERN backend: {e}")

    def schedule_cron_jobs(self):
        pass

    def stop(self):
        pass
