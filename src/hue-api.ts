import axios, {AxiosError, AxiosInstance} from 'axios';
import {Agent} from 'node:https';
import {connect as connectTls} from 'node:tls';
import {
    ChannelMapping,
    DeviceResource,
    EntertainmentConfiguration,
    EntertainmentService,
    LegacyLightMapping,
    LightResource,
} from './types';

interface HueEnvelope<T> {
    data?: T[];
    errors?: Array<{description?: string}>;
}

interface PairingResponse {
    success?: {username: string; clientkey: string};
    error?: {description?: string; type?: number};
}

interface BridgeConfigResponse {
    bridgeid?: string;
}

export interface DiscoveredBridge {
    id: string;
    internalipaddress: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

export class HueApiClient {
    private readonly host: string;
    private readonly appKey?: string;
    private readonly axiosFactory: typeof axios.create;
    private readonly certificateValidator: (host: string, bridgeId: string) => Promise<void>;
    private client: AxiosInstance | null = null;

    constructor(
        host: string,
        appKey?: string,
        axiosFactory: typeof axios.create = axios.create,
        certificateValidator: (host: string, bridgeId: string) => Promise<void> = validateBridgeCertificate,
    ) {
        this.host = host;
        this.appKey = appKey;
        this.axiosFactory = axiosFactory;
        this.certificateValidator = certificateValidator;
    }

    static async discover(client: AxiosInstance = axios.create({timeout: REQUEST_TIMEOUT_MS})): Promise<DiscoveredBridge[]> {
        try {
            const response = await client.get<DiscoveredBridge[]>('https://discovery.meethue.com/');
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            throw normalizeAxiosError(error, 'Hue bridge discovery failed');
        }
    }

    async pair(deviceType = 'artnet-hue-entertainment#cli'): Promise<{username: string; clientKey: string}> {
        const client = await this.getClient(false);
        try {
            const response = await client.post<PairingResponse[]>('/api', {
                devicetype: deviceType,
                generateclientkey: true,
            });
            const result = response.data[0];
            if (result?.success?.username && result.success.clientkey) {
                return {username: result.success.username, clientKey: result.success.clientkey};
            }
            throw new Error(result?.error?.description ?? 'Unexpected response from Hue bridge');
        } catch (error) {
            if (error instanceof Error && !(error instanceof AxiosError)) {
                throw error;
            }
            throw normalizeAxiosError(error, 'Hue bridge pairing failed');
        }
    }

    async getEntertainmentConfigurations(): Promise<EntertainmentConfiguration[]> {
        return this.getResources<EntertainmentConfiguration>('entertainment_configuration');
    }

    async getEntertainmentServices(): Promise<EntertainmentService[]> {
        return this.getResources<EntertainmentService>('entertainment');
    }

    async getLights(): Promise<LightResource[]> {
        return this.getResources<LightResource>('light');
    }

    async getDevices(): Promise<DeviceResource[]> {
        return this.getResources<DeviceResource>('device');
    }

    async setEntertainmentState(id: string, action: 'start' | 'stop'): Promise<void> {
        await this.request('put', `/clip/v2/resource/entertainment_configuration/${encodeURIComponent(id)}`, {action});
    }

    async pingLight(id: string): Promise<void> {
        await this.request('put', `/clip/v2/resource/light/${encodeURIComponent(id)}`, {
            alert: {action: 'breathe'},
        });
    }

    async renameDevice(id: string, name: string): Promise<void> {
        await this.request('put', `/clip/v2/resource/device/${encodeURIComponent(id)}`, {
            metadata: {name},
        });
    }

    private async getResources<T>(type: string): Promise<T[]> {
        const envelope = await this.request<T>('get', `/clip/v2/resource/${type}`);
        return envelope.data ?? [];
    }

