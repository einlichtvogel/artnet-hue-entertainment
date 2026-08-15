import {connect, DtlsSocket} from '@nodertc/dtls';
import {EventEmitter} from 'node:events';
import {Rgb16} from './types';

const PACKET_HEADER = Buffer.from('HueStream', 'ascii');
const HUE_STREAM_PORT = 2100;
const MIN_FRAME_INTERVAL_MS = 20;
const KEEPALIVE_INTERVAL_MS = 1000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ColorUpdate {
    channelId: number;
    color: Rgb16;
}

export interface HueStreamOptions {
    connectSocket?: typeof connect;
    now?: () => number;
    setTimeout?: typeof globalThis.setTimeout;
    clearTimeout?: typeof globalThis.clearTimeout;
    setInterval?: typeof globalThis.setInterval;
    clearInterval?: typeof globalThis.clearInterval;
}

export class HueStreamController extends EventEmitter {
    private readonly host: string;
    private readonly username: string;
    private readonly clientKey: string;
    private readonly areaId: string;
    private readonly now: () => number;
    private readonly connectSocket: typeof connect;
    private readonly scheduleTimeout: typeof globalThis.setTimeout;
    private readonly cancelTimeout: typeof globalThis.clearTimeout;
    private readonly scheduleInterval: typeof globalThis.setInterval;
    private readonly cancelInterval: typeof globalThis.clearInterval;

    private socket: DtlsSocket | null = null;
    private connected = false;
    private closing = false;
    private sequence = 0;
    private lastSentAt = -Infinity;
    private lastUpdates: ColorUpdate[] | null = null;
    private pendingUpdates: ColorUpdate[] | null = null;
    private sendTimer: ReturnType<typeof setTimeout> | null = null;
    private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    constructor(host: string, username: string, clientKey: string, areaId: string, options: HueStreamOptions = {}) {
        super();
        if (!UUID_PATTERN.test(areaId)) {
            throw new Error(`Invalid Hue entertainment configuration UUID: ${areaId}`);
        }
        if (!/^[0-9a-f]+$/i.test(clientKey) || clientKey.length % 2 !== 0) {
            throw new Error('Hue DTLS client key must be an even-length hexadecimal string');
        }
        this.host = host;
        this.username = username;
        this.clientKey = clientKey;
        this.areaId = areaId;
        this.connectSocket = options.connectSocket ?? connect;
        this.now = options.now ?? Date.now;
        this.scheduleTimeout = options.setTimeout ?? globalThis.setTimeout;
        this.cancelTimeout = options.clearTimeout ?? globalThis.clearTimeout;
        this.scheduleInterval = options.setInterval ?? globalThis.setInterval;
        this.cancelInterval = options.clearInterval ?? globalThis.clearInterval;
    }

    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }
        this.closing = false;
        const socket = this.connectSocket({
            type: 'udp4',
            remotePort: HUE_STREAM_PORT,
            remoteAddress: this.host,
            maxHandshakeRetransmissions: 4,
            pskIdentity: this.username,
            pskSecret: Buffer.from(this.clientKey, 'hex'),
            cipherSuites: ['TLS_PSK_WITH_AES_128_GCM_SHA256'],
        });
        this.socket = socket;

        await new Promise<void>((resolve, reject) => {
            const timeout = this.scheduleTimeout(() => {
                socket.close();
                reject(new Error('Timed out while connecting to Hue Entertainment DTLS'));
            }, HANDSHAKE_TIMEOUT_MS);
            const fail = (error: Error) => {
                this.cancelTimeout(timeout);
                reject(error);
            };
            const handshakeTimedOut = () => fail(new Error('Hue Entertainment DTLS handshake timed out'));
            socket.once('error', fail);
            socket.once('timeout', handshakeTimedOut);
            socket.once('connect', () => {
                this.cancelTimeout(timeout);
                socket.removeListener('error', fail);
                socket.removeListener('timeout', handshakeTimedOut);
                this.connected = true;
                resolve();
            });
        });

        socket.on('error', error => {
            if (!this.closing) {
                this.emit('error', error);
            }
        });
        socket.on('close', () => {
            const unexpected = !this.closing;
            this.connected = false;
            this.clearTimers();
            if (unexpected) {
                this.emit('close');
            }
        });
        this.keepaliveTimer = this.scheduleInterval(() => this.sendKeepalive(), KEEPALIVE_INTERVAL_MS);
        this.emit('connected');
    }

    sendUpdates(updates: readonly ColorUpdate[]): void {
        if (!this.connected || updates.length === 0) {
            return;
        }
        const snapshot = updates.map(update => ({channelId: update.channelId, color: [...update.color] as Rgb16}));
        const elapsed = this.now() - this.lastSentAt;
        if (elapsed >= MIN_FRAME_INTERVAL_MS && this.sendTimer === null) {
            this.writeUpdates(snapshot);
            return;
        }
        this.pendingUpdates = snapshot;
        if (this.sendTimer === null) {
            this.sendTimer = this.scheduleTimeout(() => {
                this.sendTimer = null;
                const pending = this.pendingUpdates;
                this.pendingUpdates = null;
                if (pending && this.connected) {
                    this.writeUpdates(pending);
                }
            }, Math.max(0, MIN_FRAME_INTERVAL_MS - elapsed));
        }
    }

    async close(): Promise<void> {
        if (this.closing) {
            return;
        }
        this.closing = true;
        this.connected = false;
        this.clearTimers();
        const socket = this.socket;
        this.socket = null;
        if (socket) {
            socket.close();
        }
        this.emit('closed');
    }

    private writeUpdates(updates: ColorUpdate[]): void {
        const message = encodeHueStreamPacket(this.areaId, updates, this.sequence);
        this.sequence = (this.sequence + 1) & 0xff;
        this.socket?.write(message);
        this.lastUpdates = updates;
        this.lastSentAt = this.now();
    }

    private sendKeepalive(): void {
        if (this.connected && this.lastUpdates && this.now() - this.lastSentAt >= KEEPALIVE_INTERVAL_MS) {
            this.writeUpdates(this.lastUpdates);
        }
    }

    private clearTimers(): void {
        if (this.sendTimer !== null) {
            this.cancelTimeout(this.sendTimer);
            this.sendTimer = null;
        }
        if (this.keepaliveTimer !== null) {
            this.cancelInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
        this.pendingUpdates = null;
    }
}

