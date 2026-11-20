import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, planetBodies, starterStations, tuning, blackHole, systems, celestialBodies, capturePressesRequired, interact, capturePress, stepWorld,
    upgradeRocket, upgradeWeapon, upgradePlanet, nextRocketUpgrade, nextWeaponUpgrade, boosterStats, weaponStats,
    killPlayer, planetShield, turretPositions, repairTurrets, turretRepairStatus, canCollectCargo, migrateUpgradeTracks } from '../public/scripts/conquestPhysics.mjs';
import { GameRoom } from '../server/room.mjs';
import { validateSave } from '../server/persistence.mjs';

// Open an owned planet shop without changing the ship's flight state.
function ownedShop() {
    const world = createWorld('tracks', 0), body = planetBodies.find(body => body.id === 'moon');
    Object.assign(world.player, { x: body.x, y: body.y - body.radius - 150, landedOn: null, docked: null, cargo: 10000 });
    world.planets[body.id].owner = world.player.id;
    assert.ok(interact(world, body.id).ok);
    return { world, body, planet: world.planets[body.id] };
}

// Place a ship in empty space to isolate propulsion and weapon behavior from gravity and collisions.
function openSpace(world, extra = {}) {
    Object.assign(world.player, { x: 50000, y: 50000, vx: 0, vy: 0, angle: 0, aimAngle: 0,
        landedOn: null, docked: null, shoppingOn: null, ...extra });
}

