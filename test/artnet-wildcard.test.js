'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {WildcardArtNetReceiver} = require('../build/artnet-wildcard');

class FakeSocket extends EventEmitter {
    bindArguments;
    closed = false;

    bind(port, address) {
        this.bindArguments = [port, address];
    }

    close(callback) {
        this.closed = true;
        callback?.();
    }
}

test('wildcard receiver binds one socket to the configured wildcard address', async () => {
    const socket = new FakeSocket();
    const log = [];
    const receiver = new WildcardArtNetReceiver(
        family => {
            assert.equal(family, 'udp4');
            return socket;
        },
        {log: message => log.push(message)},
    );

    receiver.bind('0.0.0.0');

    assert.deepEqual(socket.bindArguments, [6454, '0.0.0.0']);
    assert.deepEqual(log, ['Binding Art-Net wildcard address 0.0.0.0:6454']);
    await receiver.close();
    assert.equal(socket.closed, true);
});

test('wildcard receiver rejects explicit interface addresses', () => {
    const receiver = new WildcardArtNetReceiver(() => new FakeSocket(), {log() {}});
    assert.throws(() => receiver.bind('192.168.1.20'), /cannot bind explicit address/);
});
