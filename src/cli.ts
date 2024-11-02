#!/usr/bin/env node
import * as minimist from 'minimist';
import {v3, discovery, ApiError} from 'node-hue-api';
import {ArtNetHueBridge, LightConfiguration} from './bridge';
import * as nconf from 'nconf';
import {stat, open} from 'fs/promises';
const LightState = v3.lightStates.LightState;

const CONFIG_FILE_PATH = 'config.json';

class ArtNetHueEntertainmentCliHandler {

    private config: nconf.Provider;
    private readonly args: string[];

    constructor(args: string[]) {
        this.config = nconf.argv().env();
        this.args = args;
    }

    async run() {
        await this.checkOrCreateConfigFile();
        // TODO: Handle config parsing errors
        this.config = this.config.file(CONFIG_FILE_PATH);

        if (this.args.length === 0) {
            this.printHelp();
            return;
        }

        if (this.args[0] === 'discover') {
            await this.discoverBridges();
        } else if (this.args[0] === 'pair') {
            await this.runPair(this.args.slice(1));
        } else if (this.args[0] === 'run') {
            await this.startProcess();
        } else if (this.args[0] === 'list-rooms') {
            await this.listEntertainmentRooms();
        } else if (this.args[0] === 'ping-light') {
            await this.pingLight(this.args.slice(1));
        } else if (this.args[0] === 'list-lights') {
            await this.listAllLights();
        } else if(this.args[0] === 'rename-lights-after-id' ){
            await this.renameLightsAfterID();
        } else {
            this.printHelp();
            return;
        }
    }

    printHelp() {
        console.log('Usage: artnet-hue-entertainment <discover|pair|config-path|run> [options]');
        console.log('');
        console.log('Control Philips/Signify Hue lights using ArtNet.');
        console.log('');
        console.log('Subcommands:');
        console.log('  discover                Discover all Hue bridges on your network. When you know the IP address of the bridge, run \'pair\' directly.');
        console.log('  pair                    Pair with a Hue bridge. Press the link button on the bridge before running');
        console.log('    --ip                  The IP address of the Hue bridge. Both IPv4 and IPv6 are supported.');
        console.log('  ping-light              Indicated a light.');
        console.log('    --id                  The id of the light to indicate. If the is "all" then all lights will be indicated.');
        console.log('  list-rooms              List all available entertainment rooms.');
        console.log('  list-lights             List all available lights.');
        console.log('  rename-lights-after-id  Renames every light after it`s id.');
        console.log('  run                     Run the ArtNet to Hue bridge.');
        process.exit(1);
    }

    async runPair(argv: string[]) {
        const args = minimist(argv, {
            string: ['ip'],
        });

        if (!('ip' in args) || args.ip.length === 0) {
            this.printHelp();
            process.exit(1);
            return;
        }

        try {
            const host: string = args.ip;
            const api = await v3.api.createLocal(host).connect();
            const user = await api.users.createUser('artnet-hue-entertainment', 'cli');

            this.config.set('hue:host', host);
            this.config.set('hue:username', user.username);
            this.config.set('hue:clientKey', user.clientkey);
            this.config.set('hue:lights', [
                {
                    lightId: '1',
                    dmxStart: 1,
                    channelMode: '8bit-dimmable',
                },
                {
                    lightId: '2',
                    dmxStart: 5,
                    channelMode: '8bit-dimmable',
                }
            ]);
            this.config.save(null);

            console.log('Hue setup was successful! Credentials are saved. You can run the server now.')

        } catch (e) {
            const error = e as ApiError;
            let hue_error = error.getHueError();
            if (hue_error !== undefined) {
                console.error('Error while pairing:', hue_error.message);
                process.exit(1);
            }
            throw e;
        }
    }

    async discoverBridges() {
        console.log('Discovering bridges...');
        discovery.nupnpSearch().then(results => {
            if (results.length === 0) {
                console.log('No bridges found.');
                return;
            }
            console.log('Found bridges:');
            results.forEach(bridge => {
                console.log(` - ${bridge.ipaddress}: ${bridge.config?.name}`);
            });
            console.log('');
            console.log('To use any of these bridges, press the link button on the bridge and run:');
            console.log('$ artnet-hue-entertainment pair --ip <ip address>');
        });
    }

