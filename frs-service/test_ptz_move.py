import requests
import time

url = 'http://192.168.0.112:8899/onvif/ptz_service'
headers = {'Content-Type': 'application/soap+xml; charset=utf-8'}
# ContinuousMove request template
# Pan is PanTilt x, Tilt is PanTilt y
move_payload = '''<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><ContinuousMove xmlns="http://www.onvif.org/ver20/ptz/wsdl"><ProfileToken>PROFILE_000</ProfileToken><Velocity><PanTilt xmlns="http://www.onvif.org/ver10/schema" x="{pan}" y="{tilt}"/></Velocity></ContinuousMove></s:Body></s:Envelope>'''
stop_payload = '''<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><Stop xmlns="http://www.onvif.org/ver20/ptz/wsdl"><ProfileToken>PROFILE_000</ProfileToken><PanTilt>true</PanTilt></Stop></s:Body></s:Envelope>'''

try:
    print("Sending PTZ Move Right...")
    # x=0.5 (move right at half speed)
    res = requests.post(url, data=move_payload.format(pan="0.5", tilt="0.0"), headers=headers, timeout=5)
    print("Move Response:", res.status_code)
    
    time.sleep(2)
    
    print("Sending PTZ Stop...")
    res = requests.post(url, data=stop_payload, headers=headers, timeout=5)
    print("Stop Response:", res.status_code)
except Exception as e:
    print("Error:", e)
