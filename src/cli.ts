#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {ArtNetHueBridge} from './bridge';
import {channelWidth} from './dmx';
import {
    DEFAULT_CONFIG_PATH,
    loadConfiguration,
    saveConfiguration,
    validateChannelMappings,
    validateRunConfiguration,
} from './config';
import {
    createLightAutoSetupMappings,
    findLightByIdentifier,
    HueApiClient,
    resolveLegacyMappings,
    selectEntertainmentConfiguration,
} from './hue-api';
import {
    AppConfiguration,
    CHANNEL_MODES,
    ChannelMapping,
    ChannelMode,
    DeviceResource,
    EntertainmentConfiguration,
    EntertainmentService,
    LightResource,
} from './types';

interface ParsedCli {
    command?: string;
    configPath: string;
    ip?: string;
    id?: string;
    mode?: ChannelMode;
    overwrite: boolean;
    help: boolean;
}

type CommandHandler = (parsed: ParsedCli) => Promise<number>;

const commandHandlers: Record<string, CommandHandler> = {
    discover: discoverBridges,
    pair: pairBridge,
    run: runBridge,
    'list-areas': listAreas,
    'list-rooms': listAreas,
    'list-channels': listChannels,
    'list-lights': listLights,
    'ping-light': pingLight,
    'ping-lights': parsed => pingLight({...parsed, id: 'all'}),
    'rename-lights-after-id': renameLightsAfterId,
    'auto-setup': autoSetup,
};

export async function main(argv: string[]): Promise<number> {
    let parsed: ParsedCli;
    try {
        parsed = parseCli(argv);
    } catch (error) {
        console.error(errorMessage(error));
        printHelp();
        return 1;
    }
    if (parsed.help || !parsed.command) {
        printHelp();
        return 0;
    }
    const handler = commandHandlers[parsed.command];
    if (!handler) {
        console.error(`Unknown command: ${parsed.command}`);
        printHelp();
        return 1;
    }
    try {
        return await handler(parsed);
    } catch (error) {
        console.error(errorMessage(error));
        return 1;
    }
}

export function parseCli(argv: string[]): ParsedCli {
    const result = parseArgs({
        args: argv,
        allowPositionals: true,
        strict: true,
        options: {
            config: {type: 'string'},
            ip: {type: 'string'},
            id: {type: 'string'},
            mode: {type: 'string'},
            overwrite: {type: 'boolean'},
            help: {type: 'boolean', short: 'h'},
        },
    });
    if (result.positionals.length > 1) {
        throw new Error(`Unexpected arguments: ${result.positionals.slice(1).join(' ')}`);
    }
    const mode = result.values.mode;
    if (mode !== undefined && !CHANNEL_MODES.includes(mode as ChannelMode)) {
        throw new Error(`--mode must be one of ${CHANNEL_MODES.join(', ')}`);
    }
    return {
        command: result.positionals[0],
        configPath: result.values.config ?? DEFAULT_CONFIG_PATH,
        ip: result.values.ip,
        id: result.values.id,
        mode: mode as ChannelMode | undefined,
        overwrite: result.values.overwrite ?? false,
        help: result.values.help ?? false,
    };
}

async function discoverBridges(): Promise<number> {
    console.log('Discovering bridges...');
    const bridges = await HueApiClient.discover();
    if (bridges.length === 0) {
        console.log('No bridges found. You can still pair directly with --ip.');
        return 0;
    }
    bridges.forEach(bridge => console.log(` - ${bridge.internalipaddress} (${bridge.id})`));
    return 0;
}

async function pairBridge(parsed: ParsedCli): Promise<number> {
    if (!parsed.ip) {
        throw new Error('pair requires --ip <bridge address>');
    }
    const configuration = await loadConfiguration(parsed.configPath);
    console.log('Press the Hue bridge link button, then pairing will be attempted.');
    const credentials = await new HueApiClient(parsed.ip).pair();
    configuration.hue.host = parsed.ip;
    configuration.hue.username = credentials.username;
    configuration.hue.clientKey = credentials.clientKey;
    await saveConfiguration(configuration, parsed.configPath);
    console.log(`Hue pairing succeeded. Credentials were saved to ${parsed.configPath}.`);
    console.log('Run auto-setup next to create DMX light mappings.');
    return 0;
}

