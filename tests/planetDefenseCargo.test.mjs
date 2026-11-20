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
    assert.equal(world.planets[body.id].turrets[0].angle, angle);
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
