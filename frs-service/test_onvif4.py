import requests

url = 'http://192.168.0.112:8899/onvif/device_service'
headers = {'Content-Type': 'application/soap+xml; charset=utf-8'}
payload2 = '''<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl"><StreamSetup><Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream><Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport></StreamSetup><ProfileToken>PROFILE_000</ProfileToken></GetStreamUri></s:Body></s:Envelope>'''

try:
    res2 = requests.post(url, data=payload2, headers=headers, timeout=5)
    print("Response text:", res2.text)
except Exception as e:
    print("Error:", e)
