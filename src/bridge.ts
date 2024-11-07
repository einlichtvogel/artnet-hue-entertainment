import {v3} from 'node-hue-api';
import {Api} from 'node-hue-api/dist/esm/api/Api';
 import {ChannelModeType} from './const';
import {ColorUpdate, HueDtlsController} from './hue-dtls';
import {ArtNetController} from 'artnet-protocol/dist';
import {ArtDmx} from 'artnet-protocol/dist/protocol';
import {DmxLight, LIGHT_MODES} from "./DmxLight";

export interface LightConfiguration {
    dmxStart: number;
    lightId: string;
    channelMode: ChannelModeType;
}

export interface Configuration {
    hueHost: string;
    hueUsername: string;
    hueClientKey: string;
    entertainmentRoomId: number;
    artNetBindIp: string;
    artNetUniverse: number;
    lights: LightConfiguration[];
}

export class ArtNetHueBridge {

    private readonly configuration: Configuration;

    private hueApi: Api | null = null;
    private lights: DmxLight[] | null = null;
    private artNetController: ArtNetController | null = null;
    private dtlsController: HueDtlsController | null = null;

    constructor(configuration: Configuration) {
        this.configuration = configuration;
    }

    async start() {
        this.hueApi = await v3.api.createLocal(this.configuration.hueHost)
            .connect(this.configuration.hueUsername);

        const entertainment = await this.hueApi.groups.getEntertainment();
        const rooms = entertainment.filter(ent => ent.id === this.configuration.entertainmentRoomId);
        if (rooms.length !== 1) {
            throw new Error(`Entertainment room with id ${this.configuration.entertainmentRoomId} was not found`);
        }

        const room = rooms[0];
        let roomLightIds = room.lights;
        const lightConfigById: { [lightId: string]: LightConfiguration } = {};
        const lights: DmxLight[] = [];
        this.configuration.lights.forEach(light => {
            const idx = roomLightIds.indexOf(light.lightId);
            if (idx !== -1) {
                roomLightIds.splice(idx, 1);
            }
            lightConfigById[light.lightId] = light;

            lights.push(new LIGHT_MODES[light.channelMode](light.dmxStart, parseInt(light.lightId, 10)));
        });
        if (roomLightIds.length !== 0) {
            throw new Error(`Not all lights in the Entertainment room have been configured: ${roomLightIds}`);
        }
        // TODO: Detect (and warn) overlapping DMX channels

        this.lights = lights;

        this.dtlsController = new HueDtlsController(
            this.configuration.hueHost,
            this.configuration.hueUsername,
            this.configuration.hueClientKey,
        );
        this.artNetController = new ArtNetController();
        this.artNetController.nameLong = 'ArtNet Hue';
        this.artNetController.nameShort = 'ArtNet Hue';
        this.artNetController.bind(this.configuration.artNetBindIp);
        this.artNetController.on('dmx', this.onDmxData.bind(this));

        console.log('Requesting streaming mode...');
        const streamingResponse = await this.hueApi.groups.enableStreaming(this.configuration.entertainmentRoomId);
        console.log('Streaming enabled:', streamingResponse);

        console.log('Sleeping for 1s to give the Hue bridge time to enable streaming mode');

        // Short delay because it can take some time for the Hue bridge to start
        // listening on the DTLS port.
        await new Promise((resolve) => setTimeout(resolve, 1000));

        console.log('Performing streaming mode handshake...');
        await this.dtlsController.connect();
        this.dtlsController.on('connected', this.onDtlsConnected.bind(this));

        const shutdownHandler = () => {
            process.off('SIGINT', shutdownHandler);
            console.log('Received shutdown signal. Closing Hue connection...');
            this.close().then(() => process.exit(0));
        };
        process.on('SIGINT', shutdownHandler);
    }

    public async close() {
        await Promise.all([this.dtlsController!.close(), this.artNetController!.close()]);
        if (this.hueApi) {
            await this.hueApi.groups.disableStreaming(this.configuration.entertainmentRoomId);
        }
    }

    private executeColorUpdate(dmx: ArtDmx) {
        const colorUpdates: ColorUpdate[] = [];
        this.lights!.forEach(light => {
            const dmxData = dmx.data.slice(light.dmxStart - 1, (light.dmxStart - 1) + light.channelWidth);
            const colors = light.getColorValue(dmxData);
            // console.log(`Light ${light.lightId} set to ${colors}`);
            colorUpdates.push({lightId: light.lightId, color: colors});
        });

        this.dtlsController?.sendUpdate(colorUpdates);
    }

    private onDmxData(dmx: ArtDmx) {
        if (dmx.universe == this.configuration.artNetUniverse) {
            this.executeColorUpdate(dmx);
        }
    }

    private onDtlsConnected() {
        console.log("Connected to Hue Entertainment API - Pinging all lights");

        const colorUpdates: ColorUpdate[] = [];
        this.lights!.forEach(light => {
            colorUpdates.push({lightId: light.lightId, color: [0, 0, 0]});
        });

        this.dtlsController?.sendUpdate(colorUpdates);
    }
}
