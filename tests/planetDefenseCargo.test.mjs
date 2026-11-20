import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../server/room.mjs';
import { createWorld, planetBodies, tuning, stepWorld, turretPositions, dockingStatus } from '../public/scripts/conquestPhysics.mjs';

// Keep targeted fixtures away from services so only the requested planet rules affect them.
function spaceWorld() {
    const world = createWorld('defense-cargo', 0);
    Object.assign(world.player, { x: 50000, y: 50000, vx: 0, vy: 0, landedOn: null, docked: null });
    return world;
}

// Advance actual fixed-step simulation with powered braking to keep the collecting pilot stationary.
function advance(world, seconds) {
    while (seconds > 1e-8) {
        const dt = Math.min(1 / 60, seconds);
        stepWorld(world, { rcsY: 1 }, dt);
        seconds -= dt;
    }
}

// Create a planet-associated pod without spawning extra economy resources in the test.
function pod(body, x, y, orbiting = false) {
    return { id: 'test-pod', bodyId: body.id, x, y, vx: 0, vy: 0, amount: 1, orbiting, expiresAt: 100 };
}

test('turret leads a moving rocket and shares the exact firing angle with its head', () => {
    const world = spaceWorld();
    const body = planetBodies.find(body => body.id === 'moon');
    Object.assign(world.planets[body.id], { owner: 'enemy', level: 1 });
    const origin = turretPositions(body, 1)[0];
    Object.assign(world.player, { x: origin.x + 400, y: origin.y - 100, vy: 60 });
    stepWorld(world);
    const shot = world.projectiles.find(shot => shot.source === 'turret');
    assert.ok(shot);
    const target = world.player;
    const dx = target.x - origin.x, dy = target.y - origin.y;
    const rx = shot.vx - target.vx, ry = shot.vy - target.vy;
    const time = (dx * rx + dy * ry) / (rx * rx + ry * ry);
    assert.ok(time > 0 && time < tuning.bulletLifetime);
    assert.ok(Math.hypot(origin.x + shot.vx * time - target.x - target.vx * time,
        origin.y + shot.vy * time - target.y - target.vy * time) < 1e-6);
    const angle = Math.atan2(shot.vy, shot.vx);
    assert.ok(Math.abs(angle - Math.atan2(dy, dx)) > .1);
    assert.ok(Math.abs(world.planets[body.id].turrets[0].angle - angle) < 1e-9);
});

test('unreachable fast targets still produce finite shots at the configured bullet speed', () => {
    const world = spaceWorld();
    const body = planetBodies.find(body => body.id === 'moon');
    Object.assign(world.planets[body.id], { owner: 'enemy', level: 1 });
    const origin = turretPositions(body, 1)[0];
    Object.assign(world.player, { x: origin.x + 400, y: origin.y - 100, vx: 600, vy: 400 });
    stepWorld(world);
    const shot = world.projectiles.find(shot => shot.source === 'turret');
    assert.ok(shot);
    assert.ok(Number.isFinite(shot.vx) && Number.isFinite(shot.vy));
    assert.ok(Math.abs(Math.hypot(shot.vx, shot.vy) - tuning.turretBulletSpeed) < 1e-8);
});

test('inner bubble edge exactly matches the displayed capture range and interaction boundary', () => {
    const world = spaceWorld();
    const body = planetBodies.find(body => body.id === 'moon');
    const radius = body.radius + tuning.smallShieldAltitude;
    assert.equal(radius, body.radius + tuning.shipRadius + tuning.hackingDistance);
    Object.assign(world.player, { x: body.x + radius, y: body.y });
    assert.equal(dockingStatus(world, body.id).distance, tuning.hackingDistance);
    assert.equal(dockingStatus(world, body.id).ready, true);
    world.player.x += 1;
    assert.equal(dockingStatus(world, body.id).ready, false);
});

