import time
import requests
import logging
from datetime import datetime
import threading
import re
import config
from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger("Scheduler")

def parse_section_label(label):
    if not label or not isinstance(label, str):
        return None
    match1 = re.match(r"^([A-Z]+)-(\d)([A-Z]+)(?:-S(\d))?$", label)
    if match1:
        return {
            "dept": match1.group(1),
            "year": match1.group(2),
            "section": match1.group(3),
            "semester": match1.group(4) if match1.group(4) else None
        }
    match2 = re.match(r"^([A-Z]+)-(\d)-(\d)-([A-Z]+)$", label)
    if match2:
        return {
            "dept": match2.group(1),
            "year": match2.group(2),
            "semester": match2.group(3),
            "section": match2.group(4)
        }
    return None

class PassiveAttendanceScheduler:
    """
    Automates silent classroom attendance scanning.
    Fetches student rosters via REST API, maps Roll Numbers to MongoDB MERN IDs,
    and accepts recognized student faces to register attendance.
    Implements the Double-Scan strategy.
    """
    def __init__(self):
        self.is_scanning = False
        self.scan_lock = threading.Lock()
        self.detected_rolls = set()
        
        # Dictionary to hold the results of Scan 1
        # Key: (date_str, period_id, section) -> Value: set of detected rolls
        self.scan1_results = {}
        
        self.aps_scheduler = BackgroundScheduler()

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

    def execute_passive_scan(self, section, subject_id, period, duration_seconds=None, date=None, scan_type="manual"):
        """
        Starts a scan session that allows external frames to feed into it.
        scan_type can be 'manual', 'scan1', or 'scan2'
        """
        if scan_type == "manual":
            print(f"\n\033[95m*********** Manual Scan Starting ***********\033[0m")
            
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
            args=(section, subject_id, period, duration_seconds, date, scan_type),
            name="PassiveScanTimer"
        )
        thread.daemon = True
        thread.start()
        logger.info(f"Scan session initialized for Section: {section}, Period: {period} [{scan_type}]")
        return True

    def record_detected_face(self, roll):
        """Called by the API endpoint when a real matched face is detected."""
        if not self.is_scanning:
            return
        
        if roll:
            roll = roll.upper().strip()
            self.detected_rolls.add(roll)

    def _scan_timer(self, section, subject_id, period, duration_seconds, date=None, scan_type="manual"):
        try:
            today_str = date if date else datetime.now().strftime("%Y-%m-%d")
            
            logger.info(f"Waiting {duration_seconds}s for frontend to send frames...")
            time.sleep(duration_seconds)
            
            # Save detected faces
            detected_now = set(self.detected_rolls)
            logger.info(f"Scan '{scan_type}' complete. Detected students: {list(detected_now)}")
            
            # Handle Double-Scan logic
            if scan_type == "scan1":
                key = (today_str, str(period), section)
                self.scan1_results[key] = detected_now
                logger.info(f"Saved Scan 1 results for {key}. Waiting for Scan 2.")
                return
                
            final_present_rolls = set()
            if scan_type == "scan2":
                key = (today_str, str(period), section)
                scan1_faces = self.scan1_results.get(key, set())
                # Intersection logic: student must be present in both scans!
                if not scan1_faces:
                    logger.warning(f"Scan 1 was missed for {key}. Using Scan 2 faces directly for testing.")
                    final_present_rolls = detected_now
                else:
                    final_present_rolls = detected_now.intersection(scan1_faces)
                    
                logger.info(f"Double-Scan intersection complete. Verified students: {list(final_present_rolls)}")
                # Clean up memory
                if key in self.scan1_results:
                    del self.scan1_results[key]
            else:
                # Manual scan, just use detected faces directly
                final_present_rolls = detected_now
                
            # Compile results and submit to DB
            roll_to_id = self.fetch_students_mapping()
            section_students = self.fetch_students_in_section(section)
            
            if not section_students:
                logger.error(f"No students found in section '{section}'. Aborting attendance submission.")
                return

            section_student_ids = [s["id"] for s in section_students]
            attendance_records = {sid: "absent" for sid in section_student_ids}
            
            for roll in final_present_rolls:
                student_mern_id = roll_to_id.get(roll)
                if student_mern_id in attendance_records:
                    attendance_records[student_mern_id] = "present"
                    
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
            
            normalized_section = section
            parsed = parse_section_label(section)
            if parsed:
                normalized_section = f"{parsed['dept']}-{parsed['year']}{parsed['section']}"
                if parsed['semester']:
                    normalized_section += f"-S{parsed['semester']}"
                    
            payload = {
                "date": today_str,
                "subjectId": subject_id,
                "section": normalized_section,
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

    # --- CRON JOB AUTOMATION ---
    def schedule_cron_jobs(self):
        if not config.ENABLE_AUTOMATIC_CRON:
            logger.info("Automated Cron Scans are disabled in config.py")
            return
            
        logger.info("Initializing APScheduler for Double-Scan Automation...")
        for p in config.CLASS_PERIODS:
            start_hour, start_min = map(int, p["start"].split(":"))
            end_hour, end_min = map(int, p["end"].split(":"))
            period_id = p["period"]
            
            # Scan 1: 5 mins after start
            scan1_min = (start_min + 5) % 60
            scan1_hour = start_hour + ((start_min + 5) // 60)
            
            # Scan 2: 10 mins before end (runs for 5 mins, ends 5 mins before class ends)
            scan2_min = (end_min - 10) % 60
            scan2_hour = end_hour + ((end_min - 10) // 60)
            if scan2_min < 0:
                scan2_min += 60
                scan2_hour -= 1
                
            self.aps_scheduler.add_job(
                self._trigger_cameras, 'cron', day_of_week='mon-sat',
                hour=scan1_hour, minute=scan1_min, args=[period_id, "scan1"],
                name=f"Cron-Scan1-{period_id}",
                misfire_grace_time=None
            )
            self.aps_scheduler.add_job(
                self._trigger_cameras, 'cron', day_of_week='mon-sat',
                hour=scan2_hour, minute=scan2_min, args=[period_id, "scan2"],
                name=f"Cron-Scan2-{period_id}",
                misfire_grace_time=None
            )
            logger.info(f"Scheduled {period_id}: Scan1@{scan1_hour:02d}:{scan1_min:02d}, Scan2@{scan2_hour:02d}:{scan2_min:02d}")
            
        self.aps_scheduler.start()

    def _trigger_cameras(self, period_id, scan_type):
        """
        Fired by APScheduler.
        Finds the camera configured in config.py, checks what section it maps to,
        finds the timetable subject for that section today, and triggers the scan.
        """
        if scan_type == "scan1":
            print(f"\n\033[93m*********** {period_id} Starting ***********\033[0m")
        elif scan_type == "scan2":
            print(f"\n\033[91m***** {period_id} Ending ************\033[0m")
        logger.info(f"CRON TRIGGERED: {period_id} - {scan_type}")
        try:
            # 1. Fetch Cameras mapping
            cam_url = f"{config.BACKEND_API_URL}/cameras"
            cam_res = requests.get(cam_url, timeout=5)
            cameras = cam_res.json().get("data", []) if cam_res.status_code == 200 else []
            
            my_ip = config.CAMERA_SOURCE
            my_cam = next((c for c in cameras if c.get("ipAddress") and c.get("ipAddress") in my_ip), None)
            
            if not my_cam:
                logger.error(f"My configured camera IP '{my_ip}' is not mapped to any room in Admin Portal.")
                return
                
            section = my_cam.get("section")
            logger.info(f"Camera belongs to Section: {section}")
            
            # 2. Fetch Timetable for this section for today
            day_names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
            today_day = day_names[datetime.now().isoweekday() % 7]
            
            tt_url = f"{config.BACKEND_API_URL}/timetable?section={section}&day={today_day}"
            tt_res = requests.get(tt_url, timeout=5)
            timetable = tt_res.json().get("data", []) if tt_res.status_code == 200 else []
            
            current_subject_id = None
            current_subject_name = None
            for entry in timetable:
                if entry.get("period") == period_id:
                    current_subject_id = entry.get("subjectId")
                    current_subject_name = entry.get("subjectName", "Unknown Subject")
                    break
                    
            if not current_subject_id:
                logger.info(f"No subject scheduled for {section} on {today_day} {period_id}. Enjoy the free period.")
                return
                
            logger.info(f"Timetable matched! Subject: {current_subject_name} ({current_subject_id}). Starting scan...")
            
            # 3. Trigger the scanner logic
            self.execute_passive_scan(
                section=section,
                subject_id=current_subject_id,
                period=period_id,
                duration_seconds=config.DEFAULT_SCAN_DURATION,
                scan_type=scan_type
            )
            
        except Exception as e:
            logger.error(f"Failed in _trigger_cameras cron task: {e}")

    def stop(self):
        if self.aps_scheduler.running:
            self.aps_scheduler.shutdown(wait=False)
