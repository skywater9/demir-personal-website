import test from 'node:test';
import assert from 'node:assert/strict';
import {
    tuning, systems, bodies, stationGeometry, stationFor, dockingPoint,
    createWorld, nearestBody, gravityAt, targetFor, setTarget, nearestRelay,
    dockingStatus, interact, hackDigit, nextUpgrade, upgradePlanet,
    killPlayer, stepWorld
} from '../public/scripts/conquestPhysics.mjs';
import { tuning as motionTuning, stationGeometry as originalGeometry } from '../public/scripts/rocketPhysics.mjs?v=20261118-conquest';

// Advance actual physics in bounded intervals, including production and cooldowns.
function advance(world, seconds, input = {}) {
    let remaining = seconds;
    while (remaining > 1e-9) {
        const dt = Math.min(0.1, remaining);
        stepWorld(world, input, dt);
        remaining -= dt;
    }
}

// Isolate movement tests from gravity and solid geometry without changing world definitions.
function inSpace() {
    const world = createWorld('test', 1000);
    Object.assign(world.player, { x: 50000, y: 50000, landedOn: null });
    return world;
}

// Place the pilot exactly at a receiver for interaction and capture rule tests.
function atRelay(world, body = bodies[1]) {
    const point = dockingPoint(body);
    Object.assign(world.player, { x: point.x, y: point.y, vx: 0, vy: 0,
        angle: point.angle, rotationVelocity: 0, landedOn: null, docked: null });
    return body;
}

// Place the pilot on an aligned pad to isolate service eligibility from flight navigation.
function atPad(world, body) {
    Object.assign(world.player, { x: body.x, y: body.y - body.radius - tuning.shipRadius,
        vx: 0, vy: 0, angle: 0, rotationVelocity: 0, landedOn: body.id, docked: null });
}

// Issue fresh keyboard presses separated by the authoritative challenge rate limit.
function finishHack(world) {
    while (world.hack) {
        hackDigit(world, null);
        const result = hackDigit(world, world.hack.digit);
        assert.equal(result.ok, true, result.reason);
        if (world.hack) advance(world, tuning.hackPressInterval + 0.01);
    }
}

// Construct an explicit hostile fixture; live sessions never seed these projectiles.
function shot(x, y, vx, vy, options = {}) {
    return { id: 'fixture', owner: 'hostile', source: 'player', x, y, vx, vy,
        radius: tuning.bulletRadius, expiresAt: 10, ...options };
}

// Compare numeric physical outcomes with tolerances appropriate for fixed substeps.
function close(actual, expected, tolerance = 1e-7) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('world starts with 24 planets, three scattered lethal stars, and only the pilot home owned', () => {
    const world = createWorld('local', 1234);
    assert.equal(world.version, 2);
    assert.equal(world.createdAt, 1234);
    assert.equal(world.player.id, 'pilot');
    assert.equal(world.player.color, '#8ac4a8');
    assert.equal(bodies.length, 24);
    assert.equal(new Set(bodies.map(body => body.id)).size, 24);
    assert.equal(systems.length, 3);
    for (const system of systems) {
        assert.equal(bodies.filter(body => body.systemId === system.id).length, 8);
        for (const body of bodies.filter(body => body.systemId === system.id)) {
            assert.ok(Math.hypot(body.x - system.x, body.y - system.y) > body.radius + system.radius + 1000);
        }
    }
    assert.deepEqual(Object.keys(world.planets), bodies.map(body => body.id));
    assert.equal(Object.values(world.planets).filter(planet => planet.owner !== null).length, 1);
    assert.equal(world.planets[world.player.homeId].owner, 'pilot');
    assert.deepEqual(world.projectiles, []);
    assert.deepEqual(world.pickups, []);
    assert.equal(world.hack, null);
    assert.equal(world.refueling, null);
    assert.deepEqual(world.stats, { captures: 0, deaths: 0, cargoCollected: 0, shots: 0 });
    assert.deepEqual(stationGeometry, originalGeometry);
    const conquestOverrides = { mainAcceleration: 240, aimRotationAcceleration: 150, smallShieldAltitude: 200, dockingDistance: 100, dockingSpeed: 20, dockingAngle: 35 * Math.PI / 180 };
    for (const key of Object.keys(motionTuning)) {
        assert.equal(tuning[key], conquestOverrides[key] ?? motionTuning[key]);
    }
});

test('planets and their relays do not overlap other planets, relays, or stars', () => {
    for (const body of bodies) {
        const station = stationFor(body);
        for (const star of systems) {
            assert.ok(Math.hypot(station.x - star.x, station.y - star.y) > star.radius + 120);
        }
        for (const other of bodies) {
            if (body === other) continue;
            assert.ok(Math.hypot(body.x - other.x, body.y - other.y) > body.radius + other.radius + 100);
            assert.ok(Math.hypot(station.x - other.x, station.y - other.y) > other.radius + 120);
            const otherStation = stationFor(other);
            assert.ok(Math.hypot(station.x - otherStation.x, station.y - otherStation.y) > 240);
        }
    }
});