async function runBridge(parsed: ParsedCli): Promise<number> {
    const configuration = await loadConfiguration(parsed.configPath);
    validateRunConfiguration(configuration);
    const {area, mappings, api} = await prepareRuntime(configuration);
    const hue = configuration.hue;
    const bridge = new ArtNetHueBridge({
        hueHost: hue.host!,
        hueUsername: hue.username!,
        hueClientKey: hue.clientKey!,
        entertainmentConfigurationId: area.id,
        artNetBindIp: configuration.artnet.host,
        artNetUniverse: configuration.artnet.universe,
        channels: mappings,
    }, {hueApi: api});

    let signalHandler: (() => void) | undefined;
    const result = new Promise<number>((resolve, reject) => {
        let shuttingDown = false;
        signalHandler = () => {
            if (shuttingDown) {
                return;
            }
            shuttingDown = true;
            console.log('Closing Art-Net and Hue connections...');
            bridge.close().then(() => resolve(0), reject);
        };
        process.once('SIGINT', signalHandler);
        process.once('SIGTERM', signalHandler);
        bridge.once('error', reject);
    });
    try {
        await bridge.start();
        return await result;
    } finally {
        if (signalHandler) {
            process.off('SIGINT', signalHandler);
            process.off('SIGTERM', signalHandler);
        }
        await bridge.close().catch(() => undefined);
    }
}

async function listAreas(parsed: ParsedCli): Promise<number> {
    const {api} = await getPairedConfiguration(parsed.configPath);
    const areas = await api.getEntertainmentConfigurations();
    console.log('Available entertainment areas:');
    areas.forEach(area => {
        console.log(` - ${area.metadata?.name ?? 'Unnamed'}: ${area.id} (${area.id_v1 ?? 'no legacy ID'}, ${area.channels.length} channels)`);
    });
    return 0;
}

async function listChannels(parsed: ParsedCli): Promise<number> {
    const {configuration, api} = await getPairedConfiguration(parsed.configPath);
    const area = selectEntertainmentConfiguration(
        await api.getEntertainmentConfigurations(),
        configuration.hue.entertainmentConfigurationId,
    );
    const [services, devices] = await Promise.all([api.getEntertainmentServices(), api.getDevices()]);
    const names = deviceNameMap(devices);
    const serviceLabels = new Map(services.map(service => {
        const name = names.get(service.owner?.rid ?? '');
        const identifier = service.id_v1 ?? service.id;
        return [service.id, name ? `${name} (${identifier})` : identifier];
    }));
    console.log(`Entertainment channels for ${area.metadata?.name ?? area.id}:`);
    area.channels
        .slice()
        .sort((a, b) => a.channel_id - b.channel_id)
        .forEach(channel => {
            const members = channel.members.map(member => serviceLabels.get(member.service.rid) ?? member.service.rid);
            console.log(` - Channel ${channel.channel_id}: ${members.join(', ')}`);
        });
    return 0;
}

async function listLights(parsed: ParsedCli): Promise<number> {
    const {api} = await getPairedConfiguration(parsed.configPath);
    const lights = await api.getLights();
    const devices = await api.getDevices();
    const names = deviceNameMap(devices);
    console.log('Available lights:');
    lights.forEach(light => {
        console.log(` - ${light.id_v1 ?? light.id}: ${light.metadata?.name ?? names.get(light.owner?.rid ?? '') ?? 'Unnamed'} (${light.id})`);
    });
    return 0;
}

async function pingLight(parsed: ParsedCli): Promise<number> {
    if (!parsed.id) {
        throw new Error('ping-light requires --id <light ID|UUID>');
    }
    const {api} = await getPairedConfiguration(parsed.configPath);
    const lights = await api.getLights();
    const selected = parsed.id === 'all' ? lights : [findLightByIdentifier(lights, parsed.id)].filter(Boolean) as LightResource[];
    if (selected.length === 0) {
        throw new Error(`Light ${parsed.id} was not found`);
    }
    for (const light of selected) {
        await api.pingLight(light.id);
        console.log(`Pinged ${light.id_v1 ?? light.id}.`);
        if (selected.length > 1) {
            await delay(1500);
        }
    }
    return 0;
}

async function renameLightsAfterId(parsed: ParsedCli): Promise<number> {
    const {api} = await getPairedConfiguration(parsed.configPath);
    const [lights, devices] = await Promise.all([api.getLights(), api.getDevices()]);
    const devicesById = new Map(devices.map(device => [device.id, device]));
    const renamedDevices = new Set<string>();
    for (const light of lights) {
        const numericId = light.id_v1?.match(/^\/lights\/(\d+)$/)?.[1];
        const deviceId = light.owner?.rid;
        if (!numericId || !deviceId || renamedDevices.has(deviceId)) {
            continue;
        }
        const name = `Light ${numericId}`;
        const device = devicesById.get(deviceId);
        if (device?.metadata?.name === name) {
            console.log(`${name} already has the expected name.`);
        } else {
            await api.renameDevice(deviceId, name);
            console.log(`Renamed ${device?.metadata?.name ?? deviceId} to ${name}.`);
        }
        renamedDevices.add(deviceId);
    }
    return 0;
}

