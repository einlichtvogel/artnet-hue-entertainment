'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {Duplex} = require('node:stream');
const {encodeHueStreamPacket, HueStreamController} = require('../build/hue-stream');

const AREA_ID = '123e4567-e89b-42d3-a456-426614174000';

test('HueStream v2 packet has the expected golden layout and full 16-bit color', () => {
    const packet = encodeHueStreamPacket(AREA_ID, [
        {channelId: 3, color: [0x1234, 0xabcd, 0xffff]},
    ], 7);
    assert.equal(packet.length, 59);
    assert.equal(packet.subarray(0, 9).toString('ascii'), 'HueStream');
    assert.deepEqual([...packet.subarray(9, 16)], [2, 0, 7, 0, 0, 0, 0]);
    assert.equal(packet.subarray(16, 52).toString('ascii'), AREA_ID);
    assert.equal(packet.subarray(52).toString('hex'), '031234abcdffff');
});

test('HueStream encoder rejects duplicate channels and invalid data', () => {
    assert.throws(() => encodeHueStreamPacket('not-a-uuid', [], 0), /Invalid/);
    assert.throws(() => encodeHueStreamPacket(AREA_ID, [
        {channelId: 1, color: [0, 0, 0]},
        {channelId: 1, color: [0, 0, 0]},
    ], 0), /more than once/);
    assert.throws(() => encodeHueStreamPacket(AREA_ID, [{channelId: 1, color: [65536, 0, 0]}], 0), /65535/);
});

test('HueStream scheduler coalesces fast frames and closes all timers', async () => {
    let now = 100;
    const writes = [];
    let pendingTimeout;
    let intervalCallback;
    class FakeSocket extends Duplex {
        _read() {}
        _write(chunk, encoding, callback) {
            writes.push(Buffer.from(chunk));
            callback();
        }
        close() {
            this.emit('close');
        }
    }
    const socket = new FakeSocket();
    const controller = new HueStreamController('bridge', 'user', 'abcd', AREA_ID, {
        now: () => now,
        connectSocket: () => {
            queueMicrotask(() => socket.emit('connect'));
            return socket;
        },
        setTimeout: callback => {
            pendingTimeout = callback;
            return 1;
        },
        clearTimeout: () => {
            pendingTimeout = undefined;
        },
        setInterval: callback => {
            intervalCallback = callback;
            return 2;
        },
        clearInterval: () => {
            intervalCallback = undefined;
        },
    });
    await controller.connect();
    controller.sendUpdates([{channelId: 0, color: [1, 2, 3]}]);
    now = 105;
    controller.sendUpdates([{channelId: 0, color: [4, 5, 6]}]);
    controller.sendUpdates([{channelId: 0, color: [7, 8, 9]}]);
    assert.equal(writes.length, 1);
    now = 120;
    const timeoutCallback = pendingTimeout;
    pendingTimeout = undefined;
    timeoutCallback();
    assert.equal(writes.length, 2);
    assert.equal(writes[1].subarray(-6).toString('hex'), '000700080009');
    now = 1200;
    intervalCallback();
    assert.equal(writes.length, 3);
    await controller.close();
    assert.equal(pendingTimeout, undefined);
    assert.equal(intervalCallback, undefined);
});