test('targets and nearest relay resolve exact receiver and pad coordinates', () => {
    const world = createWorld('target');
    const body = atRelay(world);
    assert.equal(nearestRelay(world.player), body);
    const surface = { ...world.player, x: body.x, y: body.y - body.radius - tuning.shipRadius };
    assert.equal(nearestBody(surface).body, body);
    assert.equal(setTarget(world, body.id, 'relay'), true);
    assert.deepEqual(targetFor(world), { body, type: 'relay', name: dockingPoint(body).name,
        x: dockingPoint(body).x, y: dockingPoint(body).y });
    assert.equal(setTarget(world, body.id, 'planet'), true);
    assert.equal(targetFor(world).y, body.y - body.radius - tuning.shipRadius);
    const previous = structuredClone(world.target);
    assert.equal(setTarget(world, 'missing', 'relay'), false);
    assert.equal(setTarget(world, body.id, 'station'), false);
    assert.deepEqual(world.target, previous);
});

test('docking checks range and speed at any rotation, allows empty fuel, and detach cancels progress', () => {
    const world = createWorld('dock');
    atRelay(world);
    world.player.vx = tuning.dockingSpeed + 1;
    assert.equal(interact(world).ok, false);
    world.player.vx = 0;
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        world.player.angle = angle;
        assert.equal(dockingStatus(world).ready, true);
    }
    world.player.fuel = 0;
    assert.equal(interact(world).ok, true);
    assert.ok(world.hack);
    assert.equal(hackDigit(world, world.hack.digit).ok, true);
    assert.equal(interact(world).ok, true);
    assert.equal(world.hack, null);
    assert.equal(world.player.docked, null);
    assert.ok(world.events.some(event => event.type === 'hackCancelled'));
});

test('fresh random hacking rejects wrong, repeat, stale and rapid keys; capture resets upgrades and stock', () => {
    const world = createWorld('hack');
    const body = atRelay(world);
    Object.assign(world.planets[body.id], { owner: 'hostile', level: 3, stock: 31 });
    assert.equal(interact(world).ok, true);
    const hack = world.hack;
    assert.equal(hack.required, tuning.hackBasePresses + 3 * tuning.hackExtraPresses);
    assert.ok(hack.digit >= 0 && hack.digit <= 9);
    assert.equal(hackDigit(world, (hack.digit + 1) % 10).ok, false);
    assert.equal(hack.progress, 0);
    hackDigit(world, null);
    assert.equal(hackDigit(world, hack.digit, { repeat: true }).ok, false);
    assert.equal(hackDigit(world, hack.digit, { challengeId: -1 }).ok, false);
    assert.equal(hackDigit(world, hack.digit).ok, true);
    const progress = hack.progress;
    hackDigit(world, null);
    assert.equal(hackDigit(world, hack.digit).ok, false);
    assert.equal(hack.progress, progress);
    advance(world, tuning.hackPressInterval + 0.01);
    finishHack(world);
    assert.deepEqual(world.planets[body.id], { owner: 'pilot', level: 0, stock: 0,
        nextCargoAt: world.elapsed + tuning.cargoSpawnInterval });
    assert.equal(world.player.docked, body.id);
    assert.equal(world.stats.captures, 1);
    assert.equal(hackDigit(world, 1).ok, false);
});

test('neutral challenges use 1–3 and home has neither hacking nor upgrade relay', () => {
    const world = createWorld('home');
    const body = atRelay(world);
    interact(world);
    assert.ok([1, 2, 3].includes(world.hack.digit));
    interact(world);
    atRelay(world, bodies[0]);
    interact(world);
    assert.equal(world.hack, null);
    world.player.cargo = 100;
    assert.equal(nextUpgrade(world).available, false);
    assert.equal(upgradePlanet(world).ok, false);
    assert.equal(world.planets[world.player.homeId].level, 0);
    interact(world);
    world.planets[body.id].home = true;
    world.planets[body.id].owner = 'hostile';
    atRelay(world, body);
    assert.equal(interact(world).ok, false);
});

test('owned relay upgrades charge exact costs, reject insufficient cargo and stop at level three', () => {
    const world = createWorld('upgrade');
    const body = atRelay(world);
    world.planets[body.id].owner = 'pilot';
    interact(world);
    assert.equal(nextUpgrade(world).available, true);
    assert.equal(nextUpgrade(world).affordable, false);
    assert.equal(upgradePlanet(world).ok, false);
    world.player.cargo = 100;
    for (let level = 0; level < 3; level += 1) {
        const cargo = world.player.cargo;
        assert.equal(nextUpgrade(world).cost, tuning.upgradeCosts[level]);
        assert.equal(upgradePlanet(world).ok, true);
        assert.equal(world.player.cargo, cargo - tuning.upgradeCosts[level]);
        assert.equal(world.planets[body.id].level, level + 1);
    }
    const cargo = world.player.cargo;
    assert.equal(nextUpgrade(world).available, false);
    assert.equal(upgradePlanet(world).ok, false);
    assert.equal(world.player.cargo, cargo);
});