    async startProcess() {
        // TODO: Detect when setup has not yet been run
        const host = this.config.get('hue:host') as string;
        const username = this.config.get('hue:username') as string;
        const clientKey = this.config.get('hue:clientKey') as string;
        const lights = this.config.get('hue:lights') as LightConfiguration[];
        if (host === undefined || username === undefined || clientKey === undefined) {
            console.log('No Hue bridge is paired yet. Please pair a bridge first');
            return;
        }

        if(lights.some(light => light.channelMode === undefined || (light.channelMode !== "8bit" && light.channelMode !== "8bit-dimmable" && light.channelMode !== "16bit"))) {
            const light = lights.find(light => light.channelMode === undefined || (light.channelMode !== "8bit" && light.channelMode !== "8bit-dimmable" && light.channelMode !== "16bit"));
            console.error('Invalid channel mode in light configuration (lightId ' + light!.lightId + '). Valid values are: 8bit, 8bit-dimmable, 16bit');
            process.exit(1);
        }

        const bridge = new ArtNetHueBridge({
            hueHost: host,
            hueUsername: username,
            hueClientKey: clientKey,
            entertainmentRoomId: 200,
            artNetBindIp: this.config.get("artnet:host"),
            artNetUniverse: this.config.get("artnet:universe"),
            lights: lights,
        });
        await bridge.start();
    }

    async listEntertainmentRooms() {
        const hueApi = await v3.api.createLocal(this.config.get("hue:host"))
          .connect(this.config.get("hue:username"));

        const rooms = await hueApi.groups.getEntertainment();
        const roomsCleaned = rooms.map(r => {
            return " - Room " + r.id + ": " + r.name + " (Lights: " + r.lights.join(", ") + ")";
        })
        console.log('Available entertainment rooms:');
        console.log(roomsCleaned.join(", "));
    }

    async listAllLights() {
        const hueApi = await v3.api.createLocal(this.config.get("hue:host"))
          .connect(this.config.get("hue:username"));

        const rooms = await hueApi.lights.getAll();
        const lightsCleaned = rooms.map(r => {
            return " - Light " + r.id + ": " + r.name
        })
        console.log('Available lights:');
        lightsCleaned.forEach(light => {
            console.log(light);
        })
    }

    async renameLightsAfterID() {
        const hueApi = await v3.api.createLocal(this.config.get("hue:host"))
          .connect(this.config.get("hue:username"));

        const allLights = await hueApi.lights.getAll();
        for (const lightType of allLights) {
            const newName = `Light ${lightType.id}`;

            if(lightType.name == newName){
                console.log(`Light ${lightType.id} already has the correct name.`);
                continue;
            }
            console.log(`Renaming light ${lightType.name} to Light ${lightType.id}`);
            lightType.name = "Light " + lightType.id;
            await hueApi.lights.renameLight(lightType as unknown as any);
        }
    }

    async pingLight(argv: string[]) {
        const args = minimist(argv, {
            string: ['id'],
        });

        if (!('id' in args) || args.id.length === 0) {
            this.printHelp();
            process.exit(1);
            return;
        }

        const lightId: string | number = args.id;

        const hueApi = await v3.api.createLocal(this.config.get("hue:host"))
          .connect(this.config.get("hue:username"));

        if(lightId === "all"){
            const timer = (ms: number | undefined) => new Promise(res => setTimeout(res, ms))
            const allLights = await hueApi.lights.getAll();

            for (const light of allLights) {
                try {
                    await hueApi.lights.setLightState(light.id,
                      new LightState()
                        .alert()
                        .alertShort()
                    );
                }catch (e: any){
                    console.error('Error while pinging light:', e.message);
                    process.exit(1);
                }

                console.log(`Light ${light.id} pinged.`);
                await timer(1500);
            }
        }else{
            try {
                await hueApi.lights.setLightState(lightId,
                  new LightState()
                    .alert()
                    .alertShort()
                );
            }catch (e: any){
                console.error('Error while pinging light:', e.message);
                process.exit(1);
            }

            console.log(`Light ${lightId} pinged.`);
        }
    }

    private async checkOrCreateConfigFile() {
        let exists: boolean;
        try {
            const fileInfo = await stat(CONFIG_FILE_PATH);
            exists = fileInfo.isFile();
        } catch (e) {
            exists = false;
        }

        if (!exists) {
            const fd = await open(CONFIG_FILE_PATH, 'w');
            await fd.write('{"artnet": {"host": "127.0.0.1", "universe": 11}}');
            await fd.close();
        }
    }
}

const handler = new ArtNetHueEntertainmentCliHandler(process.argv.slice(2));
handler.run();
