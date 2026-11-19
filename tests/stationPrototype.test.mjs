import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, bodies, planetBodies, starterStations, stepWorld, interact, dockingPoint, nextRocketUpgrade } from '../public/scripts/conquestPhysics.mjs';
import { GameRoom } from '../server/room.mjs';
import { validateSave } from '../server/persistence.mjs';

// Advance bounded production ticks without depending on wall time.
function advance(world, seconds, input = {}) {
    while (seconds > 1e-8) {
        const dt = Math.min(1 / 60, seconds);
        stepWorld(world, input, dt);
        seconds -= dt;
    }
}

// Keep a pilot near the surface while holding the capture control.
function captureMoon(world, seconds) {
    const moon = bodies.find(body => body.id === 'moon');
    Object.assign(world.player, { landedOn: null, docked: null, x: moon.x, y: moon.y - moon.radius - 45, aimAngle: Math.PI / 2 });
    for (let i = 0; i < seconds * 60; i++) {
        world.player.vx = 0; world.player.vy = 0;
        stepWorld(world, { capture: true, captureBody: moon.id, aimAngle: Math.PI / 2 }, 1 / 60);
    }
}

test('prototype starts at a shielded station with no owned planets and pays one cargo per minute', () => {
    const world = createWorld('prototype', 0);
    assert.equal(world.player.homeId, starterStations[0].id);
    assert.equal(planetBodies.filter(body => world.planets[body.id].owner).length, 0);
    world.player.fuel = 20;
    advance(world, 59);
    assert.equal(world.player.cargo, 0);
    advance(world, 1.01);
    assert.equal(world.player.cargo, 1);
    assert.equal(world.player.fuel, 100);
    assert.ok(interact(world, world.player.homeId).ok);
    assert.ok(nextRocketUpgrade(world).available);
});

test('four seconds of aimed capture earns a planet without attaching or teleporting', () => {
    const world = createWorld('capture', 0);
    captureMoon(world, 4.1);
    assert.equal(world.planets.moon.owner, world.player.id);
    assert.equal(world.player.docked, null);
    assert.equal(world.stats.captures, 1);
});

test('releasing E or aiming away cancels partial progress', () => {
    const world = createWorld('cancel', 0);
    captureMoon(world, 1);
    assert.ok(world.hack.progress > 0);
    stepWorld(world, {});
    assert.equal(world.hack, null);
    captureMoon(world, 1);
    stepWorld(world, { capture: true, captureBody: 'moon', aimAngle: -Math.PI / 2 });
    assert.equal(world.hack, null);
    assert.equal(world.planets.moon.owner, null);
});

test('active turrets block capture and disabled turrets permit progress', () => {
    const world = createWorld('defenses', 0);
    world.planets.moon.level = 1;
    world.planets.moon.owner = 'hostile';
    captureMoon(world, 0.2);
    assert.equal(world.hack, null);
    world.planets.moon.turrets[0].disabledUntil = world.elapsed + 10;
    captureMoon(world, 0.2);
    assert.ok(world.hack.progress > 0);
});

test('multiplayer reserves different stations and validates fractional capture saves', () => {
    const room = new GameRoom(null, 1000);
    const one = room.join('', 1000), two = room.join('', 1000);
    assert.notEqual(room.world.players[one.playerId].player.homeId, room.world.players[two.playerId].player.homeId);
    assert.ok(Object.values(room.world.players).every(actor => actor.player.homeId.startsWith('station-')));
    const actor = room.world.players[one.playerId];
    actor.hack = { bodyId: 'moon', digit: 0, progress: 0.5, required: 4 };
    assert.doesNotThrow(() => validateSave(room.saved()));
    assert.equal(room.setInput(one.playerId, { burn: false, fire: false, rcsX: 0, rcsY: 0, aimAngle: 0, capture: true, captureBody: 'not-a-planet' }), false);
});