test('owned planets eject banked cargo pods for manual collection instead of auto-transfer on landing', () => {
    const world = inSpace();
    const body = bodies[1];
    atPad(world, body);
    advance(world, 0.5);
    assert.equal(world.planets[body.id].owner, null);
    assert.equal(world.player.cargo, 0);
    world.planets[body.id].owner = 'pilot';
    world.planets[body.id].nextCargoAt = world.elapsed + tuning.cargoSpawnInterval;
    advance(world, tuning.cargoSpawnInterval + 0.1);
    assert.equal(world.player.cargo, 0);
    const pickup = world.pickups.find(item => item.bodyId === body.id);
    assert.ok(pickup);
    assert.equal(pickup.amount, 1);
    assert.equal(pickup.orbiting, true);
    const pickupSpeed = Math.hypot(pickup.vx, pickup.vy);
    const orbitRadius = Math.hypot(pickup.x - body.x, pickup.y - body.y);
    const orbitAltitude = orbitRadius - body.radius;
    assert.ok(orbitAltitude >= tuning.cargoSurfaceOffset);
    assert.ok(orbitAltitude <= tuning.cargoSurfaceOffset + tuning.cargoAltitudeVariation);
    const circularSpeed = Math.sqrt(gravityAt(pickup.x, pickup.y).magnitude * orbitRadius);
    const speedRatio = pickupSpeed / circularSpeed;
    assert.ok(speedRatio >= 1 - tuning.cargoOrbitSpeedVariation);
    assert.ok(speedRatio <= 1 + tuning.cargoOrbitSpeedVariation);
    Object.assign(world.player, { x: pickup.x, y: pickup.y, vx: 0, vy: 0, landedOn: null });
    stepWorld(world);
    assert.equal(world.player.cargo, 1);
    assert.equal(world.stats.cargoCollected, 1);
    assert.ok(world.events.some(event => event.type === 'cargoPickedUp'));
    world.pickups = Array.from({ length: tuning.maxPickups }, (_, index) => ({
        id: `cap-${index}`, x: 50000 + index, y: 50000, vx: 0, vy: 0, amount: 1, expiresAt: 1000
    }));
    world.planets[body.id].stock = 0;
    advance(world, tuning.maxStock / tuning.cargoRate + 1);
    assert.equal(world.planets[body.id].stock, tuning.maxStock);
    assert.equal(world.planets[bodies[2].id].stock, 0);
});

test('cargo pickup events are immutable and collection totals match the cargo counter', () => {
    const world = inSpace();
    world.pickups.push({ id: 'event-pickup', x: world.player.x, y: world.player.y, vx: 0, vy: 0,
        amount: 2, expiresAt: 10 });
    stepWorld(world);
    const collected = world.events.filter(event => event.type === 'cargoPickedUp');
    assert.equal(collected.length, 1);
    const snapshot = structuredClone(collected[0]);
    const counter = world.eventCounter;
    Object.assign(world.player, { x: 60000, y: 60000 });
    advance(world, 0.2);
    assert.deepEqual(collected[0], snapshot);
    assert.ok(world.eventCounter >= counter);
    const total = world.events.filter(event => event.type === 'cargoPickedUp')
        .reduce((amount, event) => amount + event.amount, 0);
    close(total, world.stats.cargoCollected);
    const sequences = world.events.map(event => event.seq);
    assert.equal(new Set(sequences).size, sequences.length);
    for (const event of world.events) close(event.at, world.createdAt + event.elapsed * 1000);
    world.events.splice(0);
    const drainedCounter = world.eventCounter;
    killPlayer(world, 'test');
    assert.ok(world.events.every(event => event.seq > drainedCounter));
});

test('refueling is free, decelerates, is faster at home, snaps full and requires an owned upright pad', () => {
    const low = createWorld('low');
    const high = createWorld('high');
    const away = createWorld('away');
    low.player.fuel = 10;
    high.player.fuel = 80;
    away.planets[bodies[1].id].owner = 'pilot';
    atPad(away, bodies[1]);
    away.player.fuel = 10;
    const cargo = low.player.cargo;
    advance(low, 1);
    advance(high, 1);
    advance(away, 1);
    assert.ok(low.player.fuel - 10 > high.player.fuel - 80);
    assert.ok(low.player.fuel > away.player.fuel);
    close(low.player.cargo, cargo);
    high.player.fuel = tuning.maxFuel - tuning.refuelSnap / 2;
    advance(high, 0.01);
    assert.equal(high.player.fuel, tuning.maxFuel);
    assert.equal(high.refueling, null);
    away.player.fuel = 20;
    away.player.angle = Math.PI / 2;
    advance(away, 0.1);
    assert.equal(away.player.fuel, 20);
    away.player.angle = 0;
    away.planets[bodies[1].id].owner = 'hostile';
    advance(away, 0.1);
    assert.equal(away.player.fuel, 20);
});

