import {ChannelMode, Rgb16} from './types';

const UINT8_MAX = 255;
const UINT16_MAX = 65535;

export function channelWidth(mode: ChannelMode): number {
    switch (mode) {
        case '8bit':
            return 3;
        case '8bit-dimmable':
            return 4;
        case '16bit':
            return 6;
        case '16bit-dimmable':
            return 8;
    }
}

/** Convert one configured DMX mapping into Hue's unsigned 16-bit RGB values. */
export function decodeColor(mode: ChannelMode, values: readonly number[]): Rgb16 {
    const width = channelWidth(mode);
    if (values.length !== width) {
        throw new RangeError(`Expected ${width} DMX values for ${mode}, received ${values.length}`);
    }
    values.forEach((value, index) => {
        if (!Number.isInteger(value) || value < 0 || value > UINT8_MAX) {
            throw new RangeError(`DMX value ${index + 1} must be an integer between 0 and 255`);
        }
    });

    if (mode === '8bit') {
        return [values[0]! * 257, values[1]! * 257, values[2]! * 257];
    }
    if (mode === '8bit-dimmable') {
        const dimmer = values[0]! / UINT8_MAX;
        return [
            clamp16(Math.round(values[1]! * 257 * dimmer)),
            clamp16(Math.round(values[2]! * 257 * dimmer)),
            clamp16(Math.round(values[3]! * 257 * dimmer)),
        ];
    }
    if (mode === '16bit') {
        return [decode16(values, 0), decode16(values, 2), decode16(values, 4)];
    }
    const dimmer = decode16(values, 0) / UINT16_MAX;
    return [
        clamp16(Math.round(decode16(values, 2) * dimmer)),
        clamp16(Math.round(decode16(values, 4) * dimmer)),
        clamp16(Math.round(decode16(values, 6) * dimmer)),
    ];
}

function decode16(values: readonly number[], offset: number): number {
    return (values[offset]! << 8) + values[offset + 1]!;
}

function clamp16(value: number): number {
    return Math.max(0, Math.min(UINT16_MAX, value));
}
