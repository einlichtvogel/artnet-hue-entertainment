import {createSocket} from 'node:dgram';
import {EventEmitter} from 'node:events';
import {ArtDmx, decode} from 'artnet-protocol/dist/protocol';

const ARTNET_PORT = 6454;

interface DatagramSocketLike {
    on(event: 'message', listener: (message: Buffer) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    bind(port: number, address: string): void;
    close(callback?: () => void): void;
}

type SocketFactory = (family: 'udp4' | 'udp6') => DatagramSocketLike;

export class WildcardArtNetReceiver extends EventEmitter {
    nameLong = 'ArtNet Hue Entertainment';
    nameShort = 'ArtNet Hue';
    private socket: DatagramSocketLike | undefined;

    constructor(
        private readonly socketFactory: SocketFactory = family => createSocket({type: family, reuseAddr: true}),
        private readonly logger: Pick<Console, 'log'> = console,
    ) {
        super();
    }

    bind(host = '0.0.0.0'): void {
        if (this.socket) {
            throw new Error('Art-Net receiver is already bound');
        }
        if (host !== '0.0.0.0' && host !== '::') {
            throw new Error(`Wildcard receiver cannot bind explicit address ${host}`);
        }
        const family = host === '::' ? 'udp6' : 'udp4';
        const socket = this.socketFactory(family);
        this.socket = socket;
        socket.on('message', message => {
            const packet = decode(message);
            if (packet instanceof ArtDmx) {
                this.emit('dmx', packet);
            }
        });
        socket.on('error', error => this.emit('error', error));
        this.logger.log(`Binding Art-Net wildcard address ${host}:${ARTNET_PORT}`);
        socket.bind(ARTNET_PORT, host);
    }

    async close(): Promise<void> {
        const socket = this.socket;
        this.socket = undefined;
        if (!socket) {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            try {
                socket.close(resolve);
            } catch (error) {
                reject(error);
            }
        });
    }
}
