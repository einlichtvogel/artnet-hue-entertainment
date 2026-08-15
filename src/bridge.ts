import {EventEmitter} from 'node:events';
import {ArtNetController} from 'artnet-protocol/dist';
import {ArtDmx} from 'artnet-protocol/dist/protocol';
import {decodeColor, channelWidth} from './dmx';
import {WildcardArtNetReceiver} from './artnet-wildcard';
import {HueApiClient} from './hue-api';
import {ColorUpdate, HueStreamController} from './hue-stream';
import {ChannelMapping} from './types';

export interface BridgeConfiguration {
    hueHost: string;
    hueUsername: string;
    hueClientKey: string;
    entertainmentConfigurationId: string;
    artNetBindIp: string;
    artNetUniverse: number;
    channels: ChannelMapping[];
}

export interface HueAreaApi {
    setEntertainmentState(id: string, action: 'start' | 'stop'): Promise<void>;
}

export interface HueStream {
    connect(): Promise<void>;
    sendUpdates(updates: readonly ColorUpdate[]): void;
    close(): Promise<void>;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'close', listener: () => void): this;
}

export interface ArtNetReceiver {
    nameLong: string;
    nameShort: string;
    bind(host?: string): void;
    close(): Promise<void>;
    on(event: 'dmx', listener: (dmx: ArtDmx) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    off(event: 'dmx', listener: (dmx: ArtDmx) => void): this;
    off(event: 'error', listener: (error: Error) => void): this;
}

export interface BridgeDependencies {
    hueApi?: HueAreaApi;
    stream?: HueStream;
    artNet?: ArtNetReceiver;
    now?: () => number;
    logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export class ArtNetHueBridge extends EventEmitter {
    private readonly configuration: BridgeConfiguration;
    private readonly hueApi: HueAreaApi;
    private readonly stream: HueStream;
    private readonly artNet: ArtNetReceiver;
    private readonly now: () => number;
    private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
    private areaStarted = false;
    private artNetBound = false;
    private closePromise: Promise<void> | null = null;
    private lastShortFrameWarningAt = -Infinity;

    constructor(configuration: BridgeConfiguration, dependencies: BridgeDependencies = {}) {
        super();
        this.configuration = configuration;
        this.hueApi = dependencies.hueApi
            ?? new HueApiClient(configuration.hueHost, configuration.hueUsername);
        this.stream = dependencies.stream
            ?? new HueStreamController(
                configuration.hueHost,
                configuration.hueUsername,
                configuration.hueClientKey,
                configuration.entertainmentConfigurationId,
            );
        this.now = dependencies.now ?? Date.now;
        this.logger = dependencies.logger ?? console;
        this.artNet = dependencies.artNet ?? (
            configuration.artNetBindIp === '0.0.0.0' || configuration.artNetBindIp === '::'
                ? new WildcardArtNetReceiver(undefined, this.logger)
                : new ArtNetController()
        );
        this.onDmxData = this.onDmxData.bind(this);
    }

    async start(): Promise<void> {
        this.stream.on('error', error => this.handleRuntimeFailure(error));
        this.stream.on('close', () => this.handleRuntimeFailure(new Error('Hue DTLS stream closed unexpectedly')));
        try {
            this.logger.log('Requesting Hue Entertainment v2 streaming mode...');
            await this.hueApi.setEntertainmentState(this.configuration.entertainmentConfigurationId, 'start');
            this.areaStarted = true;

            this.logger.log('Performing Hue Entertainment DTLS handshake...');
            await this.stream.connect();

            this.artNet.nameLong = 'ArtNet Hue Entertainment';
            this.artNet.nameShort = 'ArtNet Hue';
            this.artNet.on('dmx', this.onDmxData);
            this.artNet.on('error', this.onArtNetError);
            this.artNet.bind(this.configuration.artNetBindIp);
            this.artNetBound = true;

            this.stream.sendUpdates(this.configuration.channels.map(mapping => ({
                channelId: mapping.channelId,
                color: [0, 0, 0],
            })));
            this.logger.log('Art-Net to Hue Entertainment v2 bridge is running.');
        } catch (error) {
            await this.close().catch(closeError => {
                this.logger.error('Cleanup after startup failure also failed:', closeError);
            });
            throw error;
        }
    }

    close(): Promise<void> {
        if (this.closePromise) {
            return this.closePromise;
        }
        this.closePromise = this.closeResources();
        return this.closePromise;
    }

    private async closeResources(): Promise<void> {
        const errors: Error[] = [];
        this.artNet.off('dmx', this.onDmxData);
        this.artNet.off('error', this.onArtNetError);
        await this.stream.close().catch(error => errors.push(asError(error)));
        if (this.artNetBound) {
            await this.artNet.close().catch(error => errors.push(asError(error)));
            this.artNetBound = false;
        }
        if (this.areaStarted) {
            await this.hueApi
                .setEntertainmentState(this.configuration.entertainmentConfigurationId, 'stop')
                .catch(error => errors.push(asError(error)));
            this.areaStarted = false;
        }
        this.emit('closed');
        if (errors.length > 0) {
            throw new AggregateError(errors, 'One or more bridge resources could not be closed');
        }
    }

    private onDmxData(dmx: ArtDmx): void {
        if (dmx.universe !== this.configuration.artNetUniverse) {
            return;
        }
        const requiredLength = Math.max(...this.configuration.channels.map(mapping => (
            mapping.dmxStart - 1 + channelWidth(mapping.channelMode)
        )));
        if (dmx.data.length < requiredLength) {
            if (this.now() - this.lastShortFrameWarningAt >= 5000) {
                this.logger.warn(`Ignoring short ArtDMX frame: received ${dmx.data.length} channels, need ${requiredLength}`);
                this.lastShortFrameWarningAt = this.now();
            }
            return;
        }
        const updates = this.configuration.channels.map(mapping => {
            const start = mapping.dmxStart - 1;
            const width = channelWidth(mapping.channelMode);
            return {
                channelId: mapping.channelId,
                color: decodeColor(mapping.channelMode, dmx.data.slice(start, start + width)),
            };
        });
        this.stream.sendUpdates(updates);
    }

    private handleRuntimeFailure(error: Error): void {
        if (this.closePromise) {
            return;
        }
        this.close()
            .catch(closeError => this.logger.error('Cleanup after runtime failure failed:', closeError))
            .finally(() => this.emit('error', error));
    }

    private readonly onArtNetError = (error: Error): void => {
        this.handleRuntimeFailure(error);
    };
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
