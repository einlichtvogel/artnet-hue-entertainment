import {chmod, mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {
    AppConfiguration,
    CHANNEL_MODES,
    ChannelMapping,
    ChannelMode,
    LegacyLightMapping,
} from './types';
import {channelWidth} from './dmx';

export const DEFAULT_CONFIG_PATH = 'config.json';
export const DEFAULT_CONFIGURATION: AppConfiguration = {
    artnet: {host: '127.0.0.1', universe: 11},
    hue: {},
};

export async function loadConfiguration(path = DEFAULT_CONFIG_PATH): Promise<AppConfiguration> {
    let contents: string;
    try {
        contents = await readFile(path, 'utf8');
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return structuredClone(DEFAULT_CONFIGURATION);
        }
        throw error;
    }

    let raw: unknown;
    try {
        raw = JSON.parse(contents);
    } catch (error) {
        throw new Error(`Cannot parse configuration ${path}: ${errorMessage(error)}`);
    }
    return parseConfiguration(raw);
}

export async function saveConfiguration(
    configuration: AppConfiguration,
    path = DEFAULT_CONFIG_PATH,
): Promise<void> {
    validateBaseConfiguration(configuration);
    const directory = dirname(path);
    await mkdir(directory, {recursive: true});
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(configuration, null, 2)}\n`, {mode: 0o600});
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
}

export function parseConfiguration(raw: unknown): AppConfiguration {
    if (!isRecord(raw)) {
        throw new Error('Configuration must be a JSON object');
    }
    const artnet = isRecord(raw.artnet) ? raw.artnet : {};
    const hue = isRecord(raw.hue) ? raw.hue : {};
    const configuration: AppConfiguration = {
        artnet: {
            host: optionalString(artnet.host) ?? DEFAULT_CONFIGURATION.artnet.host,
            universe: optionalNumber(artnet.universe) ?? DEFAULT_CONFIGURATION.artnet.universe,
        },
        hue: {
            host: optionalString(hue.host),
            username: optionalString(hue.username),
            clientKey: optionalString(hue.clientKey),
            entertainmentConfigurationId: optionalString(hue.entertainmentConfigurationId),
            channels: hue.channels === undefined ? undefined : parseChannelMappings(hue.channels),
            lights: hue.lights === undefined ? undefined : parseLegacyMappings(hue.lights),
        },
    };
    validateBaseConfiguration(configuration);
    return configuration;
}

export function validateRunConfiguration(configuration: AppConfiguration): void {
    validateBaseConfiguration(configuration);
    const {host, username, clientKey} = configuration.hue;
    if (!host || !username || !clientKey) {
        throw new Error('Hue bridge credentials are missing. Run the pair command first.');
    }
    const mappings = configuration.hue.channels ?? configuration.hue.lights;
    if (!mappings || mappings.length === 0) {
        throw new Error('No Hue light mappings are configured. Run auto-setup first.');
    }
    validateDmxRanges(mappings);
}

export function validateChannelMappings(mappings: readonly ChannelMapping[]): void {
    validateDmxRanges(mappings);
    const ids = new Set<number>();
    for (const mapping of mappings) {
        if (!Number.isInteger(mapping.channelId) || mapping.channelId < 0 || mapping.channelId > 255) {
            throw new Error(`Hue channel ID ${mapping.channelId} must be an integer between 0 and 255`);
        }
        if (ids.has(mapping.channelId)) {
            throw new Error(`Hue channel ${mapping.channelId} is configured more than once`);
        }
        ids.add(mapping.channelId);
    }
}

function validateBaseConfiguration(configuration: AppConfiguration): void {
    if (!configuration.artnet.host) {
        throw new Error('artnet.host must not be empty');
    }
    if (!Number.isInteger(configuration.artnet.universe)
        || configuration.artnet.universe < 0
        || configuration.artnet.universe > 32767) {
        throw new Error('artnet.universe must be an integer between 0 and 32767');
    }
    if (configuration.hue.channels && configuration.hue.lights) {
        throw new Error('Configure either hue.lights or hue.channels, not both');
    }
    if (configuration.hue.channels) {
        validateChannelMappings(configuration.hue.channels);
    }
    if (configuration.hue.lights) {
        validateDmxRanges(configuration.hue.lights);
        const ids = new Set<string>();
        for (const light of configuration.hue.lights) {
            if (!/^\d+$/.test(light.lightId)) {
                throw new Error(`Legacy light ID ${light.lightId} must be numeric`);
            }
            if (ids.has(light.lightId)) {
                throw new Error(`Legacy light ${light.lightId} is configured more than once`);
            }
            ids.add(light.lightId);
        }
    }
}

function validateDmxRanges(mappings: ReadonlyArray<{dmxStart: number; channelMode: ChannelMode}>): void {
    const occupied = new Map<number, {index: number; dmxStart: number; channelMode: ChannelMode}>();
    mappings.forEach((mapping, mappingIndex) => {
        if (!Number.isInteger(mapping.dmxStart) || mapping.dmxStart < 1) {
            throw new Error(`DMX start ${mapping.dmxStart} must be a positive integer`);
        }
        const end = mapping.dmxStart + channelWidth(mapping.channelMode) - 1;
        if (end > 512) {
            throw new Error(`DMX mapping starting at ${mapping.dmxStart} exceeds channel 512`);
        }
        for (let channel = mapping.dmxStart; channel <= end; channel += 1) {
            const previous = occupied.get(channel);
            if (previous !== undefined
                && (previous.dmxStart !== mapping.dmxStart || previous.channelMode !== mapping.channelMode)) {
                throw new Error(`DMX channel ${channel} overlaps mappings ${previous.index + 1} and ${mappingIndex + 1}`);
            }
            occupied.set(channel, {index: mappingIndex, dmxStart: mapping.dmxStart, channelMode: mapping.channelMode});
        }
    });
}

function parseChannelMappings(value: unknown): ChannelMapping[] {
    if (!Array.isArray(value)) {
        throw new Error('hue.channels must be an array');
    }
    return value.map((entry, index) => {
        if (!isRecord(entry)) {
            throw new Error(`hue.channels[${index}] must be an object`);
        }
        return {
            channelId: requiredNumber(entry.channelId, `hue.channels[${index}].channelId`),
            dmxStart: requiredNumber(entry.dmxStart, `hue.channels[${index}].dmxStart`),
            channelMode: requiredMode(entry.channelMode, `hue.channels[${index}].channelMode`),
        };
    });
}

function parseLegacyMappings(value: unknown): LegacyLightMapping[] {
    if (!Array.isArray(value)) {
        throw new Error('hue.lights must be an array');
    }
    return value.map((entry, index) => {
        if (!isRecord(entry)) {
            throw new Error(`hue.lights[${index}] must be an object`);
        }
        const lightId = entry.lightId;
        if (typeof lightId !== 'string' && typeof lightId !== 'number') {
            throw new Error(`hue.lights[${index}].lightId must be a string or number`);
        }
        return {
            lightId: String(lightId),
            dmxStart: requiredNumber(entry.dmxStart, `hue.lights[${index}].dmxStart`),
            channelMode: requiredMode(entry.channelMode, `hue.lights[${index}].channelMode`),
        };
    });
}

function requiredMode(value: unknown, name: string): ChannelMode {
    if (typeof value !== 'string' || !CHANNEL_MODES.includes(value as ChannelMode)) {
        throw new Error(`${name} must be one of ${CHANNEL_MODES.join(', ')}`);
    }
    return value as ChannelMode;
}

function requiredNumber(value: unknown, name: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${name} must be a number`);
    }
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