test('owned planets sell independent ten-level BOOSTER and WEAPON tracks; home sells both', () => {
    assert.deepEqual(tuning.upgradeCosts, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    assert.deepEqual(tuning.rocketUpgradeCosts, tuning.upgradeCosts);
    const { world } = ownedShop();
    for (let level = 1; level <= 10; level++) {
        const previousWeapon = world.player.weaponTier;
        assert.ok(upgradeRocket(world).ok); assert.equal(world.player.weaponTier, previousWeapon);
        assert.ok(upgradeWeapon(world).ok); assert.equal(world.player.rocketTier, level);
        assert.equal(world.player.weaponTier, level);
    }
    const cargo = world.player.cargo;
    assert.equal(upgradeRocket(world).ok, false); assert.equal(upgradeWeapon(world).ok, false);
    assert.equal(world.player.cargo, cargo);
    const station = starterStations[0];
    world.player.shoppingOn = null; world.player.docked = station.id;
    world.player.rocketTier = 0; world.player.weaponTier = 0;
    assert.ok(nextRocketUpgrade(world).available); assert.ok(nextWeaponUpgrade(world).available);
    assert.equal(upgradePlanet(world).ok, false);
    world.planets[station.id].owner = 'enemy';
    assert.equal(upgradeRocket(world).ok, false); assert.equal(upgradeWeapon(world).ok, false);
});

test('booster gains increase smoothly, fade at high speed and reduce measured fuel use', () => {
    let priorBonus = 0, priorFuel = 1;
    for (let level = 1; level <= 10; level++) {
        const stats = boosterStats({ rocketTier: level, vx: 0, vy: 0 });
        assert.ok(stats.bonus > priorBonus); assert.ok(stats.fuelFactor < priorFuel);
        priorBonus = stats.bonus; priorFuel = stats.fuelFactor;
    }
    assert.ok(boosterStats({ rocketTier: 10, vx: 10000, vy: 0 }).bonus < .001);
    const base = createWorld('base', 0), upgraded = createWorld('boosted', 0);
    openSpace(base); openSpace(upgraded, { rocketTier: 10 });
    stepWorld(base, { burn: true }, .1); stepWorld(upgraded, { burn: true }, .1);
    assert.ok(-upgraded.player.vy > -base.player.vy * 2);
    assert.ok(100 - upgraded.player.fuel < (100 - base.player.fuel) * .7);
    assert.deepEqual(weaponStats(base.player), weaponStats(upgraded.player));
});

test('weapon milestones produce twin shots at three, alternating barrels at five and a laser at ten', () => {
    let previous = weaponStats({ weaponTier: 0 });
    for (let level = 1; level <= 10; level++) {
        const current = weaponStats({ weaponTier: level });
        assert.ok(current.cooldown < previous.cooldown); assert.ok(current.heat < previous.heat);
        assert.ok(current.lifetime > previous.lifetime); previous = current;
    }
    for (const [level, count] of [[0, 1], [2, 1], [3, 2], [4, 2], [5, 1]]) {
        const world = createWorld(`weapon-${level}`, 0);
        openSpace(world, { weaponTier: level }); stepWorld(world, { fire: true });
        assert.equal(world.projectiles.length, count);
        if (level === 5) {
            const first = Math.sign(world.projectiles[0].y - world.player.y);
            world.projectiles = []; world.elapsed = world.player.nextShotAt;
            stepWorld(world, { fire: true });
            assert.equal(Math.sign(world.projectiles[0].y - world.player.y), -first);
        }
    }
});

test('laser reaches a distant rocket instantly, stops at the first target and does not damage again during its flash', () => {
    const room = new GameRoom(null, 1000);
    const ids = [room.join('', 1000), room.join('', 1000), room.join('', 1000)].map(joined => joined.playerId);
    ids.forEach((id, index) => Object.assign(room.world.players[id].player,
        { x: 50000 + index * 5000, y: 50000, vx: 0, vy: 0, docked: null, landedOn: null, aimAngle: 0 }));
    room.world.players[ids[0]].player.weaponTier = 10;
    room.setInput(ids[0], { burn: false, rcsX: 0, rcsY: 0, fire: true, aimAngle: 0 }, 1000); room.tick(1 / 60, 1000);
    assert.equal(room.world.players[ids[1]].player.fuel, 100 - tuning.playerShotFuelDamage);
    assert.equal(room.world.players[ids[2]].player.fuel, 100);
    const beam = room.world.projectiles.find(shot => shot.laser);
    assert.ok(beam.resolved); assert.equal(beam.color, room.world.players[ids[0]].player.color);
    assert.ok(beam.x < room.world.players[ids[1]].player.x);
    room.setInput(ids[0], { burn: false, rcsX: 0, rcsY: 0, fire: false, aimAngle: 0 }, 1000); room.tick(.05, 1000);
    assert.equal(room.world.players[ids[1]].player.fuel, 100 - tuning.playerShotFuelDamage);
    assert.doesNotThrow(() => validateSave(room.saved()));
});

test('player shots deal more damage and connect through a slightly larger hit radius', () => {
    const room = new GameRoom(null, 1000);
    const [attacker, target] = [room.join('', 1000), room.join('', 1000)].map(joined => joined.playerId);
    const player = room.world.players[target].player;
    Object.assign(room.world.players[attacker].player, { x: 49000, y: 50000, landedOn: null, docked: null });
    Object.assign(player, { x: 50000, y: 50000, vx: 0, vy: 0, landedOn: null, docked: null });
    room.world.projectiles.push({ id: 'grazing-player-shot', source: 'player', owner: attacker,
        x: 49800, y: 50000 + tuning.shipRadius + tuning.bulletRadius + 3,
        vx: 30000, vy: 0, radius: tuning.bulletRadius, expiresAt: 10 });
    room.tick(1 / 60, 1000);
    assert.equal(player.fuel, 100 - tuning.playerShotFuelDamage);
});

test('death removes one level from each track and preserves both loss indicators', () => {
    const world = createWorld('death', 0);
    world.player.rocketTier = 7; world.player.weaponTier = 10;
    killPlayer(world, 'Test impact');
    assert.equal(world.player.rocketTier, 6); assert.equal(world.player.weaponTier, 9);
    assert.equal(world.player.lastLostTier, 7); assert.equal(world.player.lastLostWeaponTier, 10);
    const event = world.events.find(event => event.type === 'died');
    assert.equal(event.previousWeaponTier, 10); assert.equal(event.weaponTier, 9);
});

test('E capture decays to zero when idle, rejects repeats and gains access throughout the upgraded shield', () => {
    const { world, body, planet } = ownedShop();
    for (let index = 0; index < 5; index++) upgradePlanet(world);
    Object.assign(world.player, { x: body.x + planetShield(body, planet).radius - 10, y: body.y, shoppingOn: null });
    assert.ok(interact(world, body.id).ok, 'owned shop opens at the grown boundary');
    world.player.shoppingOn = null; planet.owner = 'enemy';
    planet.turrets.forEach(turret => { turret.health = 0; });
    assert.ok(interact(world, body.id).ok);
    const required = world.hack.required;
    assert.ok(required > tuning.hackBasePresses);
    assert.ok(capturePress(world).ok); assert.equal(capturePress(world, { repeat: true }).ok, false);
    for (let index = 0; index < 3; index++) stepWorld(world, {}, 1);
    assert.equal(world.hack.progress, 0);
    world.player.x = body.x + planetShield(body, planet).radius + 20;
    stepWorld(world, {}, .01); assert.equal(world.hack, null);
});

test('stars and the black hole use extended E captures and begin with one floating defense', () => {
    for (const body of [...systems, blackHole]) {
        const world = createWorld(`capture-${body.id}`, 0);
        Object.assign(world.player, { x: body.x, y: body.y - body.radius - 400,
            vx: 0, vy: 0, landedOn: null, docked: null, shoppingOn: null });
        const expectedMultiplier = body.id === blackHole.id ? 3 : 2;
        assert.equal(capturePressesRequired(body), tuning.hackBasePresses * expectedMultiplier);
        assert.ok(interact(world, body.id).ok);
        assert.equal(world.hack.required, capturePressesRequired(body));
        while (world.hack) {
            world.elapsed += tuning.hackPressInterval + .01;
            assert.ok(capturePress(world).ok);
        }
        assert.equal(world.planets[body.id].owner, world.player.id);
        assert.equal(world.planets[body.id].level, 1);
        assert.equal(world.planets[body.id].turrets.length, 1);
        assert.equal(world.planets[body.id].capturedAt, world.elapsed);
        assert.equal(world.planets[body.id].recaptureAt, world.elapsed + tuning.recaptureCooldown);
    }
    assert.equal(celestialBodies.length, systems.length + 1);
});

test('fresh hostile capture shield pushes rockets away and locks recapture for five seconds', () => {
    const world = createWorld('capture-push', 0);
    const body = planetBodies.find(candidate => candidate.id === 'moon');
    Object.assign(world.planets[body.id], { owner: 'enemy', level: 1,
        capturedAt: 2, recaptureAt: 7, turrets: [{ health: 0, angle: 0, disabledUntil: 0, nextShotAt: 0 }] });
    Object.assign(world.player, { x: body.x + body.radius + 120, y: body.y,
        vx: 0, vy: 0, landedOn: null, docked: null, shoppingOn: null });
    world.elapsed = 3;
    stepWorld(world, {}, .1);
    assert.ok(world.player.vx > 0, 'the fresh shield should push the enemy rocket outward');
    assert.equal(interact(world, body.id).reason, 'CAPTURE COOLDOWN');
    world.elapsed = 7;
    world.planets[body.id].turrets[0].health = 0;
    assert.ok(interact(world, body.id).ok, 'capture becomes available once the timer ends and defenses are down');
});

test('capture begins with a smaller field than the original neutral capture radius', () => {
    const body = planetBodies.find(candidate => candidate.id === 'moon');
    const freshField = planetShield(body, { level: 1 });
    assert.equal(tuning.smallShieldAltitude, 190);
    assert.equal(freshField.altitude, 220);
    assert.ok(freshField.altitude < tuning.hackingDistance + tuning.shipRadius);
    assert.equal(planetShield(body, { level: 10 }).altitude, freshField.altitude + 9 * 30);
});

test('capture preserves banked and floating cargo for collection by the new owner without crediting their ship', () => {
    const { world, body, planet } = ownedShop();
    world.player.shoppingOn = null;
    Object.assign(planet, { owner: 'enemy', level: 2, stock: 7,
        turrets: Array.from({ length: 2 }, () => ({ health: 0, angle: 0, disabledUntil: 0, nextShotAt: 0 })) });
    const pod = { id: 'planet-cargo', bodyId: body.id, x: body.x + body.radius + 50, y: body.y, vx: 0, vy: 0, amount: 3, expiresAt: 100 };
    world.pickups = [pod]; const carried = world.player.cargo;
    assert.equal(canCollectCargo(world, pod), false); assert.ok(interact(world, body.id).ok);
    while (world.hack) { world.elapsed += .11; assert.ok(capturePress(world).ok); }
    assert.equal(planet.level, 1); assert.equal(planet.stock, 7);
    assert.equal(planet.turrets.length, 1); assert.equal(planet.turrets[0].health, 1);
    assert.equal(world.player.cargo, carried); assert.equal(world.pickups[0], pod);
    assert.equal(canCollectCargo(world, pod), true);
});

test('one repair button requires all cooldowns and total cargo and blocks upgrades until the guns are repaired', () => {
    const { world, planet } = ownedShop();
    upgradePlanet(world); upgradePlanet(world);
    planet.turrets.forEach((turret, index) => Object.assign(turret, { health: 0, repairAt: 5 + index }));
    assert.equal(upgradePlanet(world).ok, false);
    world.elapsed = 5; assert.equal(repairTurrets(world).ok, false);
    world.elapsed = 6; world.player.cargo = 7;
    assert.equal(turretRepairStatus(world).cost, 8);
    assert.equal(repairTurrets(world).ok, false); assert.ok(planet.turrets.every(turret => turret.health === 0));
    world.player.cargo = 100;
    assert.ok(repairTurrets(world).ok); assert.equal(world.player.cargo, 92);
    assert.ok(planet.turrets.every(turret => turret.health === 1)); assert.ok(upgradePlanet(world).ok);
});

test('new turrets beyond level five get twin barrels, and repairs preserve their type', () => {
    const { world, planet } = ownedShop();
    for (let index = 0; index < 10; index++) upgradePlanet(world);
    assert.ok(planet.turrets.slice(0, 5).every(turret => !turret.double));
    assert.ok(planet.turrets.slice(5).every(turret => turret.double));
    Object.assign(planet.turrets[5], { health: 0, repairAt: 0 });
    assert.ok(repairTurrets(world).ok); assert.equal(planet.turrets[5].double, true);
});

test('black hole cargo orbits outside the lethal core, is worth ten and is collectible without ownership', () => {
    const world = createWorld('black-hole-cargo', 0);
    world.elapsed = 10; stepWorld(world);
    const pod = world.pickups.find(pickup => pickup.blackHoleOrbit);
    assert.ok(pod); assert.equal(pod.amount, 10); assert.ok(canCollectCargo(world, pod));
    const initial = { x: pod.x, y: pod.y };
    stepWorld(world, {}, .5);
    assert.ok(Math.hypot(pod.x - initial.x, pod.y - initial.y) > 1);
    assert.ok(Math.abs(Math.hypot(pod.x - blackHole.x, pod.y - blackHole.y) - pod.orbitRadius) < 1e-6);
    Object.assign(world.player, { x: pod.x, y: pod.y, vx: 0, vy: 0, docked: null, landedOn: null });
    const cargo = world.player.cargo; stepWorld(world, {}, .001);
    assert.equal(world.player.cargo, cargo + 10);
});

test('legacy levels migrate once without erasing territory or cargo and clamp planets to ten', () => {
    const world = createWorld('migration', 0);
    delete world.upgradeTracksVersion; delete world.player.weaponTier;
    world.player.rocketTier = 4; world.player.cargo = 23;
    Object.assign(world.planets.moon, { owner: world.player.id, level: 20, stock: 7,
        turrets: Array.from({ length: 20 }, () => ({ health: 1 })) });
    migrateUpgradeTracks(world);
    assert.equal(world.player.weaponTier, 5); assert.equal(world.player.rocketTier, 4);
    assert.equal(world.planets.moon.level, 10); assert.equal(world.planets.moon.turrets.length, 10);
    assert.equal(world.player.cargo, 23); assert.equal(world.planets.moon.stock, 7);
    world.player.weaponTier = 9; migrateUpgradeTracks(world);
    assert.equal(world.player.weaponTier, 9);
});

// A nearby owned world should help its neighbor rather than chase a closer non-intruding ship.
test('adjacent owned turrets prioritize enemies inside another friendly planet shield within range', () => {
    const room = new GameRoom(null, 1000);
    const [owner, near, intruder] = [room.join('', 1000), room.join('', 1000), room.join('', 1000)].map(joined => joined.playerId);
    const earth = planetBodies.find(body => body.id === 'earth'), moon = planetBodies.find(body => body.id === 'moon');
    Object.assign(room.world.planets.earth, { owner, level: 1 });
    room.world.planets.moon.owner = owner;
    const gun = turretPositions(earth, 1)[0];
    Object.assign(room.world.players[near].player, { x: gun.x + 380, y: gun.y, vx: 0, vy: 0, landedOn: null, docked: null });
    Object.assign(room.world.players[intruder].player, { x: moon.x + 300, y: moon.y, vx: 0, vy: 0, landedOn: null, docked: null });
    room.tick(1 / 60, 1000);
    assert.equal(room.world.projectiles.find(shot => shot.bodyId === earth.id).targetId, intruder);
    room.world.planets.moon.owner = null;
    room.world.projectiles = []; room.world.planets.earth.turrets[0].nextShotAt = 0;
    room.tick(1 / 60, 1000);
    assert.equal(room.world.projectiles.find(shot => shot.bodyId === earth.id).targetId, near);
});

// The newly purchased sixth gun fires both barrels while earlier defenses remain single guns.
test('a newly added level-six turret actually fires two hostile projectiles', () => {
    const { world, body, planet } = ownedShop();
    for (let index = 0; index < 6; index++) upgradePlanet(world);
    planet.owner = 'enemy'; world.player.shoppingOn = null;
    const gun = turretPositions(body, 6)[5];
    Object.assign(world.player, { x: gun.x + Math.cos(gun.angle) * 300,
        y: gun.y + Math.sin(gun.angle) * 300, landedOn: null, docked: null });
    stepWorld(world);
    assert.equal(world.projectiles.filter(shot => shot.source === 'turret' && shot.turretIndex === 5).length, 2);
});
