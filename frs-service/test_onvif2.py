import asyncio
from onvif import ONVIFCamera
import os

async def run():
    try:
        # Find where onvif_zeep is installed
        import site
        wsdl_path = os.path.join(site.getusersitepackages(), 'onvif', 'wsdl')
        
        mycam = ONVIFCamera('192.168.0.112', 8899, 'admin', 'ZnUeV53P', wsdl_path)
        await mycam.update_xaddrs()
        
        media_service = mycam.create_media_service()
        profiles = await media_service.GetProfiles()
        token = profiles[0].token
        
        obj = media_service.create_type('GetStreamUri')
        obj.ProfileToken = token
        obj.StreamSetup = {'Stream': 'RTP-Unicast', 'Transport': {'Protocol': 'RTSP'}}
        res = await media_service.GetStreamUri(obj)
        print("STREAM URI:", res.Uri)
    except Exception as e:
        print("Error:", e)

if __name__ == '__main__':
    asyncio.run(run())