    private async request<T>(method: 'get' | 'put', path: string, body?: unknown): Promise<HueEnvelope<T>> {
        const client = await this.getClient(true);
        try {
            const response = method === 'get'
                ? await client.get<HueEnvelope<T>>(path)
                : await client.put<HueEnvelope<T>>(path, body);
            const errors = response.data.errors ?? [];
            if (errors.length > 0) {
                throw new Error(errors.map(error => error.description ?? 'Unknown Hue error').join('; '));
            }
            return response.data;
        } catch (error) {
            if (error instanceof Error && !(error instanceof AxiosError)) {
                throw error;
            }
            throw normalizeAxiosError(error, `Hue request ${method.toUpperCase()} ${path} failed`);
        }
    }

    private async getClient(authenticated: boolean): Promise<AxiosInstance> {
        if (this.client) {
            return this.client;
        }
        const agent = new Agent({keepAlive: true, rejectUnauthorized: false});
        const bootstrap = this.axiosFactory({
            baseURL: `https://${this.host}`,
            timeout: REQUEST_TIMEOUT_MS,
            httpsAgent: agent,
        });
        let bridgeId: string;
        try {
            const response = await bootstrap.get<BridgeConfigResponse>('/api/config');
            if (!response.data.bridgeid) {
                throw new Error('Bridge did not provide its identifier');
            }
            bridgeId = response.data.bridgeid.toLowerCase();
        } catch (error) {
            throw normalizeAxiosError(error, 'Could not read Hue bridge identity');
        }
        await this.certificateValidator(this.host, bridgeId);
        this.client = this.axiosFactory({
            baseURL: `https://${this.host}`,
            timeout: REQUEST_TIMEOUT_MS,
            httpsAgent: agent,
            headers: authenticated && this.appKey ? {'hue-application-key': this.appKey} : undefined,
        });
        if (authenticated && !this.appKey) {
            throw new Error('Hue application key is required for this command');
        }
        return this.client;
    }
}

export function selectEntertainmentConfiguration(
    configurations: readonly EntertainmentConfiguration[],
    configuredId?: string,
): EntertainmentConfiguration {
    const selected = configuredId
        ? configurations.find(configuration => configuration.id === configuredId)
        : configurations.find(configuration => configuration.id_v1 === '/groups/200');
    if (!selected) {
        const requested = configuredId ? `with ID ${configuredId}` : 'with legacy ID /groups/200';
        throw new Error(`No Hue entertainment configuration ${requested} was found`);
    }
    return selected;
}

export function resolveLegacyMappings(
    area: EntertainmentConfiguration,
    services: readonly EntertainmentService[],
    legacyMappings: readonly LegacyLightMapping[],
): ChannelMapping[] {
    const lightIdByService = new Map<string, string>();
    for (const service of services) {
        const match = service.id_v1?.match(/^\/lights\/(\d+)$/);
        if (match?.[1]) {
            lightIdByService.set(service.id, match[1]);
        }
    }
    const mappingByLight = new Map(legacyMappings.map(mapping => [mapping.lightId, mapping]));
    const resolved: ChannelMapping[] = [];
    for (const channel of area.channels) {
        const lightIds = new Set(
            channel.members
                .map(member => lightIdByService.get(member.service.rid))
                .filter((value): value is string => value !== undefined),
        );
        const matched = [...lightIds].map(id => mappingByLight.get(id)).filter(Boolean) as LegacyLightMapping[];
        if (matched.length === 0) {
            throw new Error(`Hue channel ${channel.channel_id} cannot be mapped to a configured legacy light`);
        }
        const first = matched[0]!;
        if (matched.some(mapping => mapping.dmxStart !== first.dmxStart || mapping.channelMode !== first.channelMode)) {
            throw new Error(`Hue channel ${channel.channel_id} contains legacy lights with conflicting DMX mappings`);
        }
        resolved.push({
            channelId: channel.channel_id,
            dmxStart: first.dmxStart,
            channelMode: first.channelMode,
        });
    }
    const representedLights = new Set(
        area.channels.flatMap(channel => channel.members)
            .map(member => lightIdByService.get(member.service.rid))
            .filter((value): value is string => value !== undefined),
    );
    const missing = legacyMappings.filter(mapping => !representedLights.has(mapping.lightId));
    if (missing.length > 0) {
        throw new Error(`Legacy lights are not members of the selected area: ${missing.map(item => item.lightId).join(', ')}`);
    }
    return resolved;
}

/** Build user-facing lamp mappings from bridge-assigned Entertainment channels. */
export function createLightAutoSetupMappings(
    area: EntertainmentConfiguration,
    services: readonly EntertainmentService[],
): LegacyLightMapping[] {
    const lightIdByService = new Map<string, string>();
    for (const service of services) {
        const lightId = service.id_v1?.match(/^\/lights\/(\d+)$/)?.[1];
        if (lightId) {
            lightIdByService.set(service.id, lightId);
        }
    }

    const parent = new Map<string, string>();
    const orderedLightIds: string[] = [];
    const add = (lightId: string) => {
        if (!parent.has(lightId)) {
            parent.set(lightId, lightId);
            orderedLightIds.push(lightId);
        }
    };
    const find = (lightId: string): string => {
        const currentParent = parent.get(lightId)!;
        if (currentParent === lightId) {
            return lightId;
        }
        const root = find(currentParent);
        parent.set(lightId, root);
        return root;
    };
    const union = (first: string, second: string) => {
        const firstRoot = find(first);
        const secondRoot = find(second);
        if (firstRoot !== secondRoot) {
            parent.set(secondRoot, firstRoot);
        }
    };

    for (const channel of [...area.channels].sort((a, b) => a.channel_id - b.channel_id)) {
        const lightIds = [...new Set(channel.members.map(member => lightIdByService.get(member.service.rid)).filter(
            (value): value is string => value !== undefined,
        ))];
        if (lightIds.length === 0) {
            throw new Error(
                `Hue channel ${channel.channel_id} has no legacy light ID; use an explicit hue.channels mapping for this area`,
            );
        }
        lightIds.forEach(add);
        lightIds.slice(1).forEach(lightId => union(lightIds[0]!, lightId));
    }

    const dmxStartByRoot = new Map<string, number>();
    for (const lightId of orderedLightIds) {
        const root = find(lightId);
        if (!dmxStartByRoot.has(root)) {
            dmxStartByRoot.set(root, dmxStartByRoot.size * 4 + 1);
        }
    }
    return orderedLightIds.map(lightId => ({
        lightId,
        dmxStart: dmxStartByRoot.get(find(lightId))!,
        channelMode: '8bit-dimmable',
    }));
}

export function findLightByIdentifier(lights: readonly LightResource[], identifier: string): LightResource | undefined {
    return lights.find(light => light.id === identifier || light.id_v1 === `/lights/${identifier}`);
}

async function validateBridgeCertificate(host: string, expectedBridgeId: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const socket = connectTls({host, port: 443, rejectUnauthorized: false, servername: undefined}, () => {
            const certificate = socket.getPeerCertificate();
            const subjectCommonName = certificate.subject?.CN;
            const commonName = typeof subjectCommonName === 'string' ? subjectCommonName.toLowerCase() : undefined;
            socket.end();
            if (!commonName || commonName !== expectedBridgeId) {
                reject(new Error(`Hue bridge certificate identity mismatch (expected ${expectedBridgeId})`));
                return;
            }
            resolve();
        });
        socket.setTimeout(REQUEST_TIMEOUT_MS, () => {
            socket.destroy();
            reject(new Error('Timed out while validating the Hue bridge certificate'));
        });
        socket.once('error', reject);
    });
}

function normalizeAxiosError(error: unknown, context: string): Error {
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        const detail = typeof responseData === 'string'
            ? responseData
            : error.message;
        return new Error(`${context}: ${detail}`);
    }
    return error instanceof Error ? new Error(`${context}: ${error.message}`) : new Error(`${context}: ${String(error)}`);
}
