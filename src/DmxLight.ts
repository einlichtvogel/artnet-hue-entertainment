import {LIGHT_MODE_16BIT, LIGHT_MODE_8BIT, LIGHT_MODE_8BIT_DIMMABLE} from "./const";

export abstract class DmxLight {

    readonly dmxStart: number;
    readonly lightId: number;

    constructor(dmxStart: number, lightId: number) {
        this.dmxStart = dmxStart;
        this.lightId = lightId;
    }

    /**
     * The amount of DMX channels this mode takes up.
     */
    abstract channelWidth: number;

    /**
     * Convert the raw DMX data to list containing 16bit RGB values.
     *
     * The input is an array with length equal to `channelWidth`, which contains
     * the values of the DMX channels representing the light.
     * The implementer is responsible for converting the DMX values to 16bit unsigned RGB.
     *
     * @param dmxValues The raw DMX values of the channels representing this light.
     */
    abstract getColorValue(dmxValues: number[]): [number, number, number];
}

export class DmxLight8Bit extends DmxLight {

    channelWidth = 3;

    getColorValue(dmxValues: number[]): [number, number, number] {
        const r = (dmxValues[0] * 257);
        const g = (dmxValues[1] * 257);
        const b = (dmxValues[2] * 257);
        return [r, g, b];
    }
}

export class DmxLight8BitDimmable extends DmxLight {

    channelWidth = 4;

    getColorValue(dmxValues: number[]): [number, number, number] {
        const r = (dmxValues[1] * 257) * (dmxValues[0] / 255);
        const g = (dmxValues[2] * 257) * (dmxValues[0] / 255);
        const b = (dmxValues[3] * 257) * (dmxValues[0] / 255);
        return [r, g, b];
    }
}

export class DmxLight16Bit extends DmxLight {

    channelWidth = 6;

    getColorValue(dmxValues: number[]): [number, number, number] {
        const r = dmxValues[0];
        const rFine = dmxValues[1];
        const g = dmxValues[2];
        const gFine = dmxValues[3];
        const b = dmxValues[4];
        const bFine = dmxValues[5];
        return [(r << 8) + rFine, (g << 8) + gFine, (b << 8) + bFine];
    }
}

export const LIGHT_MODES = {
    [LIGHT_MODE_8BIT]: DmxLight8Bit,
    [LIGHT_MODE_8BIT_DIMMABLE]: DmxLight8BitDimmable,
    [LIGHT_MODE_16BIT]: DmxLight16Bit,
}