test('empty fuel coasts under gravity, ignores powered controls and still fires', () => {
    const world = inSpace();
    world.player.fuel = 0;
    world.player.vx = 12;
    advance(world, 0.2, { burn: true, rotate: 1, rcsX: 1, rcsY: 1, fire: true });
    close(world.player.x, 50000 + 12 * tuning.fixedStep + (12 - tuning.shotRecoil) * (0.2 - tuning.fixedStep));
    close(world.player.vx, 12 - tuning.shotRecoil);
    assert.equal(world.player.angle, 0);
    assert.equal(world.player.deadUntil, 0);
    assert.equal(world.player.fuel, 0);
    assert.equal(world.stats.shots, 1);
    const body = bodies[0];
    Object.assign(world.player, { x: body.x, y: body.y - body.radius - 60, vx: 0, vy: 0 });
    assert.ok(gravityAt(world.player.x, world.player.y).ay > 0);
    advance(world, 0.1);
    assert.ok(world.player.vy > 0);
});

test('main engine remains full output, finite controls clamp, and rotation ramps and resets on reversal', () => {
    const world = inSpace();
    const dt = tuning.fixedStep;
    stepWorld(world, { burn: 0.1, rcsX: Infinity, rcsY: NaN }, dt);
    close(world.player.vy, -tuning.mainAcceleration * dt);
    close(world.player.vx, 0);
    const rotation = inSpace();
    stepWorld(rotation, { rotate: 1 }, dt);
    const first = rotation.player.rotationVelocity;
    assert.ok(first >= tuning.rotationRate);
    advance(rotation, 0.2, { rotate: 1 });
    assert.ok(rotation.player.rotationVelocity > first);
    stepWorld(rotation, { rotate: -1 }, dt);
    assert.ok(rotation.player.rotationVelocity < 0);
    close(Math.abs(rotation.player.rotationVelocity), first);
    stepWorld(rotation, {}, dt);
    assert.equal(rotation.player.rotationVelocity, 0);
});

test('safe contacts land or bounce while fast surface and station impacts consume fuel', () => {
    for (const [speed, expected] of [[11, 'landed'], [20, 'bounce'], [26, 'damaged']]) {
        const world = inSpace();
        const body = bodies[1];
        Object.assign(world.player, { x: body.x, y: body.y - body.radius - tuning.shipRadius - 0.01, vy: speed });
        stepWorld(world);
        if (expected === 'landed') assert.equal(world.player.landedOn, body.id);
        if (expected === 'bounce') {
            assert.equal(world.player.landedOn, null);
            assert.ok(world.player.vy < 0);
        }
        assert.equal(Boolean(world.player.deadUntil), false);
        if (expected === 'damaged') assert.ok(world.player.fuel < 100);
    }
    for (const speed of [20, 31]) {
        const world = inSpace();
        const station = stationFor(bodies[1]);
        Object.assign(world.player, { x: station.x - 62.05, y: station.y, vx: speed });
        stepWorld(world);
        assert.equal(Boolean(world.player.deadUntil), false);
        assert.ok(world.player.vx < 0);
        assert.equal(world.player.fuel < 100, speed >= 30);
    }
});

test('full thrust launches from home and swept star impacts cannot tunnel', () => {
    const world = createWorld('launch');
    const y = world.player.y;
    advance(world, 0.1, { burn: true });
    assert.equal(world.player.landedOn, null);
    assert.ok(world.player.y < y);
    const star = systems[0];
    Object.assign(world.player, { x: star.x - star.radius - 100, y: star.y,
        vx: (star.radius * 2 + 300) / tuning.fixedStep, vy: 0, landedOn: null });
    stepWorld(world);
    assert.ok(world.player.deadUntil > world.elapsed);
    assert.match(world.events.findLast(event => event.type === 'died').reason, /Star/);
});

test('death is idempotent, drops fractional cargo, retains territory and respawns full at 0.9 seconds', () => {
    const world = inSpace();
    world.player.cargo = 7.25;
    world.planets[bodies[1].id].owner = 'pilot';
    world.planets[bodies[1].id].level = 3;
    assert.equal(killPlayer(world, 'Self destruct.'), true);
    assert.equal(killPlayer(world, 'again'), false);
    assert.equal(world.stats.deaths, 1);
    assert.equal(world.pickups[0].amount, 7.25);
    assert.equal(world.player.cargo, 0);
    advance(world, 0.89);
    assert.ok(world.player.deadUntil);
    advance(world, 0.01);
    assert.equal(world.player.deadUntil, 0);
    assert.equal(world.player.fuel, tuning.maxFuel);
    assert.equal(world.player.landedOn, world.player.homeId);
    assert.equal(world.planets[bodies[1].id].level, 3);
    assert.equal(world.planets[bodies[1].id].owner, 'pilot');
    const producedCargo = world.player.cargo;
    const pickup = world.pickups[0];
    Object.assign(world.player, { x: pickup.x, y: pickup.y, landedOn: null });
    stepWorld(world);
    assert.equal(world.pickups.length, 0);
    close(world.player.cargo, producedCargo + 7.25);
});

