import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const testRuntimeRoot = fileURLToPath(new URL('../.test-runtime/', import.meta.url));
import WebSocket from 'ws';
import { createGameServer } from '../server.mjs';
import { GalaxyStore } from '../persistence.mjs';

// Collect protocol messages without logging chat, credentials, or identifying network details.
async function peer(url, token = '') {
    const socket = new WebSocket(url, { origin: 'https://test.invalid' });
    const messages = [];
    socket.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'hello', token }));
    // Wait only for the bounded protocol outcome the test needs.
    const wait = async predicate => {
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
            const found = messages.find(predicate);
            if (found) return found;
            await new Promise(resolveWait => setTimeout(resolveWait, 5));
        }
        throw new Error('Timed out waiting for protocol result.');
    };
    const welcome = await wait(message => message.type === 'welcome');
    return { socket, messages, welcome, wait };
}

// Start two real WebSocket clients against a local ephemeral listener and verify durable server outcomes.
test('two real connections share captures, purchases, chat and restart recovery', async t => {
    const dir = resolve(testRuntimeRoot, randomUUID());
    const file = resolve(dir, 'galaxy.json');
    const game = await createGameServer({ dataFile: file, allowedOrigins: ['https://test.invalid'], timers: false });
    game.server.listen(0, '127.0.0.1'); await once(game.server, 'listening');
    const url = `ws://127.0.0.1:${game.server.address().port}/game`;
    const a = await peer(url), b = await peer(url);
    t.after(async () => { a.socket.terminate(); b.socket.terminate(); await game.close(); await rm(dir, { recursive: true, force: true }); });
    assert.notEqual(a.welcome.playerId, b.welcome.playerId);
    const aid = a.welcome.playerId, bid = b.welcome.playerId;
    assert.equal(a.welcome.world.target.bodyId, 'moon');
    const joined = await a.wait(message => message.type === 'announcement' && message.text === `${b.welcome.world.player.label} joined the galaxy.`);
    assert.equal(joined.color, b.welcome.world.player.color);
    a.socket.send(JSON.stringify({ type: 'chat', sequence: 1, text: 'test space message' }));
    const chat = await b.wait(message => message.type === 'chat');
    assert.equal(chat.text, 'test space message');
    assert.equal(chat.color, game.room.world.players[aid].player.color);
    const actor = game.room.world.players[aid];
    const { dockingPoint, bodies } = await import('../../public/scripts/conquestPhysics.mjs');
    Object.assign(actor.player, dockingPoint(bodies[1]), { landedOn: null, vx: 0, vy: 0 });
    a.socket.send(JSON.stringify({ type: 'action', sequence: 2, actionId: 1, action: 'interact' }));
    await a.wait(message => message.type === 'result' && message.actionId === 1);
    let sequence = 2, actionId = 1;
    while (actor.hack) {
        game.room.tick(.15);
        a.socket.send(JSON.stringify({ type: 'action', sequence: ++sequence, actionId: ++actionId,
            action: 'digit', digit: actor.hack.digit, challengeId: actor.hack.challengeId }));
        await a.wait(message => message.type === 'result' && message.actionId === actionId);
    }
    assert.equal(game.room.world.planets.moon.owner, aid);
    const capture = await b.wait(message => message.type === 'capture');
    assert.equal(capture.bodyId, 'moon'); assert.equal(capture.owner, aid);
    actor.player.cargo = 20;
    a.socket.send(JSON.stringify({ type: 'action', sequence: ++sequence, actionId: ++actionId, action: 'rocketUpgrade' }));
    const purchase = await a.wait(message => message.type === 'result' && message.actionId === actionId);
    assert.equal(purchase.world.player.rocketTier, 1);
    assert.equal(purchase.world.player.cargo, 12);
    a.socket.send(JSON.stringify({ type: 'action', sequence: ++sequence, actionId, action: 'rocketUpgrade' }));
    await a.wait(message => message.type === 'result' && message.result.reason === 'Duplicate action ignored.');
    assert.equal(actor.player.rocketTier, 1);
    assert.equal(actor.player.cargo, 12);
    const victim = game.room.world.players[bid].player;
    Object.assign(victim, { x: actor.player.x + 500, y: actor.player.y, landedOn: null });
    b.socket.send(JSON.stringify({ type: 'action', sequence: 1, actionId: 1, action: 'selfDestruct' }));
    const explosion = await a.wait(message => message.type === 'death');
    assert.equal(explosion.id, bid);
    await a.wait(message => message.type === 'announcement' && message.text === `${victim.label} self-destructed.`);
    assert.ok(Number.isFinite(explosion.x));
    const saved = await new GalaxyStore(file).load();
    assert.equal(saved.world.planets.moon.owner, aid);
    const json = await readFile(file, 'utf8');
    assert.equal(json.includes(a.welcome.token), false);
    assert.equal(json.includes('test space message'), false);
    assert.equal(a.welcome.world.players, undefined);
    assert.equal(saved.world.players[bid].player.homeId === saved.world.players[aid].player.homeId, false);
    a.socket.close(); await once(a.socket, 'close');
    await b.wait(message => message.type === 'announcement' && message.text.startsWith(`${actor.player.label} disconnected`));
    const rejoined = await peer(url, a.welcome.token);
    assert.equal(rejoined.welcome.resumed, true);
    assert.equal(rejoined.welcome.world.player.rocketTier, 1);
    await b.wait(message => message.type === 'announcement' && message.text === `${actor.player.label} rejoined the galaxy.`);
    rejoined.socket.send(JSON.stringify({ type: 'leave', sequence: 1 }));
    await b.wait(message => message.type === 'announcement' && message.text === `${actor.player.label} left the galaxy.`);
    rejoined.socket.terminate();
});

