import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, bodies, planetBodies, systems, fuelZone, blackHole, turretPositions,
    dockingStatus, interact, upgradePlanet, stepWorld, gravityAt, tuning } from '../public/scripts/conquestPhysics.mjs';

// Isolate service checks from surface collisions while retaining normal movement rules.
function ownedMoon() {
    const world = createWorld('services', 0);
    const body = bodies.find(body => body.id === 'moon');
    world.planets.moon.owner = world.player.id;
    Object.assign(world.player, { x: body.x, y: body.y - body.radius - 140, landedOn: null, docked: null,
        vx: 150, vy: 20, angle: 1.7, cargo: 30 });
    return { world, body };
}

test('planet shops preserve position, velocity and orientation and charge only valid purchases', () => {
    const { world } = ownedMoon();
    const before = { ...world.player };
    assert.ok(interact(world, 'moon').ok);
    assert.equal(world.player.shoppingOn, 'moon');
    assert.equal(world.player.docked, null);
    for (const key of ['x', 'y', 'vx', 'vy', 'angle']) assert.equal(world.player[key], before[key]);
    assert.ok(upgradePlanet(world).ok);
    assert.equal(world.planets.moon.level, 1);
    assert.equal(world.player.cargo, before.cargo - tuning.upgradeCosts[0]);
    assert.ok(interact(world).ok);
    assert.equal(world.player.shoppingOn, null);
});

test('the visible fuel rectangle refuels at arbitrary rotation while outside it does not', () => {
    const { world, body } = ownedMoon();
    const zone = fuelZone(body);
    Object.assign(world.player, { x: body.x, y: (zone.top + zone.bottom) / 2, fuel: 20, vx: 0, vy: 0, angle: Math.PI });
    stepWorld(world, {}, 0.1);
    assert.ok(world.player.fuel > 20);
    Object.assign(world.player, { x: zone.right + 80, y: zone.top, fuel: 20, vx: 0, vy: 0 });
    stepWorld(world, {}, 0.1);
    assert.equal(world.player.fuel, 20);
});

test('home station docking works throughout the shield at high speed and any heading', () => {
    const world = createWorld('station', 0);
    const station = bodies.find(body => body.id === world.player.homeId);
    Object.assign(world.player, { x: station.x + station.radius + tuning.homeShieldAltitude - 1, y: station.y,
        landedOn: null, vx: -900, vy: 300, angle: 2.3 });
    assert.equal(dockingStatus(world, station.id).ready, true);
    assert.ok(interact(world, station.id).ok);
    assert.equal(world.player.docked, station.id);
});

test('all three turret slots avoid every planet fuel box', () => {
    for (const body of planetBodies) {
        const zone = fuelZone(body);
        for (const turret of turretPositions(body, 3)) {
            const nearestX = Math.max(zone.left, Math.min(zone.right, turret.x));
            const nearestY = Math.max(zone.top, Math.min(zone.bottom, turret.y));
            assert.ok(Math.hypot(turret.x - nearestX, turret.y - nearestY) > tuning.turretRadius, body.id);
        }
    }
});

test('fast death cargo bounces instead of tunneling through the planet', () => {
    const world = createWorld('bounce', 0), moon = bodies.find(body => body.id === 'moon');
    world.player.deadUntil = 999;
    world.pickups.push({ id: 'death-drop', x: moon.x, y: moon.y - moon.radius - 30, vx: 0, vy: 20000, amount: 5, expiresAt: 100 });
    stepWorld(world, {}, 0.03);
    assert.equal(world.pickups.length, 1);
    const pod = world.pickups[0];
    assert.ok(pod.vy < 0);
    assert.ok(pod.y < moon.y - moon.radius);
});

test('black hole lies between the three systems and its core is lethal', () => {
    assert.equal(systems.length, 3);
    assert.equal(blackHole.x, systems.reduce((sum, system) => sum + system.x, 0) / 3);
    assert.equal(blackHole.y, systems.reduce((sum, system) => sum + system.y, 0) / 3);
    assert.ok(gravityAt(blackHole.x + blackHole.radius + 100, blackHole.y).ax < 0);
    const world = createWorld('hole', 0);
    Object.assign(world.player, { x: blackHole.x, y: blackHole.y, landedOn: null, docked: null });
    stepWorld(world);
    assert.equal(world.stats.deaths, 1);
});
