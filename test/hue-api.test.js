'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const {
    createLightAutoSetupMappings,
    HueApiClient,
    resolveLegacyMappings,
    selectEntertainmentConfiguration,
} = require('../build/hue-api');

const AREA = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    id_v1: '/groups/200',
    channels: [
        {channel_id: 0, members: [{service: {rid: 'service-1', rtype: 'entertainment'}}]},
        {channel_id: 1, members: [{service: {rid: 'service-2', rtype: 'entertainment'}}]},
        {channel_id: 2, members: [{service: {rid: 'service-2', rtype: 'entertainment'}, index: 1}]},
    ],
};

test('area selection honors explicit UUID and legacy group 200 fallback', () => {
    const other = {id: '223e4567-e89b-42d3-a456-426614174000', id_v1: '/groups/201', channels: []};
    assert.equal(selectEntertainmentConfiguration([other, AREA]).id, AREA.id);
    assert.equal(selectEntertainmentConfiguration([AREA, other], other.id).id, other.id);
    assert.throws(() => selectEntertainmentConfiguration([other]), /groups\/200/);
});

test('legacy lamps map to all v2 channels including gradient segments', () => {
    const services = [
        {id: 'service-1', id_v1: '/lights/1'},
        {id: 'service-2', id_v1: '/lights/2'},
    ];
    const mappings = resolveLegacyMappings(AREA, services, [
        {lightId: '1', dmxStart: 1, channelMode: '8bit'},
        {lightId: '2', dmxStart: 4, channelMode: '8bit-dimmable'},
    ]);
    assert.deepEqual(mappings, [
        {channelId: 0, dmxStart: 1, channelMode: '8bit'},
        {channelId: 1, dmxStart: 4, channelMode: '8bit-dimmable'},
        {channelId: 2, dmxStart: 4, channelMode: '8bit-dimmable'},
    ]);
});

test('auto-setup writes one lamp mapping for all segments of a gradient light', () => {
    const services = [
        {id: 'service-1', id_v1: '/lights/1'},
        {id: 'service-2', id_v1: '/lights/2'},
    ];
    assert.deepEqual(createLightAutoSetupMappings(AREA, services), [
        {lightId: '1', dmxStart: 1, channelMode: '8bit-dimmable'},
        {lightId: '2', dmxStart: 5, channelMode: '8bit-dimmable'},
    ]);
});

test('auto-setup calculates consecutive addresses for every channel mode', () => {
    const services = [
        {id: 'service-1', id_v1: '/lights/1'},
        {id: 'service-2', id_v1: '/lights/2'},
    ];
    for (const [mode, width] of [
        ['8bit', 3],
        ['8bit-dimmable', 4],
        ['16bit', 6],
        ['16bit-dimmable', 8],
    ]) {
        assert.deepEqual(createLightAutoSetupMappings(AREA, services, mode), [
            {lightId: '1', dmxStart: 1, channelMode: mode},
            {lightId: '2', dmxStart: 1 + width, channelMode: mode},
        ]);
    }
});

test('auto-setup requires explicit channel mode when a bridge exposes no legacy light ID', () => {
    assert.throws(() => createLightAutoSetupMappings(AREA, []), /explicit hue\.channels/);
});

test('Axios client sends v2 application-key header and stream payload', async () => {
    const requests = [];
    const factory = config => axios.create({
        ...config,
        adapter: async request => {
            requests.push(request);
            if (request.url === '/api/config') {
                return response(request, {bridgeid: '001788fffedcba98'});
            }
            return response(request, {data: [], errors: []});
        },
    });
    const client = new HueApiClient('192.0.2.1', 'app-key', factory, async () => {});
    await client.setEntertainmentState(AREA.id, 'start');
    assert.equal(requests[1].method, 'put');
    assert.equal(requests[1].url, `/clip/v2/resource/entertainment_configuration/${AREA.id}`);
    assert.equal(requests[1].headers.get('hue-application-key'), 'app-key');
    assert.deepEqual(JSON.parse(requests[1].data), {action: 'start'});
});

function response(config, data) {
    return {data, status: 200, statusText: 'OK', headers: {}, config};
}