test('bubble occupants gently draw that planet cargo from beyond the normal pickup magnet', () => {
    const world = spaceWorld();
    const body = planetBodies.find(body => body.id === 'moon');
    world.planets[body.id].owner = world.player.id;
    Object.assign(world.player, { x: body.x, y: body.y - body.radius - 220 });
    const radius = body.radius + 100;
    const pickup = pod(body, body.x + Math.cos(-Math.PI / 6) * radius, body.y + Math.sin(-Math.PI / 6) * radius);
    const initialDistance = Math.hypot(pickup.x - world.player.x, pickup.y - world.player.y);
    assert.ok(initialDistance > tuning.cargoAttractionRadius);
    world.pickups.push(pickup);
    advance(world, .1);
    assert.ok(Math.hypot(pickup.vx, pickup.vy) > 0);
    assert.ok(Math.hypot(pickup.vx, pickup.vy) <= tuning.cargoBubbleAcceleration * .1 + 1e-6);
    assert.ok(Math.hypot(pickup.x - world.player.x, pickup.y - world.player.y) < initialDistance);
    advance(world, 3);
    assert.ok(Math.hypot(pickup.vx, pickup.vy) <= tuning.cargoBubbleSpeed + 1e-6);
});

test('outside the bubble distant cargo retains its drift without the planet-wide pull', () => {
    const world = spaceWorld();
    const body = planetBodies.find(body => body.id === 'moon');
    world.planets[body.id].owner = world.player.id;
    Object.assign(world.player, { x: body.x, y: body.y - body.radius - tuning.smallShieldAltitude - 50 });
    const pickup = pod(body, body.x, body.y + body.radius + 90);
    world.pickups.push(pickup);
    stepWorld(world);
    assert.equal(pickup.vx, 0); assert.equal(pickup.vy, 0);
});

test('pods on the far side travel around the planet and can be collected without tunneling', () => {
    const world = spaceWorld();
    const body = planetBodies.find(body => body.id === 'moon');
    world.planets[body.id].owner = world.player.id;
    Object.assign(world.player, { x: body.x + body.radius + 190, y: body.y });
    const pickup = pod(body, body.x - body.radius - 90, body.y, true);
    world.pickups.push(pickup);
    for (let index = 0; index < 2400 && world.pickups.includes(pickup); index++) {
        advance(world, 1 / 60);
        assert.ok(Math.hypot(pickup.x - body.x, pickup.y - body.y) >= body.radius + 4.9);
    }
    assert.ok(!world.pickups.includes(pickup), 'The routed pod should reach the pilot within its lifetime.');
    assert.ok(world.stats.cargoCollected >= 1);
});

// An ineligible closer ship must not prevent the planet-wide pull for a pilot inside the bubble.
test('multiplayer bubble cargo selects a nearby eligible pilot rather than a distant outside rival', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    const body = planetBodies.find(body => body.id === 'moon');
    room.world.planets[body.id].owner = a.playerId;
    const owner = room.world.players[a.playerId].player, rival = room.world.players[b.playerId].player;
    Object.assign(owner, { x: body.x + body.radius + 190, y: body.y, vx: 0, vy: 0, landedOn: null, docked: null });
    Object.assign(rival, { x: body.x - body.radius - tuning.smallShieldAltitude - 60,
        y: body.y, vx: 0, vy: 0, landedOn: null, docked: null });
    const pickup = pod(body, body.x - body.radius - 90, body.y);
    room.world.pickups.push(pickup);
    assert.ok(Math.hypot(rival.x - pickup.x, rival.y - pickup.y) > tuning.cargoAttractionRadius);
    room.tick(.1, 1000);
    assert.ok(Math.abs(pickup.vy) > .01, 'The pod should take the route around the planet toward its eligible collector.');
});


test('planet cargo cannot escape its bubble even at high speed or when restored outside it', () => {
    const world = spaceWorld();
    const body = planetBodies.find(body => body.id === 'moon');
    world.planets.moon.owner = world.player.id;
    const limit = body.radius + tuning.smallShieldAltitude - 5;
    const pickup = pod(body, body.x + limit - .01, body.y);
    pickup.vx = 50000;
    world.pickups.push(pickup);
    stepWorld(world);
    assert.ok(Math.hypot(pickup.x - body.x, pickup.y - body.y) <= limit + 1e-8);
    assert.ok(pickup.vx <= 1e-8);
    pickup.x = body.x + limit + 1000; pickup.vx = -10;
    stepWorld(world);
    assert.ok(Math.hypot(pickup.x - body.x, pickup.y - body.y) <= limit + 1e-8);
});