/** Encode one HueStream v2 RGB frame. */
export function encodeHueStreamPacket(areaId: string, updates: readonly ColorUpdate[], sequence: number): Buffer {
    if (!UUID_PATTERN.test(areaId)) {
        throw new Error(`Invalid Hue entertainment configuration UUID: ${areaId}`);
    }
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 255) {
        throw new RangeError('HueStream sequence must be an integer between 0 and 255');
    }
    const message = Buffer.alloc(16 + 36 + updates.length * 7, 0);
    PACKET_HEADER.copy(message, 0);
    message.writeUInt8(2, 9);
    message.writeUInt8(0, 10);
    message.writeUInt8(sequence, 11);
    message.writeUInt8(0, 14); // RGB color space
    message.write(areaId.toLowerCase(), 16, 36, 'ascii');
    const seen = new Set<number>();
    updates.forEach((update, index) => {
        if (!Number.isInteger(update.channelId) || update.channelId < 0 || update.channelId > 255) {
            throw new RangeError(`Hue channel ID ${update.channelId} must be between 0 and 255`);
        }
        if (seen.has(update.channelId)) {
            throw new Error(`Hue channel ${update.channelId} occurs more than once in a frame`);
        }
        seen.add(update.channelId);
        update.color.forEach(value => {
            if (!Number.isInteger(value) || value < 0 || value > 65535) {
                throw new RangeError(`Hue RGB value ${value} must be an integer between 0 and 65535`);
            }
        });
        const offset = 52 + index * 7;
        message.writeUInt8(update.channelId, offset);
        message.writeUInt16BE(update.color[0], offset + 1);
        message.writeUInt16BE(update.color[1], offset + 3);
        message.writeUInt16BE(update.color[2], offset + 5);
    });
    return message;
}
