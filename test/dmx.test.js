'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {channelWidth, decodeColor} = require('../build/dmx');

test('channel modes expose their DMX widths', () => {
    assert.equal(channelWidth('8bit'), 3);
    assert.equal(channelWidth('8bit-dimmable'), 4);
    assert.equal(channelWidth('16bit'), 6);
    assert.equal(channelWidth('16bit-dimmable'), 8);
});

test('8-bit and 16-bit DMX values preserve expected precision', () => {
    assert.deepEqual(decodeColor('8bit', [255, 128, 0]), [65535, 32896, 0]);
    assert.deepEqual(decodeColor('16bit', [0x12, 0x34, 0xab, 0xcd, 0xff, 0xff]), [0x1234, 0xabcd, 0xffff]);
});

test('dimmable mode rounds fractional values', () => {
    assert.deepEqual(decodeColor('8bit-dimmable', [128, 255, 127, 1]), [32896, 16383, 129]);
    assert.deepEqual(
        decodeColor('16bit-dimmable', [0x80, 0x00, 0xff, 0xff, 0x80, 0x00, 0x00, 0x01]),
        [0x8000, 0x4000, 0x0001],
    );
    assert.deepEqual(
        decodeColor('16bit-dimmable', [0xff, 0xff, 0x12, 0x34, 0xab, 0xcd, 0xff, 0xff]),
        [0x1234, 0xabcd, 0xffff],
    );
});

test('DMX conversion rejects short and invalid values', () => {
    assert.throws(() => decodeColor('16bit', [1, 2]), /Expected 6/);
    assert.throws(() => decodeColor('16bit-dimmable', [1, 2]), /Expected 8/);
    assert.throws(() => decodeColor('8bit', [0, 256, 0]), /between 0 and 255/);
    assert.throws(() => decodeColor('8bit', [0, 1.5, 0]), /integer/);
});