test('rivals cannot attract or collect planet cargo and capture transfers access to its new owner', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    const body = planetBodies.find(body => body.id === 'moon');
    const owner = room.world.players[a.playerId].player, rival = room.world.players[b.playerId].player;
    room.world.planets.moon.owner = a.playerId;
    Object.assign(owner, { x: 50000, y: 50000, landedOn: null, docked: null });
    const pickup = pod(body, body.x + body.radius + 100, body.y);
    Object.assign(rival, { x: pickup.x, y: pickup.y, vx: 0, vy: 0, landedOn: null, docked: null });
    pickup.amount = 3; room.world.pickups.push(pickup);
    room.tick(.1, 1000);
    assert.equal(rival.cargo, 0); assert.ok(room.world.pickups.includes(pickup));
    assert.equal(pickup.vx, 0); assert.equal(pickup.vy, 0);
    room.world.planets.moon.owner = b.playerId;
    room.tick(tuning.fixedStep, 1000);
    assert.equal(rival.cargo, 3); assert.equal(owner.cargo, 0);
    assert.ok(!room.world.pickups.includes(pickup));
});

test('the owner pulls cargo much more strongly closer to the planet surface', () => {
    const speeds = [];
    for (const altitude of [50, 240]) {
        const world = spaceWorld();
        const body = planetBodies.find(body => body.id === 'moon');
        world.planets.moon.owner = world.player.id;
        Object.assign(world.player, { x: body.x + body.radius + altitude, y: body.y });
        const pickup = pod(body, body.x + body.radius + 100, body.y - 180);
        world.pickups.push(pickup);
        advance(world, .1);
        speeds.push(Math.hypot(pickup.vx, pickup.vy));
    }
    assert.ok(speeds[0] > 8, 'Near-surface pull should be much stronger than the old 20 m/s² magnet.');
    assert.ok(speeds[0] > speeds[1] * 1.3);
});

test('turret homing turns gradually at bounded speed and leaves ordinary player shots unchanged', () => {
    const world = spaceWorld();
    Object.assign(world.player, { x: 50500, y: 50200 });
    const turret = { id: 'guided', source: 'turret', owner: 'enemy', targetId: world.player.id,
        x: 50000, y: 50000, vx: tuning.turretBulletSpeed, vy: 0, radius: 3, expiresAt: 5 };
    const bullet = { ...turret, id: 'unguided', source: 'player' };
    world.projectiles.push(turret, bullet);
    stepWorld(world);
    const angle = Math.atan2(turret.vy, turret.vx);
    assert.ok(angle > 0 && angle <= tuning.turretHomingRate * tuning.fixedStep + 1e-9);
    assert.ok(Math.abs(Math.hypot(turret.vx, turret.vy) - tuning.turretBulletSpeed) < 1e-8);
    assert.equal(bullet.vy, 0);
    world.player.deadUntil = 100;
    const previous = { vx: turret.vx, vy: turret.vy };
    stepWorld(world);
    assert.equal(turret.vx, previous.vx); assert.equal(turret.vy, previous.vy);
});

test('turrets fire again after the shortened interval and identify their original target', () => {
    const world = spaceWorld();
    const body = planetBodies.find(body => body.id === 'moon');
    Object.assign(world.planets.moon, { owner: 'enemy', level: 1 });
    const origin = turretPositions(body, 1)[0];
    Object.assign(world.player, { x: origin.x + 600, y: origin.y - 200 });
    stepWorld(world);
    assert.equal(world.projectiles[0].targetId, world.player.id);
    const firstCount = world.events.filter(event => event.type === 'turretFired').length;
    advance(world, 1.5);
    assert.ok(world.events.filter(event => event.type === 'turretFired').length > firstCount);
    assert.ok(tuning.turretCooldown < 2.4);
});
