export const CHANNEL_MODES = ['8bit', '8bit-dimmable', '16bit', '16bit-dimmable'] as const;

export type ChannelMode = typeof CHANNEL_MODES[number];
export type Rgb16 = [number, number, number];

export interface ChannelMapping {
    channelId: number;
    dmxStart: number;
    channelMode: ChannelMode;
}

export interface LegacyLightMapping {
    lightId: string;
    dmxStart: number;
    channelMode: ChannelMode;
}

export interface ArtNetConfiguration {
    host: string;
    universe: number;
}

export interface HueConfiguration {
    host?: string;
    username?: string;
    clientKey?: string;
    entertainmentConfigurationId?: string;
    channels?: ChannelMapping[];
    lights?: LegacyLightMapping[];
}

export interface AppConfiguration {
    artnet: ArtNetConfiguration;
    hue: HueConfiguration;
}

export interface HueResourceReference {
    rid: string;
    rtype: string;
}

export interface EntertainmentChannel {
    channel_id: number;
    members: Array<{
        service: HueResourceReference;
        index?: number;
    }>;
    position?: {x: number; y: number; z: number};
}

export interface EntertainmentConfiguration {
    id: string;
    id_v1?: string;
    metadata?: {name?: string};
    channels: EntertainmentChannel[];
}

export interface EntertainmentService {
    id: string;
    id_v1?: string;
    owner?: HueResourceReference;
}

export interface LightResource {
    id: string;
    id_v1?: string;
    owner?: HueResourceReference;
    metadata?: {name?: string};
}

export interface DeviceResource {
    id: string;
    metadata?: {name?: string; archetype?: string};
}
