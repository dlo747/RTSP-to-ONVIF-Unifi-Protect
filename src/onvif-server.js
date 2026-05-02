const http = require('http');
const dgram = require('dgram');
const xml2js = require('xml2js');
const uuid = require('node-uuid');
const url = require('url');
const fs = require('fs');
const logger = require('simple-node-logger');

const { getIp4FromMac } = require('./net-tools')

Date.prototype.stdTimezoneOffset = function () {
    let jan = new Date(this.getFullYear(), 0, 1);
    let jul = new Date(this.getFullYear(), 6, 1);
    return Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
}

Date.prototype.isDstObserved = function () {
    return this.getTimezoneOffset() < this.stdTimezoneOffset();
}

module.exports = class OnvifServer {
    constructor(logger, config) {
        this.config = config;
        this.logger = logger;

        this.config.hostname = getIp4FromMac(logger, this.config.mac);
        if (!this.config.hostname)
            return -1;

        this.videoSource = {
            attributes: {
                token: 'video_src_token'
            },
            Framerate: this.config.highQuality.framerate,
            Resolution: { Width: this.config.highQuality.width, Height: this.config.highQuality.height }
        };

        this.profiles = [
            {
                Name: 'MainStream',
                attributes: {
                    token: 'main_stream'
                },
                VideoSourceConfiguration: {
                    Name: 'VideoSource',
                    UseCount: 2,
                    attributes: {
                        token: 'video_src_config_token'
                    },
                    SourceToken: 'video_src_token',
                    Bounds: { attributes: { x: 0, y: 0, width: this.config.highQuality.width, height: this.config.highQuality.height } }
                },
                VideoEncoderConfiguration: {
                    attributes: {
                        token: 'encoder_hq_config_token'
                    },
                    Name: 'CardinalHqCameraConfiguration',
                    UseCount: 1,
                    Encoding: 'H264',
                    Resolution: {
                        Width: this.config.highQuality.width,
                        Height: this.config.highQuality.height
                    },
                    Quality: this.config.highQuality.quality,
                    RateControl: {
                        FrameRateLimit: this.config.highQuality.framerate,
                        EncodingInterval: 1,
                        BitrateLimit: this.config.highQuality.bitrate
                    },
                    H264: {
                        GovLength: this.config.highQuality.framerate,
                        H264Profile: 'Main'
                    },
                    SessionTimeout: 'PT1000S'
                }
            }
        ];

        if (this.config.lowQuality) {
            this.profiles.push(
                {
                    Name: 'SubStream',
                    attributes: {
                        token: 'sub_stream'
                    },
                    VideoSourceConfiguration: {
                        Name: 'VideoSource',
                        UseCount: 2,
                        attributes: {
                            token: 'video_src_config_token'
                        },
                        SourceToken: 'video_src_token',
                        Bounds: { attributes: { x: 0, y: 0, width: this.config.highQuality.width, height: this.config.highQuality.height } }
                    },
                    VideoEncoderConfiguration: {
                        attributes: {
                            token: 'encoder_lq_config_token'
                        },
                        Name: 'CardinalLqCameraConfiguration',
                        UseCount: 1,
                        Encoding: 'H264',
                        Resolution: {
                            Width: this.config.lowQuality.width,
                            Height: this.config.lowQuality.height
                        },
                        Quality: this.config.lowQuality.quality,
                        RateControl: {
                            FrameRateLimit: this.config.lowQuality.framerate,
                            EncodingInterval: 1,
                            BitrateLimit: this.config.lowQuality.bitrate
                        },
                        H264: {
                            GovLength: this.config.lowQuality.framerate,
                            H264Profile: 'Main'
                        },
                        SessionTimeout: 'PT1000S'
                    }
                }
            );
        }

        this.onvif = {
            DeviceService: {
                Device: {
                    GetSystemDateAndTime: (args) => {
                        let now = new Date();

                        let offset = now.getTimezoneOffset();
                        let abs_offset = Math.abs(offset);
                        let hrs_offset = Math.floor(abs_offset / 60);
                        let mins_offset = (abs_offset % 60);
                        let tz = 'UTC' + (offset < 0 ? '-' : '+') + hrs_offset + (mins_offset === 0 ? '' : ':' + mins_offset);

                        return {
                            SystemDateAndTime: {
                                DateTimeType: 'NTP',
                                DaylightSavings: now.isDstObserved(),
                                TimeZone: {
                                    TZ: tz
                                },
                                UTCDateTime: {
                                    Time: { Hour: now.getUTCHours(), Minute: now.getUTCMinutes(), Second: now.getUTCSeconds() },
                                    Date: { Year: now.getUTCFullYear(), Month: now.getUTCMonth() + 1, Day: now.getUTCDate() }
                                },
                                LocalDateTime: {
                                    Time: { Hour: now.getHours(), Minute: now.getMinutes(), Second: now.getSeconds() },
                                    Date: { Year: now.getFullYear(), Month: now.getMonth() + 1, Day: now.getDate() }
                                },
                                Extension: {}
                            }
                        };
                    },

                    GetCapabilities: (args) => {
                        let response = {
                            Capabilities: {}
                        };

                        if (args.Category === undefined || args.Category == 'All' || args.Category == 'Device') {
                            response.Capabilities['Device'] = {
                                XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service`,
                                Network: {
                                    IPFilter: false,
                                    ZeroConfiguration: false,
                                    IPVersion6: false,
                                    DynDNS: false,
                                    Extension: {
                                        Dot11Configuration: false,
                                        Extension: {}
                                    }
                                },
                                System: {
                                    DiscoveryResolve: false,
                                    DiscoveryBye: false,
                                    RemoteDiscovery: false,
                                    SystemBackup: false,
                                    SystemLogging: false,
                                    FirmwareUpgrade: false,
                                    SupportedVersions: {
                                        Major: 2,
                                        Minor: 5
                                    },
                                    Extension: {
                                        HttpFirmwareUpgrade: false,
                                        HttpSystemBackup: false,
                                        HttpSystemLogging: false,
                                        HttpSupportInformation: false,
                                        Extension: {}
                                    }
                                },
                                IO: {
                                    InputConnectors: 0,
                                    RelayOutputs: 1,
                                    Extension: {
                                        Auxiliary: false,
                                        AuxiliaryCommands: '',
                                        Extension: {}
                                    }
                                },
                                Security: {
                                    'TLS1.1': false,
                                    'TLS1.2': false,
                                    OnboardKeyGeneration: false,
                                    AccessPolicyConfig: false,
                                    'X.509Token': false,
                                    SAMLToken: false,
                                    KerberosToken: false,
                                    RELToken: false,
                                    Extension: {
                                        'TLS1.0': false,
                                        Extension: {
                                            Dot1X: false,
                                            RemoteUserHandling: false
                                        }
                                    }
                                },
                                Extension: {}
                            };
                        }
                        if (args.Category === undefined || args.Category == 'All' || args.Category == 'Media') {
                            response.Capabilities['Media'] = {
                                XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/media_service`,
                                StreamingCapabilities: {
                                    RTPMulticast: false,
                                    RTP_TCP: true,
                                    RTP_RTSP_TCP: true,
                                    Extension: {}
                                },
                                Extension: {
                                    ProfileCapabilities: {
                                        MaximumNumberOfProfiles: this.profiles.length
                                    }
                                }
                            }
                        }

                        return response;
                    },

                    GetServices: (args) => {
                        return {
                            Service: [
                                {
                                    Namespace: 'http://www.onvif.org/ver10/device/wsdl',
                                    XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service`,
                                    Version: {
                                        Major: 2,
                                        Minor: 5,
                                    }
                                },
                                {
                                    Namespace: 'http://www.onvif.org/ver10/media/wsdl',
                                    XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/media_service`,
                                    Version: {
                                        Major: 2,
                                        Minor: 5,
                                    }
                                }
                            ]
                        };
                    },

                    GetDeviceInformation: (args) => {
                        return {
                            Manufacturer: 'rtsp-2-onvif',
                            Model: `${this.config.name}`,
                            FirmwareVersion: '1.0.0',
                            SerialNumber: `${this.config.name.replace(' ', '_')}-0000`,
                            HardwareId: `${this.config.name.replace(' ', '_')}-1001`
                        };
                    }

                }
            },

            MediaService: {
                Media: {
                    GetProfiles: (args) => {
                        return {
                            Profiles: this.profiles
                        };
                    },

                    GetVideoSources: (args) => {
                        return {
                            VideoSources: [
                                this.videoSource
                            ]
                        };
                    },

                    GetSnapshotUri: (args) => {
                        let uri = `http://${this.config.hostname}:${this.config.ports.server}/snapshot.png`;
                        if (args.ProfileToken == 'sub_stream' && this.config.lowQuality && this.config.lowQuality.snapshot)
                            uri = `http://${this.config.hostname}:${this.config.ports.snapshot}${this.config.lowQuality.snapshot}`;
                        else if (this.config.highQuality.snapshot)
                            uri = `http://${this.config.hostname}:${this.config.ports.snapshot}${this.config.highQuality.snapshot}`;

                        return {
                            MediaUri: {
                                Uri: uri,
                                InvalidAfterConnect: false,
                                InvalidAfterReboot: false,
                                Timeout: 'PT30S'
                            }
                        };
                    },

                    GetStreamUri: (args) => {
                        let path = this.config.highQuality.rtsp;
                        if (args.ProfileToken == 'sub_stream' && this.config.lowQuality)
                            path = this.config.lowQuality.rtsp;

                        return {
                            MediaUri: {
                                Uri: `rtsp://${this.config.hostname}:${this.config.ports.rtsp}${path}`,
                                InvalidAfterConnect: false,
                                InvalidAfterReboot: false,
                                Timeout: 'PT30S'
                            }
                        };
                    }
                }
            }
        };
    }

    xmlEscape(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    getRequestAction(body) {
        let bodyMatch = body.match(/<(?:\w+:)?Body\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Body>/);
        if (!bodyMatch)
            return null;

        let actionMatch = bodyMatch[1].match(/<(?:(?:\w+):)?([A-Za-z0-9_]+)\b/);
        return actionMatch ? actionMatch[1] : null;
    }

    getRequestValue(body, name) {
        let match = body.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
        return match ? match[1].trim() : undefined;
    }

    readRequestBody(request, callback) {
        let chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => callback(Buffer.concat(chunks).toString('utf8')));
    }

    soapEnvelope(content) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
${content}
  </s:Body>
</s:Envelope>`;
    }

    sendSoapResponse(response, content) {
        let xml = this.soapEnvelope(content);
        response.writeHead(200, {
            'Content-Type': 'application/soap+xml; charset=utf-8',
            'Content-Length': Buffer.byteLength(xml)
        });
        response.end(xml);
    }

    sendSoapFault(response, reason) {
        this.logger.error(`SERVER: ${reason}`);
        this.sendSoapResponse(response, `    <s:Fault>
      <s:Code><s:Value>s:Sender</s:Value></s:Code>
      <s:Reason><s:Text xml:lang="en">${this.xmlEscape(reason)}</s:Text></s:Reason>
    </s:Fault>`);
    }

    getTimezone() {
        let now = new Date();
        let offset = now.getTimezoneOffset();
        let absOffset = Math.abs(offset);
        let hours = Math.floor(absOffset / 60);
        let minutes = absOffset % 60;
        return 'UTC' + (offset > 0 ? '-' : '+') + hours + (minutes === 0 ? '' : ':' + minutes);
    }

    getSystemDateAndTimeResponse() {
        let now = new Date();
        return `    <tds:GetSystemDateAndTimeResponse>
      <tds:SystemDateAndTime>
        <tt:DateTimeType>NTP</tt:DateTimeType>
        <tt:DaylightSavings>${now.isDstObserved()}</tt:DaylightSavings>
        <tt:TimeZone><tt:TZ>${this.getTimezone()}</tt:TZ></tt:TimeZone>
        <tt:UTCDateTime>
          <tt:Time><tt:Hour>${now.getUTCHours()}</tt:Hour><tt:Minute>${now.getUTCMinutes()}</tt:Minute><tt:Second>${now.getUTCSeconds()}</tt:Second></tt:Time>
          <tt:Date><tt:Year>${now.getUTCFullYear()}</tt:Year><tt:Month>${now.getUTCMonth() + 1}</tt:Month><tt:Day>${now.getUTCDate()}</tt:Day></tt:Date>
        </tt:UTCDateTime>
        <tt:LocalDateTime>
          <tt:Time><tt:Hour>${now.getHours()}</tt:Hour><tt:Minute>${now.getMinutes()}</tt:Minute><tt:Second>${now.getSeconds()}</tt:Second></tt:Time>
          <tt:Date><tt:Year>${now.getFullYear()}</tt:Year><tt:Month>${now.getMonth() + 1}</tt:Month><tt:Day>${now.getDate()}</tt:Day></tt:Date>
        </tt:LocalDateTime>
      </tds:SystemDateAndTime>
    </tds:GetSystemDateAndTimeResponse>`;
    }

    getServicesResponse() {
        return `    <tds:GetServicesResponse>
      <tds:Service>
        <tds:Namespace>http://www.onvif.org/ver10/device/wsdl</tds:Namespace>
        <tds:XAddr>http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service</tds:XAddr>
        <tds:Version><tt:Major>2</tt:Major><tt:Minor>5</tt:Minor></tds:Version>
      </tds:Service>
      <tds:Service>
        <tds:Namespace>http://www.onvif.org/ver10/media/wsdl</tds:Namespace>
        <tds:XAddr>http://${this.config.hostname}:${this.config.ports.server}/onvif/media_service</tds:XAddr>
        <tds:Version><tt:Major>2</tt:Major><tt:Minor>5</tt:Minor></tds:Version>
      </tds:Service>
    </tds:GetServicesResponse>`;
    }

    getCapabilitiesResponse() {
        return `    <tds:GetCapabilitiesResponse>
      <tds:Capabilities>
        <tt:Device>
          <tt:XAddr>http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service</tt:XAddr>
          <tt:Network><tt:IPFilter>false</tt:IPFilter><tt:ZeroConfiguration>false</tt:ZeroConfiguration><tt:IPVersion6>false</tt:IPVersion6><tt:DynDNS>false</tt:DynDNS></tt:Network>
          <tt:System>
            <tt:DiscoveryResolve>false</tt:DiscoveryResolve>
            <tt:DiscoveryBye>false</tt:DiscoveryBye>
            <tt:RemoteDiscovery>false</tt:RemoteDiscovery>
            <tt:SystemBackup>false</tt:SystemBackup>
            <tt:SystemLogging>false</tt:SystemLogging>
            <tt:FirmwareUpgrade>false</tt:FirmwareUpgrade>
            <tt:SupportedVersions><tt:Major>2</tt:Major><tt:Minor>5</tt:Minor></tt:SupportedVersions>
          </tt:System>
          <tt:IO><tt:InputConnectors>0</tt:InputConnectors><tt:RelayOutputs>0</tt:RelayOutputs></tt:IO>
          <tt:Security><tt:TLS1.1>false</tt:TLS1.1><tt:TLS1.2>false</tt:TLS1.2><tt:OnboardKeyGeneration>false</tt:OnboardKeyGeneration><tt:AccessPolicyConfig>false</tt:AccessPolicyConfig><tt:X.509Token>false</tt:X.509Token><tt:SAMLToken>false</tt:SAMLToken><tt:KerberosToken>false</tt:KerberosToken><tt:RELToken>false</tt:RELToken></tt:Security>
        </tt:Device>
        <tt:Media>
          <tt:XAddr>http://${this.config.hostname}:${this.config.ports.server}/onvif/media_service</tt:XAddr>
          <tt:StreamingCapabilities><tt:RTPMulticast>false</tt:RTPMulticast><tt:RTP_TCP>true</tt:RTP_TCP><tt:RTP_RTSP_TCP>true</tt:RTP_RTSP_TCP></tt:StreamingCapabilities>
        </tt:Media>
      </tds:Capabilities>
    </tds:GetCapabilitiesResponse>`;
    }

    getDeviceInformationResponse() {
        let safeName = this.xmlEscape(this.config.name);
        let serialName = this.xmlEscape(this.config.name.replace(' ', '_'));
        return `    <tds:GetDeviceInformationResponse>
      <tds:Manufacturer>rtsp-to-onvif</tds:Manufacturer>
      <tds:Model>${safeName}</tds:Model>
      <tds:FirmwareVersion>1.0.0</tds:FirmwareVersion>
      <tds:SerialNumber>${serialName}-0000</tds:SerialNumber>
      <tds:HardwareId>${serialName}-1001</tds:HardwareId>
    </tds:GetDeviceInformationResponse>`;
    }

    profileXml(profile) {
        let token = this.xmlEscape(profile.attributes.token);
        let encoder = profile.VideoEncoderConfiguration;
        return `      <trt:Profiles token="${token}" fixed="true">
        <tt:Name>${this.xmlEscape(profile.Name)}</tt:Name>
        <tt:VideoSourceConfiguration token="${this.xmlEscape(profile.VideoSourceConfiguration.attributes.token)}">
          <tt:Name>${this.xmlEscape(profile.VideoSourceConfiguration.Name)}</tt:Name>
          <tt:UseCount>${profile.VideoSourceConfiguration.UseCount}</tt:UseCount>
          <tt:SourceToken>${this.xmlEscape(profile.VideoSourceConfiguration.SourceToken)}</tt:SourceToken>
          <tt:Bounds x="0" y="0" width="${profile.VideoSourceConfiguration.Bounds.attributes.width}" height="${profile.VideoSourceConfiguration.Bounds.attributes.height}"/>
        </tt:VideoSourceConfiguration>
        <tt:VideoEncoderConfiguration token="${this.xmlEscape(encoder.attributes.token)}">
          <tt:Name>${this.xmlEscape(encoder.Name)}</tt:Name>
          <tt:UseCount>${encoder.UseCount}</tt:UseCount>
          <tt:Encoding>${encoder.Encoding}</tt:Encoding>
          <tt:Resolution><tt:Width>${encoder.Resolution.Width}</tt:Width><tt:Height>${encoder.Resolution.Height}</tt:Height></tt:Resolution>
          <tt:Quality>${encoder.Quality}</tt:Quality>
          <tt:RateControl><tt:FrameRateLimit>${encoder.RateControl.FrameRateLimit}</tt:FrameRateLimit><tt:EncodingInterval>${encoder.RateControl.EncodingInterval}</tt:EncodingInterval><tt:BitrateLimit>${encoder.RateControl.BitrateLimit}</tt:BitrateLimit></tt:RateControl>
          <tt:H264><tt:GovLength>${encoder.H264.GovLength}</tt:GovLength><tt:H264Profile>${encoder.H264.H264Profile}</tt:H264Profile></tt:H264>
          <tt:SessionTimeout>${encoder.SessionTimeout}</tt:SessionTimeout>
        </tt:VideoEncoderConfiguration>
      </trt:Profiles>`;
    }

    getProfilesResponse() {
        return `    <trt:GetProfilesResponse>
${this.profiles.map((profile) => this.profileXml(profile)).join('\n')}
    </trt:GetProfilesResponse>`;
    }

    getVideoSourcesResponse() {
        return `    <trt:GetVideoSourcesResponse>
      <trt:VideoSources token="${this.xmlEscape(this.videoSource.attributes.token)}">
        <tt:Framerate>${this.videoSource.Framerate}</tt:Framerate>
        <tt:Resolution><tt:Width>${this.videoSource.Resolution.Width}</tt:Width><tt:Height>${this.videoSource.Resolution.Height}</tt:Height></tt:Resolution>
      </trt:VideoSources>
    </trt:GetVideoSourcesResponse>`;
    }

    getSnapshotUri(profileToken) {
        if (profileToken == 'sub_stream' && this.config.lowQuality && this.config.lowQuality.snapshot)
            return `http://${this.config.hostname}:${this.config.ports.snapshot}${this.config.lowQuality.snapshot}`;
        if (this.config.highQuality.snapshot)
            return `http://${this.config.hostname}:${this.config.ports.snapshot}${this.config.highQuality.snapshot}`;
        return `http://${this.config.hostname}:${this.config.ports.server}/snapshot.png`;
    }

    getSnapshotUriResponse(profileToken) {
        return `    <trt:GetSnapshotUriResponse>
      <trt:MediaUri>
        <tt:Uri>${this.xmlEscape(this.getSnapshotUri(profileToken))}</tt:Uri>
        <tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>
        <tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>
        <tt:Timeout>PT30S</tt:Timeout>
      </trt:MediaUri>
    </trt:GetSnapshotUriResponse>`;
    }

    getStreamUri(profileToken) {
        let path = this.config.highQuality.rtsp;
        if (profileToken == 'sub_stream' && this.config.lowQuality)
            path = this.config.lowQuality.rtsp;
        return `rtsp://${this.config.hostname}:${this.config.ports.rtsp}${path}`;
    }

    getStreamUriResponse(profileToken) {
        return `    <trt:GetStreamUriResponse>
      <trt:MediaUri>
        <tt:Uri>${this.xmlEscape(this.getStreamUri(profileToken))}</tt:Uri>
        <tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>
        <tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>
        <tt:Timeout>PT30S</tt:Timeout>
      </trt:MediaUri>
    </trt:GetStreamUriResponse>`;
    }

    handleOnvifRequest(request, response) {
        this.readRequestBody(request, (body) => {
            let action = this.getRequestAction(body);
            let profileToken = this.getRequestValue(body, 'ProfileToken');

            if (process.env.DEBUG) {
                console.debug(`SERVER: Handling POST on ${url.parse(request.url, true).pathname}`);
                console.debug(`SERVER: ${body}`);
                console.debug(`SERVER: Action ${action}`);
            }

            switch (action) {
                case 'GetSystemDateAndTime':
                    return this.sendSoapResponse(response, this.getSystemDateAndTimeResponse());
                case 'GetServices':
                    return this.sendSoapResponse(response, this.getServicesResponse());
                case 'GetCapabilities':
                    return this.sendSoapResponse(response, this.getCapabilitiesResponse());
                case 'GetDeviceInformation':
                    return this.sendSoapResponse(response, this.getDeviceInformationResponse());
                case 'GetProfiles':
                    return this.sendSoapResponse(response, this.getProfilesResponse());
                case 'GetVideoSources':
                    return this.sendSoapResponse(response, this.getVideoSourcesResponse());
                case 'GetSnapshotUri':
                    return this.sendSoapResponse(response, this.getSnapshotUriResponse(profileToken));
                case 'GetStreamUri':
                    return this.sendSoapResponse(response, this.getStreamUriResponse(profileToken));
                default:
                    return this.sendSoapFault(response, `Unsupported ONVIF action ${action || '(none)'}`);
            }
        });
    }

    listen(request, response) {
        let action = url.parse(request.url, true).pathname;
        if ((action == '/onvif/device_service' || action == '/onvif/media_service') && request.method == 'POST') {
            this.handleOnvifRequest(request, response);
        } else if (action == '/onvif/device_service' && request.method == 'GET') {
            let xml = fs.readFileSync('./wsdl/device_service.wsdl', 'utf8');
            response.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
            response.end(xml);
        } else if (action == '/onvif/media_service' && request.method == 'GET') {
            let xml = fs.readFileSync('./wsdl/media_service.wsdl', 'utf8');
            response.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
            response.end(xml);
        } else if (action == '/snapshot.png') {
            let image = fs.readFileSync('./resources/snapshot.png');
            response.writeHead(200, { 'Content-Type': 'image/png' });
            response.end(image, 'binary');
        } else {
            response.writeHead(404, { 'Content-Type': 'text/plain' });
            response.write('404 Not Found\n');
            response.end();
        }
    }

    startHttpServer() {
        this.logger.info(`SERVER: ${this.config.name} - HTTP listening on ${this.config.hostname}:${this.config.ports.server}`);

        this.server = http.createServer(this.listen.bind(this));
        this.server.listen(this.config.ports.server, this.config.hostname);
    }

    enableDebugOutput() {
        this.logger.debug(`SERVER: ${this.config.name} - ONVIF debug output enabled`);
        // this.deviceService.on('request', (request, methodName) => {
        //     this.logger.debug(`SERVER: ${this.config.name} - DeviceService: ${methodName}`);
        // });

        // this.mediaService.on('request', (request, methodName) => {
        //     this.logger.debug(`SERVER: ${this.config.name} -  MediaService: ${methodName}`);
        // });
    }

    startDiscovery() {
        this.discoveryMessageNo = 0;
        this.discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.discoverySocket.on('message', (message, remote) => {

            this.logger.debug(`SERVER: ${this.config.name} - Discovery request from ${remote.address}:${remote.port}`);

            xml2js.parseString(message.toString(), { tagNameProcessors: [xml2js['processors'].stripPrefix] }, (err, result) => {
                let probeUuid = result['Envelope']['Header'][0]['MessageID'][0];
                let probeType = '';
                try {
                    probeType = result['Envelope']['Body'][0]['Probe'][0]['Types'][0];
                } catch (err) {
                    probeType = '';
                }

                if (typeof probeType === 'object')
                    probeType = probeType._;

                if (probeType === '' || probeType.indexOf('NetworkVideoTransmitter') > -1) {
                    let response =
                        `<?xml version="1.0" encoding="UTF-8"?>
                        <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
                            <SOAP-ENV:Header>
                                <wsa:MessageID>uuid:${uuid.v1()}</wsa:MessageID>
                                <wsa:RelatesTo>${probeUuid}</wsa:RelatesTo>
                                <wsa:To SOAP-ENV:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:To>
                                <wsa:Action SOAP-ENV:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</wsa:Action>
                                <d:AppSequence SOAP-ENV:mustUnderstand="true" MessageNumber="${this.discoveryMessageNo}" InstanceId="1234567890"/>
                            </SOAP-ENV:Header>
                            <SOAP-ENV:Body>
                                <d:ProbeMatches>
                                    <d:ProbeMatch>
                                        <wsa:EndpointReference>
                                            <wsa:Address>urn:uuid:${this.config.uuid}</wsa:Address>
                                        </wsa:EndpointReference>
                                        <d:Types>dn:NetworkVideoTransmitter</d:Types>
                                        <d:Scopes>
                                            onvif://www.onvif.org/type/video_encoder
                                            onvif://www.onvif.org/type/ptz
                                            onvif://www.onvif.org/hardware/onvif
                                            onvif://www.onvif.org/name/${this.config.name}
                                            onvif://www.onvif.org/location/
                                        </d:Scopes>
                                        <d:XAddrs>http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service</d:XAddrs>
                                        <d:MetadataVersion>1</d:MetadataVersion>
                                    </d:ProbeMatch>
                                </d:ProbeMatches>
                            </SOAP-ENV:Body>
                        </SOAP-ENV:Envelope>`;

                    this.discoveryMessageNo++;
                    let responseBuffer = Buffer.from(response);
                    return dgram.createSocket('udp4').send(responseBuffer, 0, responseBuffer.length, remote.port, remote.address);
                }
            });
        });

        this.discoverySocket.bind(3702, () => {
            return this.discoverySocket.addMembership('239.255.255.250', this.config.hostname);
        });
    }

    getHostname() {
        return this.config.hostname;
    }
};
