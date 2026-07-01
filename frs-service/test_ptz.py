import requests

url = 'http://192.168.0.112:8899/onvif/device_service'
headers = {'Content-Type': 'application/soap+xml; charset=utf-8'}
# GetCapabilities to find PTZ URL
payload1 = '''<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl"><Category>PTZ</Category></GetCapabilities></s:Body></s:Envelope>'''

try:
    print("Getting Capabilities...")
    res1 = requests.post(url, data=payload1, headers=headers, timeout=5)
    print("Capabilities Response:", res1.status_code)
    import re
    # Look for PTZ XAddr
    match = re.search(r'<tt:XAddr[^>]*>(.*?)</tt:XAddr>', res1.text, re.IGNORECASE)
    if match:
        ptz_url = match.group(1)
        print("Found PTZ URL:", ptz_url)
    else:
        print("No PTZ URL found in response.")
        print(res1.text[:500])
except Exception as e:
    print("Error:", e)