test('projectiles sweep across moving rockets, ignore friendly hits, obey cooldown and cannot fire docked', () => {
    const world = inSpace();
    world.projectiles.push(shot(world.player.x - 100, world.player.y, 30000, 0));
    stepWorld(world);
    assert.equal(world.stats.deaths, 0);
    close(world.player.fuel, 100 - tuning.shotFuelDamage);
    assert.equal(world.projectiles.length, 0);
    const friendly = inSpace();
    friendly.projectiles.push(shot(friendly.player.x - 100, friendly.player.y, 30000, 0, { owner: 'pilot' }));
    stepWorld(friendly);
    assert.equal(friendly.stats.deaths, 0);
    advance(friendly, 0.49, { fire: true, aimAngle: Math.PI / 2 });
    assert.equal(friendly.stats.shots, 3);
    const docked = createWorld('docked-fire');
    atRelay(docked);
    interact(docked);
    advance(docked, 0.5, { fire: true });
    assert.equal(docked.stats.shots, 0);
});

test('basic fields slow hostile shots, hard barriers stop crossings and friendly shots ignore shields', () => {
    for (const [level, owner] of [[0, 'hostile'], [1, 'hostile'], [3, 'pilot']]) {
        const world = inSpace();
        const body = bodies[1];
        Object.assign(world.planets[body.id], { owner: 'pilot', level });
        const projectile = shot(body.x - body.radius - tuning.smallShieldAltitude - 10, body.y, 10000, 0, { owner });
        world.projectiles.push(projectile);
        stepWorld(world);
        if (level === 1) assert.equal(world.projectiles.length, 0);
        else {
            assert.equal(world.projectiles.length, 1);
            close(projectile.vx, owner === 'pilot' ? 10000 : 10000 * tuning.bulletSlowFactor);
        }
    }
});

test('enemy shots fired inside ordinary bullet barriers can hit, while home blocks enemy shots', () => {
    const world = inSpace();
    const body = bodies[1];
    Object.assign(world.planets[body.id], { owner: 'pilot', level: 1 });
    Object.assign(world.player, { x: body.x, y: body.y - body.radius - 45 });
    world.projectiles.push(shot(world.player.x - 40, world.player.y, 6000, 0));
    stepWorld(world);
    assert.equal(world.stats.deaths, 0);
    close(world.player.fuel, 100 - tuning.shotFuelDamage);
    const home = createWorld('shield');
    const homeBody = bodies[0];
    home.projectiles.push(shot(homeBody.x, homeBody.y - homeBody.radius - 250, 0, 40000));
    stepWorld(home);
    assert.equal(home.stats.deaths, 0);
    assert.equal(home.projectiles.length, 0);
    assert.ok(home.events.some(event => event.type === 'shieldBlocked'));
});

test('home hard-blocks hostile rockets while ordinary fields only repel them', () => {
    const body = bodies[1];
    const home = inSpace();
    Object.assign(home.planets[body.id], { owner: 'hostile', home: true });
    const radius = body.radius + tuning.homeShieldAltitude + tuning.shipRadius;
    Object.assign(home.player, { x: body.x - radius - 1, y: body.y, vx: 1000 });
    stepWorld(home);
    assert.equal(home.stats.deaths, 0);
    assert.ok(home.player.x <= body.x - radius);
    assert.ok(home.player.vx < 0);
    const ordinary = inSpace();
    Object.assign(ordinary.planets[body.id], { owner: 'hostile', level: 1 });
    Object.assign(ordinary.player, { x: body.x - body.radius - 60, y: body.y, vx: 1 });
    stepWorld(ordinary);
    assert.ok(ordinary.player.x > body.x - body.radius - 60);
    assert.ok(ordinary.player.vx < 1);
    assert.equal(ordinary.stats.deaths, 0);
});

test('outer field slows hostile bullets without destroying them', () => {
    const world = inSpace();
    const body = bodies[1];
    Object.assign(world.planets[body.id], { owner: 'pilot', level: 3 });
    const projectile = shot(body.x - body.radius - tuning.outerFieldAltitude - 10, body.y, 10000, 0);
    world.projectiles.push(projectile);
    stepWorld(world);
    assert.equal(world.projectiles.length, 1);
    close(projectile.vx, 10000 * tuning.outerBulletSlowFactor);
});