async function autoSetup(parsed: ParsedCli): Promise<number> {
    const {configuration, api} = await getPairedConfiguration(parsed.configPath);
    validateAutoSetupOverwrite(configuration, parsed.overwrite);
    const area = selectEntertainmentConfiguration(
        await api.getEntertainmentConfigurations(),
        configuration.hue.entertainmentConfigurationId,
    );
    const services = await api.getEntertainmentServices();
    const mode = parsed.mode ?? '8bit-dimmable';
    const lights = createLightAutoSetupMappings(area, services, mode);
    configuration.hue.entertainmentConfigurationId = area.id;
    configuration.hue.lights = lights;
    delete configuration.hue.channels;
    await saveConfiguration(configuration, parsed.configPath);
    console.log(`Configured ${lights.length} Hue lights for ${area.metadata?.name ?? area.id}:`);
    lights.forEach(light => {
        console.log(` - Light ${light.lightId}: DMX ${light.dmxStart}-${light.dmxStart + channelWidth(light.channelMode) - 1} (${light.channelMode})`);
    });
    return 0;
}

export function validateAutoSetupOverwrite(configuration: AppConfiguration, overwrite: boolean): void {
    const hasExistingMappings = (configuration.hue.lights?.length ?? 0) > 0
        || (configuration.hue.channels?.length ?? 0) > 0;
    if (hasExistingMappings && !overwrite) {
        throw new Error('Hue light mappings already exist. Run auto-setup with --overwrite to replace them.');
    }
}

export async function resolveConfiguredMappings(
    configuration: AppConfiguration,
    area: EntertainmentConfiguration,
    services: readonly EntertainmentService[],
): Promise<ChannelMapping[]> {
    let mappings: ChannelMapping[];
    if (configuration.hue.channels) {
        mappings = configuration.hue.channels;
    } else if (configuration.hue.lights) {
        mappings = resolveLegacyMappings(area, services, configuration.hue.lights);
    } else {
        throw new Error('No Hue mappings are configured');
    }
    validateChannelMappings(mappings);
    const expected = new Set(area.channels.map(channel => channel.channel_id));
    const configured = new Set(mappings.map(mapping => mapping.channelId));
    const missing = [...expected].filter(id => !configured.has(id));
    const extra = [...configured].filter(id => !expected.has(id));
    if (missing.length > 0 || extra.length > 0) {
        throw new Error(`Hue channel mapping does not match the selected area (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
    }
    return mappings;
}

async function prepareRuntime(configuration: AppConfiguration): Promise<{
    area: EntertainmentConfiguration;
    mappings: ChannelMapping[];
    api: HueApiClient;
}> {
    const api = new HueApiClient(configuration.hue.host!, configuration.hue.username!);
    const area = selectEntertainmentConfiguration(
        await api.getEntertainmentConfigurations(),
        configuration.hue.entertainmentConfigurationId,
    );
    const services = configuration.hue.lights ? await api.getEntertainmentServices() : [];
    const mappings = await resolveConfiguredMappings(configuration, area, services);
    return {area, mappings, api};
}

async function getPairedConfiguration(path: string): Promise<{configuration: AppConfiguration; api: HueApiClient}> {
    const configuration = await loadConfiguration(path);
    const {host, username} = configuration.hue;
    if (!host || !username) {
        throw new Error('Hue bridge credentials are missing. Run pair first.');
    }
    return {configuration, api: new HueApiClient(host, username)};
}

function deviceNameMap(devices: readonly DeviceResource[]): Map<string, string> {
    return new Map(devices.map(device => [device.id, device.metadata?.name ?? device.id]));
}

function printHelp(): void {
    console.log(`Usage: artnet-hue-entertainment <command> [options]

Control Philips Hue Entertainment v2 channels with Art-Net DMX.

Commands:
  discover                     Discover bridges using discovery.meethue.com
  pair --ip <address>          Pair after pressing the bridge link button
  list-areas                   List Hue Entertainment areas (alias: list-rooms)
  list-channels                List stream channels in the selected area
  list-lights                  List Hue light resources and legacy IDs
  ping-light --id <id|uuid>    Flash one light; use "all" for every light
  ping-lights                  Flash every light in sequence
  rename-lights-after-id       Rename devices using their legacy light IDs
  auto-setup [options]         Map selected-area lights to consecutive DMX slots
  run                          Start the Art-Net to Hue bridge

Global options:
  --config <path>              Configuration file (default: config.json)
  --mode <mode>                DMX mode for auto-setup (default: 8bit-dimmable)
  --overwrite                  Replace existing light or channel mappings
  -h, --help                   Show this help`);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

if (require.main === module) {
    main(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    }).catch(error => {
        console.error(errorMessage(error));
        process.exitCode = 1;
    });
}
