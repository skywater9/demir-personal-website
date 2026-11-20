import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, planetBodies, tuning, interact, upgradePlanet, nextUpgrade, repairTurret,
    planetShield, turretPositions, stepWorld, capturePress } from '../public/scripts/conquestPhysics.mjs';
import { GameRoom } from '../server/room.mjs';
import { validateSave } from '../server/persistence.mjs';
import { validWorld } from '../public/scripts/conquestStorage.mjs';

// Prepare an owned shop with enough cargo to exercise all ten purchases.
function shop() {
    const world = createWorld('upgrades', 0);
    const body = planetBodies.find(body => body.id === 'moon');
    Object.assign(world.player, { x: body.x, y: body.y - body.radius - 150, vx: 0, vy: 0,
        landedOn: null, docked: null, cargo: 10000 });
    world.planets[body.id].owner = world.player.id;
    assert.ok(interact(world, body.id).ok);
    return { world, body, planet: world.planets[body.id] };
}

test('all ten upgrades add one evenly spaced gun and monotonically grow the soft shield', () => {
    const { world, body, planet } = shop();
    let radius = planetShield(body, planet).radius;
    for (let level = 1; level <= 10; level++) {
        const cost = nextUpgrade(world).cost, cargo = world.player.cargo;
        assert.ok(upgradePlanet(world).ok);
        assert.equal(world.player.cargo, cargo - cost);
        assert.equal(planet.level, level); assert.equal(planet.turrets.length, level);
        const field = planetShield(body, planet);
        assert.ok(field.radius > radius); assert.ok(field.retention > 0);
        radius = field.radius;
        const positions = turretPositions(body, level);
        for (let index = 1; index < level; index++) {
            assert.ok(Math.abs(positions[index].angle - positions[index - 1].angle - 2 * Math.PI / level) < 1e-10);
        }
    }
    const cargo = world.player.cargo;
    assert.equal(upgradePlanet(world).ok, false); assert.equal(world.player.cargo, cargo);
    assert.equal(validWorld(world), true);
});

test('repairs require cooldown, ownership, range and exact cargo; each gun is charged once', () => {
    const { world, body, planet } = shop();
    for (let index = 0; index < 10; index++) upgradePlanet(world);
    Object.assign(planet.turrets[7], { health: 0, repairAt: 5 });
    world.elapsed = 4.99;
    assert.equal(repairTurret(world, 7).ok, false);
    world.elapsed = 5; world.player.cargo = 19;
    assert.equal(repairTurret(world, 7).ok, false);
    world.player.cargo = 20;
    assert.equal(repairTurret(world, -1).ok, false);
    assert.equal(repairTurret(world, 7.5).ok, false);
    planet.owner = 'enemy'; assert.equal(repairTurret(world, 7).ok, false);
    planet.owner = world.player.id;
    world.player.x = body.x + planetShield(body, planet).radius + 5;
    assert.equal(repairTurret(world, 7).ok, false);
    world.player.x = body.x;
    assert.ok(repairTurret(world, 7).ok);
    assert.equal(world.player.cargo, 0); assert.equal(planet.turrets[7].health, 1);
    assert.equal(repairTurret(world, 7).ok, false);
    assert.equal(world.events.filter(event => event.type === 'turretRepaired').length, 1);
});

test('a standard direct shot crosses a level-ten shield and destroys a turret before expiry', () => {
    const { world, body, planet } = shop();
    for (let index = 0; index < 10; index++) upgradePlanet(world);
    planet.owner = 'enemy'; world.player.shoppingOn = null;
    const gun = turretPositions(body, 10)[0];
    const nx = Math.cos(gun.angle), ny = Math.sin(gun.angle);
    const radius = planetShield(body, planet).radius + 10;
    Object.assign(world.player, { x: body.x + nx * (radius + 100), y: body.y + ny * (radius + 100), landedOn: null });
    world.projectiles = [{ id: 'direct', source: 'player', owner: world.player.id,
        x: body.x + nx * radius, y: body.y + ny * radius, vx: -nx * 680, vy: -ny * 680,
        radius: 3, expiresAt: world.elapsed + tuning.bulletLifetime }];
    for (let index = 0; index < 300 && planet.turrets[0].health; index++) stepWorld(world, {}, 1 / 60);
    assert.equal(planet.turrets[0].health, 0);
    assert.ok(planet.turrets[0].repairAt > world.elapsed);
    assert.ok(world.events.some(event => event.type === 'turretDestroyed'));
});

test('multiplayer preserves capture after aim changes, resets on range loss, and persists level ten', () => {
    const room = new GameRoom(null, 1000);
    const { playerId } = room.join('', 1000);
    const actor = room.world.players[playerId], body = planetBodies.find(body => body.id === 'moon');
    Object.assign(actor.player, { x: body.x, y: body.y - body.radius - 150, docked: null, landedOn: null });
    assert.ok(room.action(playerId, { action: 'interact', bodyId: body.id }).ok);
    room.setInput(playerId, { captureBody: null, burn: false }, 1000);
    room.tick(.02, 1000); assert.ok(actor.hack);
    room.world.elapsed += .2;
    assert.ok(room.action(playerId, { action: 'capturePress', challengeId: actor.hack.challengeId }).ok);
    actor.player.x = body.x + body.radius + tuning.shipRadius + tuning.hackingDistance + 10;
    actor.player.y = body.y;
    room.tick(.02, 1000); assert.equal(actor.hack, null);
    Object.assign(actor.player, { x: body.x, y: body.y - body.radius - 150, cargo: 10000 });
    room.world.planets[body.id].owner = playerId;
    room.action(playerId, { action: 'interact', bodyId: body.id });
    for (let index = 0; index < 10; index++) assert.ok(room.action(playerId, { action: 'planetUpgrade' }).ok);
    Object.assign(room.world.planets[body.id].turrets[0], { health: 0, repairAt: room.world.elapsed + 5 });
    assert.doesNotThrow(() => validateSave(room.saved()));
    assert.equal(room.action(playerId, { action: 'repairTurret', turretIndex: 0 }).ok, false);
    room.world.elapsed += 5;
    assert.ok(room.action(playerId, { action: 'repairTurret', turretIndex: 0 }).ok);
    const saved = room.saved();
    const restored = new GameRoom(saved, 1000);
    assert.equal(restored.world.planets[body.id].level, 10);
    assert.equal(restored.world.planets[body.id].turrets[0].health, 1);
});
