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
            return (...args) => calls.push({ name, args, color: target.strokeStyle, fill: target.fillStyle, shadow: target.shadowColor, blur: target.shadowBlur, alpha: target.globalAlpha });
        },
        set(target, name, value) { target[name] = value; return true; }
    });
    const renderer = Object.create(ConquestRenderer.prototype);
    Object.assign(renderer, { context, canvas: { width: 2000, height: 2000 }, camera: { zoom: 1 },
        visualTime: 0, lastElapsed: 0, reducedMotion: false, hackVisuals: new Map(), captureEffects: [], ownerPalette: new Map(),
        screen: (x, y) => ({ x, y }), inView: () => true });
    const world = createWorld('visuals', 0);
    const moon = bodies.find(body => body.id === 'moon');
    Object.assign(world.player, { x: moon.x, y: moon.y - moon.radius - 100, landedOn: null });
    const cursor = { x: moon.x / 2000, y: moon.y / 2000 };
    return { renderer, world, moon, cursor, calls };
}

test('neutral planets have no idle interaction rings; hover adds a white outline and dotted range ring', () => {
    const { renderer, world, cursor, calls } = scene();
    renderer.drawPlanetInteraction(world, null);
    assert.equal(calls.length, 0);
    renderer.drawPlanetInteraction(world, cursor);
    assert.ok(calls.some(call => call.name === 'stroke' && call.color === '#f1f6f3'));
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
    assert.ok(calls.some(call => call.name === 'fill' && call.alpha === 0.38));
    const arc = calls.filter(call => call.name === 'arc' && call.args.length === 5)[1];
    assert.ok(arc.args[4] > -Math.PI / 2 && arc.args[4] < 0, 'sector should be between zero and the quarter-circle target');
});