test('turrets only target a live hostile pilot outside relay refuge', () => {
    const world = createWorld('turret');
    const body = atRelay(world);
    Object.assign(world.planets[body.id], { owner: 'hostile', level: 2 });
    advance(world, 0.1);
    assert.equal(world.projectiles.length, 0);
    world.player.x += tuning.refugeRadius + 100;
    advance(world, 0.1);
    assert.equal(world.projectiles.length, 1);
    assert.equal(world.projectiles[0].source, 'turret');
    world.projectiles = [];
    world.planets[body.id].owner = 'pilot';
    advance(world, 3);
    assert.equal(world.projectiles.length, 0);
});

test('relay refuge intercepts swept turret bullets but leaves player bullets lethal', () => {
    for (const source of ['turret', 'player']) {
        const world = createWorld(`refuge-${source}`);
        atRelay(world);
        world.projectiles.push(shot(world.player.x - 200, world.player.y, 40000, 0, { source }));
        stepWorld(world);
        assert.equal(world.stats.deaths, 0);
        close(world.player.fuel, source === 'player' ? 100 - tuning.shotFuelDamage : 100);
        assert.equal(world.projectiles.length, 0);
    }
});

test('events remain bounded and monotonic; invalid time and inputs cannot poison state', () => {
    const world = inSpace();
    const saved = structuredClone(world);
    for (const dt of [NaN, Infinity, -1, 0]) stepWorld(world, {}, dt);
    assert.deepEqual(world, saved);
    stepWorld(world, { burn: Infinity, rotate: NaN, rcsX: Infinity, aimAngle: NaN });
    assert.ok(Number.isFinite(world.player.x));
    advance(world, 160, { fire: true });
    assert.equal(world.events.length, tuning.maxEvents);
    assert.ok(world.eventCounter > tuning.maxEvents);
    assert.ok(world.events.every((event, index, events) => index === 0 || event.seq > events[index - 1].seq));
    assert.ok(world.projectiles.length <= tuning.maxProjectiles);
    assert.ok(world.updatedAt > world.createdAt);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(world)));
});


test('stronger thrust accelerates at 240 m/s squared while preserving fuel draw', () => {
    const world = inSpace();
    assert.equal(tuning.mainAcceleration, 240);
    advance(world, 1, { burn: true });
    close(world.player.vx, 0);
    close(world.player.vy, -240);
    close(world.player.fuel, 100 - tuning.mainFuelRate / tuning.fuelCapacityScale);
});

test('continued thrust accelerates beyond 500 m/s and coasting preserves speed', () => {
    for (const angle of [0, Math.PI / 2, Math.PI / 4]) {
        const world = inSpace();
        Object.assign(world.player, { angle, vx: 300, vy: -400 });
        advance(world, 4, { burn: true });
        close(world.player.vx, 300 + Math.sin(angle) * tuning.mainAcceleration * 4);
        close(world.player.vy, -400 - Math.cos(angle) * tuning.mainAcceleration * 4);
        assert.ok(Math.hypot(world.player.vx, world.player.vy) > 500);
    }
    const world = inSpace();
    advance(world, 10, { burn: true });
    close(Math.hypot(world.player.vx, world.player.vy), tuning.mainAcceleration * 10);
    const velocity = { vx: world.player.vx, vy: world.player.vy };
    advance(world, 1);
    close(world.player.vx, velocity.vx);
    close(world.player.vy, velocity.vy);
});

test('axis braking stops rapidly without reversal, preserving sideways drift at every heading', () => {
    for (const angle of [0, Math.PI / 2, -Math.PI / 2, Math.PI, .7]) {
        for (const forwardSpeed of [100, -100, 0, .01]) {
            const world = inSpace();
            const nose = { x: Math.sin(angle), y: -Math.cos(angle) };
            const side = { x: Math.cos(angle), y: Math.sin(angle) };
            Object.assign(world.player, { angle,
                vx: nose.x * forwardSpeed + side.x * 25,
                vy: nose.y * forwardSpeed + side.y * 25 });
            for (let frame = 0; frame < 240; frame++) {
                const before = world.player.vx * nose.x + world.player.vy * nose.y;
                stepWorld(world, { rcsY: 1 });
                const after = world.player.vx * nose.x + world.player.vy * nose.y;
                assert.ok(Math.abs(after) <= Math.abs(before) + 1e-9);
                assert.ok(before * after >= -1e-9);
                close(world.player.vx * side.x + world.player.vy * side.y, 25);
                if (frame === 119) assert.ok(Math.abs(after) < .1);
            }
        }
    }
});

test('braking cannot launch, detach, or accelerate a stationary or empty-fuel rocket', () => {
    const landed = createWorld();
    stepWorld(landed, { rcsY: 1 });
    assert.equal(landed.player.landedOn, landed.player.homeId);
    const docked = inSpace();
    docked.player.docked = 'moon';
    stepWorld(docked, { rcsY: 1 });
    assert.equal(docked.player.docked, 'moon');
    const stationary = inSpace();
    advance(stationary, 1, { rcsY: 1 });
    close(stationary.player.vx, 0); close(stationary.player.vy, 0);
    const empty = inSpace();
    Object.assign(empty.player, { fuel: 0, vy: -100 });
    advance(empty, 1, { rcsY: 1 });
    close(empty.player.vy, -100);
});

