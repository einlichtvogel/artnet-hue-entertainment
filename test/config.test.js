'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp, readFile, stat} = require('node:fs/promises');
const {join} = require('node:path');
const {tmpdir} = require('node:os');
const {
    loadConfiguration,
    parseConfiguration,
    saveConfiguration,
    validateChannelMappings,
} = require('../build/config');

test('missing configuration uses legacy Art-Net defaults without writing a file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'artnet-hue-config-'));
    const path = join(directory, 'missing.json');
    const configuration = await loadConfiguration(path);
    assert.deepEqual(configuration, {artnet: {host: '127.0.0.1', universe: 11}, hue: {}});
    await assert.rejects(readFile(path), error => error.code === 'ENOENT');
});

test('configuration accepts numeric legacy light IDs and normalizes them to strings', () => {
    const parsed = parseConfiguration({
        artnet: {universe: 4},
        hue: {lights: [{lightId: 2, dmxStart: 1, channelMode: '8bit'}]},
    });
    assert.equal(parsed.hue.lights[0].lightId, '2');
    assert.equal(parsed.artnet.host, '127.0.0.1');
});

test('channel validation rejects duplicates, overlaps, and ranges beyond DMX 512', () => {
    assert.throws(() => validateChannelMappings([
        {channelId: 1, dmxStart: 1, channelMode: '8bit'},
        {channelId: 1, dmxStart: 10, channelMode: '8bit'},
    ]), /configured more than once/);
    assert.throws(() => validateChannelMappings([
        {channelId: 1, dmxStart: 1, channelMode: '8bit'},
        {channelId: 2, dmxStart: 3, channelMode: '8bit'},
    ]), /overlaps/);
    assert.throws(() => validateChannelMappings([
        {channelId: 1, dmxStart: 510, channelMode: '16bit'},
    ]), /exceeds channel 512/);
});

test('identical DMX ranges can intentionally fan out to separate Hue channels', () => {
    assert.doesNotThrow(() => validateChannelMappings([
        {channelId: 1, dmxStart: 1, channelMode: '8bit-dimmable'},
        {channelId: 2, dmxStart: 1, channelMode: '8bit-dimmable'},
    ]));
});

test('configuration does not allow lamp and explicit channel modes together', () => {
    assert.throws(() => parseConfiguration({
        hue: {
            lights: [{lightId: '1', dmxStart: 1, channelMode: '8bit'}],
            channels: [{channelId: 0, dmxStart: 1, channelMode: '8bit'}],
        },
    }), /not both/);
});

test('configuration writes atomically with owner-only permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'artnet-hue-save-'));
    const path = join(directory, 'nested', 'config.json');
    const configuration = {
        artnet: {host: '0.0.0.0', universe: 1},
        hue: {host: 'bridge.local', username: 'user', clientKey: 'abcd'},
    };
    await saveConfiguration(configuration, path);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), configuration);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
});
