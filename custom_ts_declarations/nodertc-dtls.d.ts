declare module '@nodertc/dtls' {
    import { Duplex } from 'node:stream';

    export interface DtlsConnectOptions {
        type: 'udp4';
        remotePort: number;
        remoteAddress: string;
        maxHandshakeRetransmissions?: number;
        pskIdentity: string;
        pskSecret: Buffer;
        cipherSuites: string[];
    }

    export interface DtlsSocket extends Duplex {
        close(): void;
        once(event: 'connect' | 'close' | 'timeout', listener: () => void): this;
        once(event: 'error', listener: (error: Error) => void): this;
        on(event: 'close', listener: () => void): this;
        on(event: 'error', listener: (error: Error) => void): this;
    }

    export function connect(options: DtlsConnectOptions): DtlsSocket;
}
