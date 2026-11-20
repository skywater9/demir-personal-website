import test from 'node:test';
import assert from 'node:assert/strict';
import { ConquestRenderer } from '../public/scripts/conquestRenderer.mjs';
import { createWorld, bodies, dockingPoint } from '../public/scripts/conquestPhysics.mjs';
import { GameRoom } from '../server/room.mjs';

// Observe canvas operations and styles to verify interaction states without a browser dependency.
function scene() {
    const calls = [];
    const state = {};
    const context = new Proxy(state, {
        get(target, name) {
            if (name in target) return target[name];
            return (...args) => calls.push({ name, args, color: target.strokeStyle, alpha: target.globalAlpha });
        },
        set(target, name, value) { target[name] = value; return true; }
    });
    const renderer = Object.create(ConquestRenderer.prototype);
    Object.assign(renderer, { context, canvas: { width: 2000, height: 2000 }, camera: { zoom: 1 },
        visualTime: 0, lastElapsed: 0, reducedMotion: false, hackVisuals: new Map(),
        screen: (x, y) => ({ x, y }), inView: () => true });
    const world = createWorld('visuals', 0);
    const moon = bodies.find(body => body.id === 'moon');
    Object.assign(world.player, { x: moon.x, y: moon.y - moon.radius - 100, landedOn: null });
    const cursor = { x: moon.x / 2000, y: moon.y / 2000 };
    return { renderer, world, moon, cursor, calls };
}

test('neutral planets have no idle interaction rings; hover adds a gray outline', () => {
    const { renderer, world, cursor, calls } = scene();
    renderer.drawPlanetInteraction(world, null);
    assert.equal(calls.length, 0);
    renderer.drawPlanetInteraction(world, cursor);
    assert.ok(calls.some(call => call.name === 'stroke' && call.color === '#a7afb5'));
});

test('code progress eases between steps and defending owners see a red sector', () => {
    const { renderer, world, moon, calls } = scene();
    world.planets.moon.owner = world.player.id;
    world.captures = [{ bodyId: moon.id, playerId: 'attacker', progress: 1, required: 4 }];
    renderer.drawPlanetInteraction(world, null);
    renderer.visualTime = 0.08;
    calls.length = 0;
    renderer.drawPlanetInteraction(world, null);
    assert.ok(calls.some(call => call.name === 'stroke' && call.color === '#ff6268'));
    assert.ok(calls.some(call => call.name === 'fill' && call.alpha === 0.22));
    const arc = calls.filter(call => call.name === 'arc' && call.args.length === 5)[1];
    assert.ok(arc.args[4] > -Math.PI / 2 && arc.args[4] < 0, 'sector should be between zero and the quarter-circle target');
});

test('hover animates cursor dots and makes only the segment inside hacking range solid', () => {
    const { renderer, world, moon, cursor, calls } = scene();
    world.player.y = moon.y - 1000;
    renderer.visualTime = 1;
    renderer.drawAimGuide(world.player, cursor, 0, world);
    assert.ok(calls.some(call => call.name === 'setLineDash' && call.args[0].length > 0));
    assert.ok(calls.some(call => call.name === 'setLineDash' && call.args[0].length === 0));
    const starts = calls.filter(call => call.name === 'moveTo');
    assert.ok(starts[1].args[1] > world.player.y, 'solid portion begins partway along the guide');
});

test('local and multiplayer pilots spawn at their station left bay', () => {
    const world = createWorld('left-bay', 0);
    const station = bodies.find(body => body.id === world.player.homeId);
    assert.equal(world.player.x, station.x - 58);
    assert.equal(world.player.y, station.y);
    const room = new GameRoom(null, 1000);
    const { playerId } = room.join('', 1000);
    const player = room.world.players[playerId].player;
    const dock = dockingPoint(bodies.find(body => body.id === player.homeId));
    assert.equal(player.x, dock.x);
    assert.equal(player.y, dock.y);
});

test('multiplayer exposes capture progress to defenders without leaking the current code', () => {
    const room = new GameRoom(null, 1000);
    const attacker = room.join('', 1000), defender = room.join('', 1000);
    room.world.players[attacker.playerId].hack = { bodyId: 'moon', progress: 2, required: 4, digit: 3 };
    room.world.planets.moon.owner = defender.playerId;
    const capture = room.view(defender.playerId).captures[0];
    assert.equal(capture.playerId, attacker.playerId);
    assert.equal(capture.progress, 2);
    assert.equal(capture.digit, undefined);
});
