'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {parseCli, resolveConfiguredMappings} = require('../build/cli');

test('CLI parses global config and command options', () => {
    assert.deepEqual(parseCli(['ping-light', '--id', '4', '--config', 'custom.json']), {
        command: 'ping-light',
        id: '4',
        ip: undefined,
        mode: undefined,
        configPath: 'custom.json',
        help: false,
    });
    assert.equal(parseCli(['auto-setup', '--mode', '16bit-dimmable']).mode, '16bit-dimmable');
    assert.throws(() => parseCli(['auto-setup', '--mode', 'invalid']), /--mode must be one of/);
});

test('configured v2 channels must exactly cover the selected area', async () => {
    const area = {
        id: '123e4567-e89b-42d3-a456-426614174000',
        channels: [
            {channel_id: 0, members: []},
            {channel_id: 1, members: []},
        ],
    };
    const configuration = {
        artnet: {host: '127.0.0.1', universe: 11},
        hue: {channels: [{channelId: 0, dmxStart: 1, channelMode: '8bit'}]},
    };
    await assert.rejects(resolveConfiguredMappings(configuration, area, []), /missing: 1/);
});

test('legacy gradient mapping fans one DMX range out to every segment', async () => {
    const area = {
        id: '123e4567-e89b-42d3-a456-426614174000',
        channels: [
            {channel_id: 0, members: [{service: {rid: 'gradient', rtype: 'entertainment'}}]},
            {channel_id: 1, members: [{service: {rid: 'gradient', rtype: 'entertainment'}, index: 1}]},
        ],
    };
    const configuration = {
        artnet: {host: '127.0.0.1', universe: 11},
        hue: {lights: [{lightId: '5', dmxStart: 1, channelMode: '8bit-dimmable'}]},
    };
    assert.deepEqual(await resolveConfiguredMappings(configuration, area, [
        {id: 'gradient', id_v1: '/lights/5'},
    ]), [
        {channelId: 0, dmxStart: 1, channelMode: '8bit-dimmable'},
        {channelId: 1, dmxStart: 1, channelMode: '8bit-dimmable'},
    ]);
});