// Broken durable state must never silently reset a room's ownership.
test('invalid persistent state fails closed', async () => {
    const dir = resolve(testRuntimeRoot, randomUUID());
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, 'galaxy.json');
    await writeFile(file, '{broken');
    await assert.rejects(new GalaxyStore(file).load());
    await rm(dir, { recursive: true, force: true });
});

// Exercise a real service restart with a durable file and a valid reconnect token.
test('a restarted service restores territory and gives online pilots a fresh reconnect window', async () => {
    const dir = resolve(testRuntimeRoot, randomUUID());
    const file = resolve(dir, 'galaxy.json');
    let clock = 1000;
    const options = { dataFile: file, allowedOrigins: ['https://test.invalid'], timers: false, now: () => clock };
    const first = await createGameServer(options);
    first.server.listen(0, '127.0.0.1'); await once(first.server, 'listening');
    const pilot = await peer(`ws://127.0.0.1:${first.server.address().port}/game`);
    const id = pilot.welcome.playerId;
    first.room.world.planets.moon.owner = id;
    first.room.world.planets.moon.level = 2;
    first.room.world.planets.moon.turrets = [{ health: 2.5, disabledUntil: first.room.world.elapsed + 5, angle: -.7, nextShotAt: 0 },
        { health: 5, disabledUntil: 0, angle: .2, nextShotAt: 0 }];
    first.room.world.players[id].player.rocketTier = 3;
    await first.close();
    clock = 1000000;
    const restarted = await createGameServer(options);
    restarted.server.listen(0, '127.0.0.1'); await once(restarted.server, 'listening');
    try {
        const recovered = await peer(`ws://127.0.0.1:${restarted.server.address().port}/game`, pilot.welcome.token);
        assert.equal(recovered.welcome.playerId, id);
        assert.equal(recovered.welcome.resumed, true);
        assert.equal(recovered.welcome.world.planets.moon.level, 2);
        assert.equal(recovered.welcome.world.planets.moon.turrets[0].health, 2.5);
        assert.equal(recovered.welcome.world.planets.moon.turrets[0].angle, -.7);
        assert.ok(recovered.welcome.world.planets.moon.turrets[0].disabledUntil > recovered.welcome.world.elapsed);
        assert.equal(recovered.welcome.world.player.rocketTier, 3);
        recovered.socket.terminate();
    } finally { await restarted.close(); await rm(dir, { recursive: true, force: true }); }
});

// Exercise actual simulation timers and null aim input, as sent while the browser menu is open.
test('live server ticks advance controls and idle menu input cannot turn the rocket', async () => {
    const dir = resolve(testRuntimeRoot, randomUUID());
    const game = await createGameServer({ dataFile: resolve(dir, 'galaxy.json'), allowedOrigins: ['https://test.invalid'] });
    game.server.listen(0, '127.0.0.1'); await once(game.server, 'listening');
    const a = await peer(`ws://127.0.0.1:${game.server.address().port}/game`);
    try {
        const startY = a.welcome.world.player.y;
        a.socket.send(JSON.stringify({ type: 'input', sequence: 1,
            input: { burn: true, fire: false, rcsX: 0, rcsY: 0, aimAngle: -Math.PI / 2 } }));
        await a.wait(message => message.type === 'state' && message.world.player.y < startY - 1);
        a.socket.send(JSON.stringify({ type: 'input', sequence: 2,
            input: { burn: false, fire: false, rcsX: 0, rcsY: 0, aimAngle: null } }));
        await new Promise(resolveWait => setTimeout(resolveWait, 30));
        const actor = game.room.world.players[a.welcome.playerId];
        const fuel = actor.player.fuel, angle = actor.player.angle;
        await new Promise(resolveWait => setTimeout(resolveWait, 80));
        assert.ok(Math.abs(actor.player.fuel - fuel) < 1e-8);
        assert.ok(Math.abs(actor.player.angle - angle) < 1e-8);
    } finally { a.socket.terminate(); await game.close(); await rm(dir, { recursive: true, force: true }); }
});

// Origin checks belong to the handshake; application responses must not duplicate Caddy's CORS/TLS work.
test('handshake rejects other origins and HTTP health exposes no private state', async () => {
    const dir = resolve(testRuntimeRoot, randomUUID());
    const game = await createGameServer({ dataFile: resolve(dir, 'galaxy.json'), allowedOrigins: ['https://test.invalid'], timers: false });
    game.server.listen(0, '127.0.0.1'); await once(game.server, 'listening');
    try {
        const origin = `http://127.0.0.1:${game.server.address().port}`;
        const response = await fetch(`${origin}/health`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.has('access-control-allow-origin'), false);
        const health = await response.json();
        assert.equal(health.online, 0); assert.equal(health.sessions, undefined);
        const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/game`, { origin: 'https://other.invalid' });
        await assert.rejects(once(socket, 'open'));
    } finally { await game.close(); await rm(dir, { recursive: true, force: true }); }
});