test('hover uses moving tiny arrowheads rather than a solid or dashed connecting line', () => {
    const { renderer, world, moon, cursor, calls } = scene();
    world.player.y = moon.y - 1000;
    renderer.visualTime = 1;
    renderer.drawAimGuide(world.player, cursor, 0, world);
    assert.ok(!calls.some(call => call.name === 'setLineDash' && call.args[0].length > 0));
    const starts = calls.filter(call => call.name === 'moveTo');
    const tips = calls.filter(call => call.name === 'lineTo');
    assert.ok(starts.length > 5);
    assert.ok(Math.hypot(starts[0].args[0] - tips[0].args[0], starts[0].args[1] - tips[0].args[1]) < 4);
    calls.length = 0;
    renderer.visualTime = 1.2;
    renderer.drawAimGuide(world.player, cursor, 0, world);
    const moved = calls.find(call => call.name === 'moveTo');
    assert.notEqual(moved.args[1], starts[0].args[1]);
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


test('enemy progress on a neutral planet and an enemy takeover flash use red rather than friendly green', () => {
    const { renderer, world, moon, calls } = scene();
    renderer.reducedMotion = true;
    world.captures = [{ bodyId: moon.id, playerId: 'enemy', progress: 2, required: 4 }];
    renderer.drawPlanetInteraction(world, null);
    assert.ok(calls.some(call => call.name === 'fill' && call.fill === '#ff6268'));
    assert.ok(!calls.some(call => call.name === 'fill' && call.fill === '#8cdeb0'));
    renderer.reducedMotion = false;
    renderer.beginCapture(moon.id, '#8cdeb0', 'enemy');
    renderer.visualTime = .4; calls.length = 0;
    renderer.drawCaptureEffects(world);
    assert.ok(calls.some(call => call.name === 'fill' && call.fill === '#ff6268'));
    assert.ok(!calls.some(call => call.name === 'fill' && call.fill === '#8cdeb0'));
});

test('simultaneous capture gives each unique hacker an equal sector with independent progress', () => {
    const { renderer, world, moon, calls } = scene();
    renderer.reducedMotion = true;
    world.captures = [
        { bodyId: moon.id, playerId: 'enemy-a', progress: 1, required: 4 },
        { bodyId: moon.id, playerId: 'enemy-b', progress: 3, required: 4 },
        { bodyId: moon.id, playerId: world.player.id, progress: 2, required: 4 }
    ];
    world.hack = { bodyId: moon.id, progress: 2, required: 4 };
    renderer.drawPlanetInteraction(world, null);
    const wedges = calls.filter(call => call.name === 'arc' && call.args[2] === moon.radius / 2);
    assert.equal(wedges.length, 3, 'The local player in the public summary must not be counted twice.');
    const expected = [.25, .75, .5];
    wedges.forEach((wedge, index) => {
        const start = -Math.PI / 2 + index * Math.PI * 2 / 3;
        assert.ok(Math.abs(wedge.args[3] - start) < 1e-9);
        assert.ok(Math.abs(wedge.args[4] - start - Math.PI * 2 / 3 * expected[index]) < 1e-9);
    });
});

test('enemy planets have a red glowing surface outline', () => {
    const { renderer, world, moon, calls } = scene();
    world.planets.moon.owner = 'enemy';
    renderer.label = () => {}; renderer.drawFuelZone = () => {};
    renderer.drawBody(moon, world);
    assert.ok(calls.some(call => call.name === 'stroke' && call.color === '#ff6268' && call.shadow === '#ff6268'));
});

test('hover arrowheads follow the actual cursor rather than snapping toward planet center', () => {
    const { renderer, world, moon, calls } = scene();
    world.player.y = moon.y - 700;
    const cursor = { x: (moon.x + moon.radius * .6) / 2000, y: moon.y / 2000 };
    renderer.drawAimGuide(world.player, cursor, 0, world);
    const tip = calls.find(call => call.name === 'lineTo');
    assert.ok(tip.args[0] > world.player.x, 'A right-of-center cursor must angle the guide to the right.');
});

test('black hole uses circular rings and orbiting particles around its dark core', () => {
    const { renderer, calls } = scene();
    renderer.label = () => {};
    renderer.drawBlackHole();
    assert.equal(calls.filter(call => call.name === 'ellipse').length, 0);
    assert.ok(calls.filter(call => call.name === 'arc').length >= 7);
    const firstParticle = calls.find(call => call.name === 'fillRect');
    calls.length = 0; renderer.visualTime = 1;
    renderer.drawBlackHole();
    const movedParticle = calls.find(call => call.name === 'fillRect');
    assert.notDeepEqual(firstParticle.args, movedParticle.args);
    assert.ok(calls.some(call => call.name === 'fill' && call.fill === '#010103'));
});


test('unavailable planet cargo is faded gray while its owner sees glowing gold', () => {
    const { renderer, world, moon, calls } = scene();
    world.planets.moon.owner = 'enemy';
    world.pickups = [{ bodyId: moon.id, x: moon.x + moon.radius + 80, y: moon.y }];
    renderer.drawObjects(world);
    assert.ok(calls.some(call => call.name === 'fillRect' && call.fill === '#9aa3a9' && call.alpha === .28));
    assert.ok(!calls.some(call => call.name === 'fillRect' && call.fill === '#f4d997'));
    assert.ok(calls.some(call => call.name === 'clip'));
    calls.length = 0; world.planets.moon.owner = world.player.id;
    renderer.drawObjects(world);
    assert.ok(calls.some(call => call.name === 'fillRect' && call.fill === '#f4d997' && call.alpha > .8));
});


test('higher-value death cargo has a larger sprite and stronger glow with bounded rendering size', () => {
    const { renderer, world, moon, calls } = scene();
    const styles = [];
    for (const amount of [1, 16, 256, 1000000]) {
        world.pickups = [{ x: moon.x + moon.radius + 80, y: moon.y, amount }];
        calls.length = 0;
        renderer.drawObjects(world);
        const scale = calls.find(call => call.name === 'scale');
        const crate = calls.find(call => call.name === 'fillRect');
        styles.push({ scale: scale.args[0], blur: crate.blur });
    }
    assert.ok(styles[1].scale > styles[0].scale && styles[2].scale > styles[1].scale);
    assert.ok(styles[1].blur > styles[0].blur && styles[2].blur > styles[1].blur);
    assert.ok(styles[3].scale <= 2.8 * 1.18 && styles[3].blur <= 32);
});
