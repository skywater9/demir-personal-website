import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerClient, multiplayerUrl } from '../public/scripts/multiplayerClient.mjs';

// Model the browser socket without connecting to any host or writing browser credentials.
class Socket extends EventTarget {
    static instances = [];
    constructor(url) { super(); this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; Socket.instances.push(this); }
    // Observe bounded outbound protocol frames.
    send(value) { this.sent.push(JSON.parse(value)); }
    // Deliver a JSON message through the same browser event path.
    message(data) { const event = new Event('message'); Object.defineProperty(event, 'data', { value: JSON.stringify(data) }); this.dispatchEvent(event); }
    // Open the fake transport on demand.
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    // Close the transport without leaving a real process running.
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

// Validate deployment endpoints without embedding student identity or credentials in fixtures.
test('endpoint selection supports secure class URLs and explicit localhost testing only', () => {
    const page = { querySelector: () => ({ content: 'same-origin' }) };
    assert.equal(multiplayerUrl(page, { location: { origin: 'https://service.example', search: '' } }), 'wss://service.example/game');
    assert.equal(multiplayerUrl({}, { location: { search: '?server=http%3A%2F%2Flocalhost%3A12345' } }), 'ws://localhost:12345/game');
    assert.throws(() => multiplayerUrl({}, { location: { search: '?server=http%3A%2F%2Fpublic.example' } }));
    assert.throws(() => multiplayerUrl({}, { location: { search: '?server=https%3A%2F%2Fuser%3Apass%40example.invalid' } }));
});

// Acknowledged world state and actions are driven exclusively by server messages.
test('browser transport restores private credentials, sequences commands and waits for confirmation', async () => {
    const data = new Map(); const worlds = [];
    const client = new MultiplayerClient({ url: 'wss://service.example/game', storage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) },
        WebSocketClass: Socket, onWorld: world => worlds.push(world) });
    const connecting = client.connect(); const socket = Socket.instances.at(-1); socket.open();
    assert.equal(socket.sent[0].type, 'hello');
    socket.message({ type: 'welcome', token: 'f'.repeat(64), lastActionId: 4, world: { player: { id: 'test-pilot' } } });
    await connecting;
    const result = client.action('rocketUpgrade');
    const command = socket.sent.at(-1);
    assert.equal(command.actionId, 5);
    assert.equal(command.player, undefined);
    assert.equal(command.cargo, undefined);
    socket.message({ type: 'result', actionId: 5, result: { ok: true }, world: { player: { rocketTier: 1 } } });
    assert.deepEqual(await result, { ok: true });
    assert.equal(worlds.at(-1).player.rocketTier, 1);
    client.input({ burn: true, fire: false, rcsX: 0, rcsY: 1, aimAngle: .2, x: 999, cargo: 100 }, 100);
    assert.equal(socket.sent.at(-1).input.x, undefined);
    assert.equal(socket.sent.at(-1).input.cargo, undefined);
    client.suspend();
});

// A copied tab credential must yield to the new connection instead of causing a takeover loop.
test('replaced tab forgets its copied credential and does not reconnect automatically', async () => {
    const data = new Map(), statuses = [];
    const client = new MultiplayerClient({ url: 'wss://service.example/game', WebSocketClass: Socket,
        storage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) },
        onStatus: status => statuses.push(status) });
    const connecting = client.connect(); const socket = Socket.instances.at(-1); socket.open();
    socket.message({ type: 'welcome', token: 'e'.repeat(64), world: { player: { id: 'test-pilot' } } });
    await connecting;
    const event = new Event('close');
    Object.defineProperties(event, { code: { value: 1000 }, reason: { value: 'Replaced by a new connection.' } });
    socket.readyState = 3; socket.dispatchEvent(event);
    assert.equal(client.stopped, true); assert.equal(client.connected, false);
    assert.equal(client.token, ''); assert.equal(data.size, 0);
    assert.equal(statuses.at(-1), 'replaced');
});
