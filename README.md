# 📸 Virtual Onvif Proxy
Simple docker container to add any RTSP stream into Unify Protect 7+
>Tested working with 7.0.107
>Tested working with AI Port

This is a continuation from the simple virtual ONVIF proxy that was originally released by Daniela Hase.
  
This repository has added features such as ...
- Making it a pure docker appliance. Pull-And-Run™
- Only deals with RSTP to ONVIF proxies
- Auto creates MAC addresses and registers IPv4 with DHCP
- more to come...

What can you adopt?
- Adopt `IP camera --> RTSP (h264) --> Protect` 
- Adopt `Raspberry Pi Camera --> uv4l --> RTSP (h254) -- Protect`
- Adopt `Analog --> NVR --> RTSP (h264) --> Protect` 
- Adopt `WebCam --> go2rtc --> RTSP (h264) --> Protect`
- Adopt `... Anything RTSP --> Protect`


# 🧾 Getting Started

In a few steps you will have everything needed to run container first time. This will auto confiugre IP's for you.
If you want more control over MAC's and IP's scroll down to Router Setup

## Docker compose

Create a directory locally where you will keep your compose and config files.

1. Create a directory and change into it
  - `mkdir rtsp-to-onvif` and `cd rtsp-to-onvif`
2. Download the compose.yaml file
  - `wget https://github.com/dlo747/RTSP-to-ONVIF-Unifi-Protect/refs/heads/release/compose.yaml`
3. Download the config.example.yaml and clone it
  - `wget https://github.com/dlo747/RTSP-to-ONVIF-Unifi-Protect/refs/heads/release/config.example.yaml`
  - `cp config.example.yaml config.yaml`
4. Edit and configure your cameras
  - `nano config.yaml`
5. Run compose in attached mode and check for any messages.
  - `sudo docker compose up`
6. If you see the cameras show up in Protect then you can run docker in detached mode (or use Dockge, Portainer, etc...)
  - `sudo docker compose up d`


## Config file

- You just need to supply the bare minimum for each camera
- Autoconfigure MAC addresses all use Unicast LAA prefix `1A:11:B0` and the NIC address will be random
- UUID addresses will be added automatically
- IPv4 will come from your DHCP server

> ℹ️ **NOTE** 
> 
> This file will be overwritten during automatic configuration so comments will be lost.
> 
> No username or passwords required here!
> Sample YAML is for a Dahua camera. Might have to change your rtsp/snapshot streams


```yaml
onvif:
  - name: Driveway                              # A user define named that will show up in the consumer device. Use letters only, no spaces or special characters
    dev: enp3s0 #eth0                             # Network interface to add virtual IP's too. use ip addr to find your name
    target:
      hostname: 192.168.1.73                       # Your cameras IPv4 address
      ports:
        rtsp: 554                                  # Your cameras RTSP port. Typically 554
        snapshot: 80                               # Cameras non https port for snapshots
    highQuality:
      rtsp: /cam/realmonitor?channel=2&subtype=0        # The RTSP Path
      snapshot: /cgi-bin/snapshot.cgi?channel=2   	# Snapshot path - not working yet
      width: 3840                                       # The Video Width
      height: 2160                                      # The Video Height
      framerate: 30                                     # The Video Framerate/FPS
      bitrate: 16384                                     # The Video Bitrate in kb/s
      quality: 4                                        # Quality, leave this as 4 for the high quality stream.
    ports:                                              # Virtual server ports. No need to change these unles you run into port already in use problems
      server: 8081
      rtsp: 8554
      snapshot: 8080
    #mac - automatically added here and IP comes from DHCP- Add your own if you know what you doing
    #uuid - ONVIF ID - automatically added here. If you change it Protect will think its a different camera
```

## Unifi Protect
Tested on Unifi Protect 7.0.107

Once the device shows up in protect, make sure the correct MAC address is assigned to the IP before adopting. 
You can then adopt it and provide the username and password that are set on the real RTSP device.

Known Limitations

> "Third-party features such as analytics, audio playback, and pan-tilt-zoom (PTZ) control are not supported." - Unify Support

- Seems to only support recording normal/high profile h264 video streams at the moment
- Your luck with h265 may vary
- Scrubbing does not seem to work? Possibly depends on the h264 implementaion on the camera
- Snapshot not implemented yet. Hope it works.
- HighProfile support only for now - You can supply LowProfile but that shows up as an extra camera.