test('shots cost fuel, equal damage leaves zero alive, and a further hit destroys only once', () => {
    const world = inSpace();
    world.player.fuel = tuning.shotFuelDamage;
    world.player.cargo = 3;
    world.projectiles.push(shot(world.player.x - 100, world.player.y, 30000, 0));
    stepWorld(world);
    assert.equal(world.player.fuel, 0);
    assert.equal(world.stats.deaths, 0);
    assert.equal(world.player.cargo, 3);
    world.projectiles.push(shot(world.player.x - 100, world.player.y, 30000, 0));
    world.projectiles.push(shot(world.player.x - 100, world.player.y, 30000, 0));
    stepWorld(world);
    assert.equal(world.stats.deaths, 1);
    assert.equal(world.pickups.length, 1);
    assert.equal(world.pickups[0].amount, 3);
    assert.equal(world.events.filter(event => event.type === 'damaged').length, 2);
    advance(world, tuning.respawnDelay + 0.01);
    assert.equal(world.player.deadUntil, 0);
    assert.equal(world.player.fuel, 100);
});

test('impact fuel loss increases with speed and survivors rebound without repeated damage', () => {
    let previousLoss = 0;
    for (const speed of [35, 55, 95]) {
        const world = inSpace();
        const station = stationFor(bodies[1]);
        Object.assign(world.player, { x: station.x - 62.05, y: station.y, vx: speed });
        stepWorld(world);
        const loss = 100 - world.player.fuel;
        assert.ok(loss > previousLoss);
        assert.ok(world.player.damageFlashUntil > world.elapsed);
        previousLoss = loss;
        assert.equal(world.stats.deaths, 0);
        assert.ok(world.player.vx < 0);
        assert.ok(Math.hypot(world.player.vx, world.player.vy) <= 6);
        const damageCount = world.events.filter(event => event.type === 'damaged').length;
        advance(world, 0.2);
        assert.equal(world.events.filter(event => event.type === 'damaged').length, damageCount);
    }
});

test('impact damage exceeding fuel destroys the rocket while equal damage leaves zero fuel', () => {
    for (const fuel of [0, 4, 5]) {
        const world = inSpace();
        const station = stationFor(bodies[1]);
        Object.assign(world.player, { x: station.x - 62.05, y: station.y, vx: 40, fuel });
        stepWorld(world);
        assert.equal(world.player.fuel, 0);
        assert.equal(world.stats.deaths, fuel < 5 ? 1 : 0);
        assert.equal(world.events.findLast(event => event.type === 'damaged').amount, 5);
    }
});

// Home remains a refueling refuge, while expansion supplies all cargo and relay purchases.
test('home has no relay or cargo production and Moon is above Earth', () => {
    const world = inSpace();
    const earth = bodies[0], moon = bodies[1];
    assert.equal(moon.x, earth.x); assert.ok(moon.y < earth.y);
    assert.ok(stationFor(moon).y < earth.y);
    world.planets.earth.stock = 20;
    world.pickups.push({ id: 'legacy-home', bodyId: 'earth', orbiting: true, x: earth.x, y: earth.y,
        vx: 0, vy: 0, amount: 1, expiresAt: 100 });
    world.planets.moon.owner = world.player.id;
    advance(world, 5);
    assert.equal(world.planets.earth.stock, 0);
    assert.equal(world.pickups.some(pickup => pickup.bodyId === 'earth'), false);
    assert.ok(world.pickups.some(pickup => pickup.bodyId === 'moon'));
    assert.equal(dockingStatus(world, 'earth').ready, false);
    assert.equal(setTarget(world, 'earth', 'relay'), true);
    assert.equal(targetFor(world).type, 'planet');
    assert.notEqual(nearestRelay({ ...world.player, ...dockingPoint(earth) }, world).id, 'earth');
});

// Attraction assists a close pass while keeping distant cargo and respawning players unaffected.
test('nearby cargo gently accelerates toward a live player while distant cargo keeps drifting', () => {
    const makePickup = (world, distance) => ({ id: 'magnet', x: world.player.x + distance, y: world.player.y,
        vx: 0, vy: 0, amount: 1, expiresAt: 100 });
    const nearby = inSpace();
    nearby.pickups.push(makePickup(nearby, 120));
    const initialX = nearby.pickups[0].x;
    advance(nearby, 1);
    assert.equal(nearby.pickups.length, 1);
    assert.ok(nearby.pickups[0].x < initialX);
    assert.ok(nearby.pickups[0].x > initialX - 25);
    const far = inSpace();
    far.pickups.push(makePickup(far, tuning.cargoAttractionRadius + 10));
    const farX = far.pickups[0].x;
    advance(far, 1);
    close(far.pickups[0].x, farX);
    const dead = inSpace();
    dead.player.deadUntil = 100;
    dead.pickups.push(makePickup(dead, 120));
    const deadX = dead.pickups[0].x;
    advance(dead, 1);
    close(dead.pickups[0].x, deadX);
});

