import requests

url = 'http://192.168.0.112:8899/onvif/device_service'
headers = {'Content-Type': 'application/soap+xml; charset=utf-8'}
payload = '''<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl"><Category>All</Category></GetCapabilities></s:Body></s:Envelope>'''

try:
    response = requests.post(url, data=payload, headers=headers, timeout=5)
    print("ONVIF Response Status:", response.status_code)
    # print(response.text[:500])
    
    if "media" in response.text.lower():
        print("Media service found!")
except Exception as e:
    print("Error:", e)
