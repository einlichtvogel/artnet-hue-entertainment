'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {ArtNetHueBridge} = require('../build/bridge');

const CONFIG = {
    hueHost: 'bridge',
    hueUsername: 'user',
    hueClientKey: 'abcd',
    entertainmentConfigurationId: '123e4567-e89b-42d3-a456-426614174000',
    artNetBindIp: '127.0.0.1',
    artNetUniverse: 11,
    channels: [{channelId: 0, dmxStart: 1, channelMode: '8bit'}],
};

class FakeStream extends EventEmitter {
    updates = [];
    async connect() {}
    sendUpdates(updates) { this.updates.push(updates); }
    async close() {}
}

class FakeArtNet extends EventEmitter {
    nameLong = '';
    nameShort = '';
    bound = false;
    closed = false;
    bind() { this.bound = true; }
    async close() { this.closed = true; }
}

test('bridge translates only the configured universe and closes idempotently', async () => {
    const actions = [];
    const stream = new FakeStream();
    const artNet = new FakeArtNet();
    const bridge = new ArtNetHueBridge(CONFIG, {
        hueApi: {setEntertainmentState: async (id, action) => actions.push(action)},
        stream,
        artNet,
        logger: {log() {}, warn() {}, error() {}},
    });
    await bridge.start();
    artNet.emit('dmx', {universe: 10, data: [255, 0, 0]});
    artNet.emit('dmx', {universe: 11, data: [255, 128, 0]});
    assert.equal(stream.updates.length, 2); // startup black plus one DMX frame
    assert.deepEqual(stream.updates[1], [{channelId: 0, color: [65535, 32896, 0]}]);
    await Promise.all([bridge.close(), bridge.close()]);
    assert.deepEqual(actions, ['start', 'stop']);
    assert.equal(artNet.closed, true);
});

test('bridge rolls back an activated Hue area if DTLS startup fails', async () => {
    const actions = [];
    const stream = new FakeStream();
    stream.connect = async () => { throw new Error('handshake failed'); };
    const bridge = new ArtNetHueBridge(CONFIG, {
        hueApi: {setEntertainmentState: async (id, action) => actions.push(action)},
        stream,
        artNet: new FakeArtNet(),
        logger: {log() {}, warn() {}, error() {}},
    });
    await assert.rejects(bridge.start(), /handshake failed/);
    assert.deepEqual(actions, ['start', 'stop']);
});