test('compact galaxy keeps Moon above Earth and Neptune safely below it', () => {
    const earth = bodies.find(body => body.id === 'earth');
    const moon = bodies.find(body => body.id === 'moon');
    const neptune = bodies.find(body => body.id === 'neptune');
    assert.equal(moon.x, earth.x); assert.equal(neptune.x, earth.x);
    assert.ok(moon.y < earth.y && neptune.y > earth.y);
    assert.ok(Math.hypot(moon.x - neptune.x, moon.y - neptune.y) > moon.radius + neptune.radius + 500);
    assert.ok(Math.hypot(systems[1].x, systems[1].y) < Math.hypot(14000, -9500));
    for (const body of bodies) {
        const system = systems.find(system => system.id === body.systemId);
        assert.ok(Math.hypot(body.x - system.x, body.y - system.y) < 3501);
    }
});

// Sustained fire locks out at overheat and becomes available after its complete cooldown.
test('gun overheat blocks firing for 2.5 seconds and firing resumes after cooling', () => {
    const world = inSpace();
    for (let frame = 0; frame < 300 && !world.player.gunOverheatedUntil; frame++) stepWorld(world, { fire: true });
    assert.ok(world.player.gunOverheatedUntil > world.elapsed);
    close(world.player.gunOverheatedUntil - world.elapsed, 2.5);
    const shots = world.stats.shots;
    advance(world, 2.4, { fire: true });
    assert.equal(world.stats.shots, shots);
    assert.ok(world.player.gunHeat > 0 && world.player.gunHeat < 1);
    advance(world, .12, { fire: true });
    assert.equal(world.stats.shots, shots + 1);
    assert.equal(world.player.gunOverheatedUntil, 0);
});

test('each in-flight shot produces only a small opposite-direction recoil', () => {
    for (const aimAngle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const world = inSpace();
        world.player.aimAngle = aimAngle;
        stepWorld(world, { fire: true });
        close(world.player.vx, -Math.cos(aimAngle) * tuning.shotRecoil);
        close(world.player.vy, -Math.sin(aimAngle) * tuning.shotRecoil);
    }
});

// Production is intentionally halved in both stored resources and surface pod cadence.
test('captured planets produce three cargo per ten seconds with slower pod releases', () => {
    const world = inSpace();
    world.planets.moon.owner = world.player.id;
    advance(world, 10);
    const pods = world.pickups.filter(pickup => pickup.bodyId === 'moon');
    const produced = pods.reduce((sum, pickup) => sum + pickup.amount, 0) + world.planets.moon.stock;
    assert.ok(Math.abs(produced - 3) < 1e-8);
    assert.ok(pods.length <= 3);
});

// Turret damage uses swept hits inside the existing bullet shield and cannot be caused by friendly shots.
test('five hostile shots disable a turret, its bar recovers, and extra hits do not extend recovery', () => {
    const world = inSpace();
    const body = bodies[1], planet = world.planets[body.id];
    Object.assign(planet, { owner: 'pilot', level: 2 });
    const y = body.y - body.radius - 26;
    const hit = owner => {
        world.projectiles.push(shot(body.x - 70, y, 10000, 0, { owner }));
        stepWorld(world);
    };
    hit('pilot');
    assert.equal(planet.turretHealth, tuning.turretHealth);
    world.projectiles = [];
    for (let index = 0; index < 5; index++) hit('hostile');
    assert.equal(planet.turretHealth, 0);
    assert.ok(planet.turretDisabledUntil > world.elapsed);
    const deadline = planet.turretDisabledUntil;
    hit('hostile');
    assert.equal(planet.turretDisabledUntil, deadline);
    advance(world, 5);
    assert.ok(planet.turretHealth > 2 && planet.turretHealth < 3);
    advance(world, 5.1);
    assert.equal(planet.turretHealth, tuning.turretHealth);
    assert.equal(planet.turretDisabledUntil, 0);
});

// Existing defense layers must intercept external shots before they can reach a turret.
test('bullet barrier still protects a turret from shots fired outside the field', () => {
    const world = inSpace();
    const body = bodies[1];
    Object.assign(world.planets[body.id], { owner: 'pilot', level: 2 });
    world.projectiles.push(shot(body.x, body.y - body.radius - 400, 0, 100000));
    stepWorld(world);
    assert.equal(world.planets[body.id].turretHealth, tuning.turretHealth);
    assert.equal(world.projectiles.length, 0);
    assert.ok(world.events.some(event => event.type === 'shieldBlocked'));
});
