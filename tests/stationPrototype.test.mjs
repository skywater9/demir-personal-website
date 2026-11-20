import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, bodies, planetBodies, starterStations, stepWorld, interact, dockingPoint, nextRocketUpgrade, hackDigit, tuning, dockingStatus } from '../public/scripts/conquestPhysics.mjs';
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

// Place a pilot farther out, facing away, and establish a cursor-targeted hack.
function startMoonHack(world) {
    const moon = bodies.find(body => body.id === 'moon');
    Object.assign(world.player, { landedOn: null, docked: null, x: moon.x, y: moon.y - moon.radius - tuning.shipRadius - 200,
        vx: 0, vy: 0, angle: Math.PI, aimAngle: -Math.PI / 2 });
    return interact(world, moon.id);
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

test('E starts a 1–4 challenge from 200 m without matching the rocket heading', () => {
    const world = createWorld('capture', 0);
    assert.ok(startMoonHack(world).ok);
    assert.ok(world.hack.digit >= 1 && world.hack.digit <= 4);
    advance(world, 0.2, { captureBody: 'moon' });
    assert.equal(world.hack.progress, 0, 'time alone must not advance hacking');
    for (let index = 0; index < 4; index++) {
        assert.ok(hackDigit(world, world.hack.digit).ok);
        hackDigit(world, null);
        advance(world, 0.15, { captureBody: 'moon' });
    }
    assert.equal(world.planets.moon.owner, world.player.id);
    assert.equal(world.player.docked, null);
    assert.equal(world.stats.captures, 1);
});

test('wrong or repeated digits do not advance capture; losing the cursor cancels it', () => {
    const world = createWorld('cancel', 0);
    startMoonHack(world);
    assert.equal(hackDigit(world, 9).ok, false);
    assert.equal(world.hack.progress, 0);
    assert.ok(hackDigit(world, world.hack.digit).ok);
    assert.equal(hackDigit(world, world.hack.digit, { repeat: true }).ok, false);
    assert.equal(world.hack.progress, 1);
    advance(world, 0.1, { captureBody: null });
    assert.equal(world.hack, null);
});

test('active turrets block capture and disabled turrets permit starting a challenge', () => {
    const world = createWorld('defenses', 0);
    Object.assign(world.planets.moon, { owner: 'hostile', level: 1,
        turrets: [{ health: 5, disabledUntil: 0, angle: 0, nextShotAt: 0 }] });
    assert.equal(startMoonHack(world).ok, false);
    world.planets.moon.turrets[0].disabledUntil = world.elapsed + 10;
    assert.ok(startMoonHack(world).ok);
    assert.ok(world.hack);
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

// High-speed flybys remain eligible while station docking still needs a safe speed.
test('planet capture accepts high speed and arbitrary heading', () => {
    const world = createWorld('flyby', 0);
    startMoonHack(world);
    world.hack = null;
    Object.assign(world.player, { vx: 700, vy: -250, angle: 2 });
    assert.equal(dockingStatus(world, 'moon').ready, true);
    assert.ok(interact(world, 'moon').ok);
    assert.ok(hackDigit(world, world.hack.digit).ok);
    const station = bodies.find(body => body.id === world.player.homeId);
    Object.assign(world.player, dockingPoint(station));
    assert.equal(dockingStatus(world, station.id).ready, false);
});
