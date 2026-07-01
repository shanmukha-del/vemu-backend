import requests

url = 'http://192.168.0.112:8899/onvif/device_service'
headers = {'Content-Type': 'application/soap+xml; charset=utf-8'}
# GetProfiles request
payload1 = '''<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/></s:Body></s:Envelope>'''

# GetStreamUri request template
payload2 = '''<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl"><StreamSetup><Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream><Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport></StreamSetup><ProfileToken>{token}</ProfileToken></GetStreamUri></s:Body></s:Envelope>'''

try:
    print("Getting Profiles...")
    res1 = requests.post(url, data=payload1, headers=headers, timeout=5)
    import re
    # Extract the first profile token using regex
    match = re.search(r'token="([^"]+)"', res1.text)
    if match:
        token = match.group(1)
        print("Found Profile Token:", token)
        
        print("Getting Stream URI...")
        res2 = requests.post(url, data=payload2.format(token=token), headers=headers, timeout=5)
        uri_match = re.search(r'<Uri[^>]*>(.*?)</Uri>', res2.text, re.IGNORECASE)
        if uri_match:
            print("STREAM URI:", uri_match.group(1))
        else:
            print("Failed to parse URI from:", res2.text[:200])
    else:
        print("Failed to find profile token in:", res1.text[:200])
except Exception as e:
    print("Error:", e)
