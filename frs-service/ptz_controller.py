import requests
import logging

logger = logging.getLogger("PTZController")

class PTZController:
    def __init__(self, ip="192.168.0.132", port=8899, profile_token="PROFILE_000"):
        self.port = port
        self.profile_token = profile_token
        self.headers = {'Content-Type': 'application/soap+xml; charset=utf-8'}
        self.set_camera(ip)
        
    def set_camera(self, ip: str):
        self.url = f'http://{ip}:{self.port}/onvif/ptz_service'
        logger.info(f"PTZ Controller configured for IP: {ip}")
        
        self.move_payload = '''<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body>
    <ContinuousMove xmlns="http://www.onvif.org/ver20/ptz/wsdl">
      <ProfileToken>{token}</ProfileToken>
      <Velocity>
        <PanTilt xmlns="http://www.onvif.org/ver10/schema" x="{pan}" y="{tilt}"/>
      </Velocity>
    </ContinuousMove>
  </s:Body>
</s:Envelope>'''

        self.stop_payload = '''<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body>
    <Stop xmlns="http://www.onvif.org/ver20/ptz/wsdl">
      <ProfileToken>{token}</ProfileToken>
      <PanTilt>true</PanTilt>
    </Stop>
  </s:Body>
</s:Envelope>'''

    def _send(self, data):
        try:
            res = requests.post(self.url, data=data, headers=self.headers, timeout=3)
            return res.status_code == 200
        except Exception as e:
            logger.error(f"PTZ Command Error: {e}")
            return False

    def move(self, pan_speed: float, tilt_speed: float = 0.0):
        """
        Move camera continuously. 
        pan_speed: positive is right, negative is left (-1.0 to 1.0)
        tilt_speed: positive is up, negative is down (-1.0 to 1.0)
        """
        payload = self.move_payload.format(token=self.profile_token, pan=pan_speed, tilt=tilt_speed)
        return self._send(payload)

    def stop(self):
        """Stop all continuous movement."""
        payload = self.stop_payload.format(token=self.profile_token)
        return self._send(payload)

ptz = PTZController()
