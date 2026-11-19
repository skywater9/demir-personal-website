import {
    tuning as motionTuning, normalizeAngle, stationGeometry, stationFor, dockingPoint
} from './rocketPhysics.mjs?v=20261118-shop-price';

export { stationGeometry, stationFor, dockingPoint };

export const tuning = Object.freeze({
    ...motionTuning,
    mainAcceleration: 240, brakeAcceleration: 300, brakeResponse: 8,
    dockingSpeed: 20, dockingAngle: 35 * Math.PI / 180,
    gunHeatPerShot: 0.26, gunCoolingRate: 0.25, gunOverheatDuration: 2.5, shotRecoil: 1.25,
    shotFuelDamage: 5, impactFuelDamageRate: 0.5,
    maxStepDuration: 1, respawnDelay: 0.9,
    aimRotationAcceleration: 150, maxAimRotationRate: 8,
    aimRotationResponse: 100, aimRotationDamping: 20,
    cargoRate: 0.3, maxStock: 60, cargoSpawnInterval: 3.34, cargoSurfaceOffset: 70,
    cargoAltitudeVariation: 90, cargoOrbitSpeedVariation: 0.14,
    pickupLifetime: 90, pickupRadius: 30, maxPickups: 64,
    cargoAttractionRadius: 200, cargoAttractionAcceleration: 35,
    refuelRate: 12, homeRefuelRate: 24, refuelSnap: 0.05,
    hackPressInterval: 0.12, hackBasePresses: 4, hackExtraPresses: 2,
    upgradeCosts: Object.freeze([8, 16, 28]),
    homeShieldAltitude: 150, smallShieldAltitude: 200, outerFieldAltitude: 1000,
    rocketRepulsion: 24, outerRepulsion: 14, bulletSlowFactor: 0.45,
    outerBulletSlowFactor: 0.75, dockingDistance: 100, refugeRadius: 100,
    bulletSpeed: 680, bulletRadius: 3, bulletLifetime: 5, fireCooldown: 0.24,
    turretRange: 1700, turretCooldown: 2.4, turretBulletSpeed: 190,
    turretHealth: 5, turretRadius: 22, turretRecoveryDuration: 10,
    rocketUpgradeCosts: Object.freeze([8, 16, 28, 40]),
    maxProjectiles: 256, maxEvents: 200
});

// Each system record is its central lethal star, keeping map and collision coordinates identical.
export const systems = Object.freeze([
    { id: 'sol', name: 'Sol', x: 0, y: 0, radius: 540, gravity: 18, color: '#fff0a6' },
    { id: 'vega', name: 'Vega', x: 9100, y: -6175, radius: 630, gravity: 22, color: '#e5f5ff' },
    { id: 'ember', name: 'Ember', x: -7150, y: -8450, radius: 480, gravity: 16, color: '#ffc58f' }
].map(system => Object.freeze(system)));

const planetNames = [
    ['Earth', 'Moon', 'Venus', 'Mercury', 'Mars', 'Jupiter', 'Saturn', 'Neptune'],
    ['Aster', 'Cobalt', 'Iris', 'Lumen', 'Nacre', 'Opal', 'Prism', 'Vale'],
    ['Ash', 'Basalt', 'Cinder', 'Flint', 'Garnet', 'Ochre', 'Rust', 'Slate']
];
const planetColors = ['#4b91b5', '#a4a9b5', '#d7ad6b', '#a99786', '#bc7155', '#cfad8e', '#d6c291', '#587fbf'];
const planetGravity = [9.81, 1.62, 8.87, 3.7, 3.71, 24.79, 10.44, 11.15];

// Scatter eight stationary planets around each star without imposing a route or spawning opponents.
export const bodies = Object.freeze(systems.flatMap((system, systemIndex) =>
    planetNames[systemIndex].map((name, index) => {
        const angle = index * Math.PI / 4 + systemIndex * 0.18;
        const orbit = 2000 + (index % 3) * 450;
        return Object.freeze({
            id: name.toLowerCase(), name,
            x: systemIndex === 0 && (index === 1 || index === 7) ? 2000 : system.x + Math.cos(angle) * orbit,
            y: systemIndex === 0 && index === 1 ? -1100 : systemIndex === 0 && index === 7 ? 1500 : system.y + Math.sin(angle) * orbit,
            radius: [260, 145, 245, 170, 205, 380, 320, 270][index],
            gravity: planetGravity[index], color: planetColors[index], land: '#728579',
            gas: index >= 5, systemId: system.id
        });
    })
));

// Bound controls before they can introduce non-finite velocities into a saved world.
function control(value) {
    return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

// Resolve public body IDs without accepting arbitrary collision geometry from callers.
function bodyFor(bodyId) {
    return bodies.find(body => body.id === bodyId);
}

// Timestamp bounded outcome events with a counter that survives draining the event array.
function emit(world, type, details = {}) {
    world.eventCounter += 1;
    world.updatedAt = world.createdAt + world.elapsed * 1000;
    world.events.push({ type, ...(world.players ? { playerId: world.player.id } : {}), at: world.updatedAt, elapsed: world.elapsed, seq: world.eventCounter, ...details });
    if (world.events.length > tuning.maxEvents) world.events.splice(0, world.events.length - tuning.maxEvents);
}

// Start a local session on a protected owned home; all other planets remain neutral.
export function createWorld(id = globalThis.crypto.randomUUID(), now = Date.now()) {
    const home = bodies[0];
    const world = {
        version: 2, id, createdAt: now, updatedAt: now, elapsed: 0,
        player: {
            id: 'pilot', color: '#8ac4a8', homeId: home.id,
            x: home.x, y: home.y - home.radius - tuning.shipRadius,
            vx: 0, vy: 0, angle: 0, rotationVelocity: 0,
            fuel: tuning.maxFuel, cargo: 0, landedOn: home.id, docked: null,
            deadUntil: 0, aimAngle: 0, gunHeat: 0, gunOverheatedUntil: 0
        },
        planets: Object.fromEntries(bodies.map(body => [body.id, {
            owner: body.id === home.id ? 'pilot' : null, level: 0, stock: 0,
            nextCargoAt: tuning.cargoSpawnInterval
        }])),
        projectiles: [], pickups: [], events: [], hack: null,
        target: { bodyId: bodies[1].id, type: 'relay' },
        stats: { captures: 0, deaths: 0, cargoCollected: 0, shots: 0 },
        refueling: null, eventCounter: 0
    };
    emit(world, 'started', { bodyId: home.id });
    return world;
}

// Measure the nearest planetary surface for altitude instruments, matching the existing motion API.
export function nearestBody(player) {
    return bodies.reduce((nearest, body) => {
        const altitude = Math.hypot(player.x - body.x, player.y - body.y) - body.radius - tuning.shipRadius;
        return !nearest || altitude < nearest.altitude ? { body, altitude } : nearest;
    }, null);
}

// Sum inverse-square gravity with the old smooth cutoff, including the central stars.
export function gravityAt(x, y) {
    let ax = 0;
    let ay = 0;
    for (const body of [...bodies, ...systems]) {
        const dx = body.x - x;
        const dy = body.y - y;
        const distance = Math.max(0.001, Math.hypot(dx, dy));
        const surface = body.radius + tuning.shipRadius;
        const radialDistance = Math.max(surface, distance);
        const fade = Math.max(0, Math.min(1, (tuning.influenceAltitude - radialDistance + surface) / 300));
        const acceleration = body.gravity * (surface / radialDistance) ** 2 * fade;
        ax += dx / distance * acceleration;
        ay += dy / distance * acceleration;
    }
    return { ax, ay, magnitude: Math.hypot(ax, ay) };
}

// Return the nearest relay's planet, rather than the planet with the nearest surface.
export function nearestRelay(player, world = null) {
    const relays = bodies.filter(body => body.id !== player.homeId && !world?.planets[body.id]?.home);
    return relays.reduce((nearest, body) => {
        const point = dockingPoint(body);
        const other = dockingPoint(nearest);
        return Math.hypot(player.x - point.x, player.y - point.y)
            < Math.hypot(player.x - other.x, player.y - other.y) ? body : nearest;
    }, relays[0]);
}

// Resolve the selected navigation marker into the same exact geometry used by interactions.
export function targetFor(world) {
    const body = bodyFor(world.target.bodyId) || bodies[0];
    const type = world.target.type === 'planet' || isHome(world, body) ? 'planet' : 'relay';
    const point = type === 'relay' ? dockingPoint(body)
        : { x: body.x, y: body.y - body.radius - tuning.shipRadius, name: `${body.name} landing pad` };
    return { body, type, name: point.name, x: point.x, y: point.y };
}

// Reject invalid navigation selections instead of saving unresolved body IDs.
export function setTarget(world, bodyId, type = 'relay') {
    if (!bodyFor(bodyId) || !['relay', 'planet'].includes(type)) return false;
    if (isHome(world, bodyFor(bodyId))) type = 'planet';
    world.target = { bodyId, type };
    return true;
}

// Expose the live attach checklist; empty fuel never prevents passive docking.
export function dockingStatus(world, bodyId = nearestRelay(world.player, world).id) {
    const body = bodyFor(bodyId);
    if (!body) return { ready: false, reason: 'Unknown relay.', distance: Infinity, speed: Infinity, angle: Infinity };
    const player = world.player;
    if (isHome(world, body)) return { bodyId: body.id, ready: false, reason: 'NO RELAY', distance: Infinity, speed: Infinity, angle: Infinity };
    const point = dockingPoint(body);
    const distance = Math.hypot(player.x - point.x, player.y - point.y);
    const speed = Math.hypot(player.vx, player.vy);
    const angle = Math.abs(normalizeAngle(player.angle - point.angle));
    const protectedHome = isHome(world, body) && world.planets[body.id].owner !== player.id;
    const otherPilots = world.players ? Object.values(world.players).map(actor => actor.player) : world.others || [];
    const occupied = otherPilots.some(other => other.id !== player.id && other.docked === body.id);
    const ready = !player.deadUntil && !player.docked && !protectedHome && !occupied
        && distance <= tuning.dockingDistance && speed <= tuning.dockingSpeed;
    return { bodyId: body.id, distance, speed, angle, ready,
        reason: ready ? '' : player.deadUntil ? 'RESPAWNING'
            : occupied ? 'OCCUPIED' : protectedHome ? 'PROTECTED'
                : distance > tuning.dockingDistance ? 'NOT IN RANGE'
                    : speed > tuning.dockingSpeed ? 'SLOW DOWN'
                        : 'UNAVAILABLE' };
}

// Treat optional home markers as hostile fixture data while always protecting the local home.
function isHome(world, body) {
    return Boolean(body && ((world.players ? false : body.id === world.player.homeId) || world.planets[body.id]?.home));
}

// Issue a fresh challenge, avoiding the previous digit so held old keys cannot advance it.
function challengeDigit(level, previous = null) {
    const digits = level === 0 ? [1, 2, 3] : level === 1 ? [1, 2, 3, 4, 5, 6]
        : level === 2 ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const pool = digits.filter(digit => digit !== previous);
    return pool[Math.floor(Math.random() * pool.length)];
}

// Cancel all partial capture progress when an attachment ends for any reason.
function detach(world) {
    const bodyId = world.player.docked;
    world.player.docked = null;
    if (world.hack) emit(world, 'hackCancelled', { bodyId });
    world.hack = null;
    if (bodyId) emit(world, 'undocked', { bodyId });
}

// Toggle attachment at the nearest aligned relay and create a challenge only for non-owned planets.
export function interact(world) {
    const player = world.player;
    if (player.deadUntil) return { ok: false, reason: 'RESPAWNING' };
    if (player.docked) {
        detach(world);
        return { ok: true, reason: 'Detached.' };
    }
    const status = dockingStatus(world);
    if (!status.ready) return { ok: false, reason: status.reason };
    const body = bodyFor(status.bodyId);
    const point = dockingPoint(body);
    Object.assign(player, { x: point.x, y: point.y, vx: 0, vy: 0, angle: point.angle,
        rotationVelocity: 0, landedOn: null, docked: body.id });
    stopRefueling(world);
    flushCollection(world);
    emit(world, 'docked', { bodyId: body.id });
    if (world.planets[body.id].owner !== player.id) {
        const level = Math.max(0, Math.min(3, world.planets[body.id].level));
        world.hack = { bodyId: body.id, digit: challengeDigit(level), progress: 0,
            required: tuning.hackBasePresses + level * tuning.hackExtraPresses,
            lastAcceptedAt: world.elapsed - tuning.hackPressInterval, heldDigit: null,
            challengeId: world.eventCounter + 1 };
        emit(world, 'hackStarted', { bodyId: body.id });
    }
    return { ok: true, reason: 'Attached.' };
}

// Accept fresh digit presses, with optional keyboard-repeat and challenge-ID validation for callers.
export function hackDigit(world, digit, { repeat = false, challengeId } = {}) {
    const hack = world.hack;
    if (!hack || world.player.deadUntil || world.player.docked !== hack.bodyId) {
        return { ok: false, reason: 'No active hack.' };
    }
    if (digit === null) {
        hack.heldDigit = null;
        return { ok: true, reason: 'Released.' };
    }
    if (repeat || (challengeId !== undefined && challengeId !== hack.challengeId)) {
        return { ok: false, reason: 'Repeated or stale press.' };
    }
    const value = typeof digit === 'string' && /^[0-9]$/.test(digit) ? Number(digit) : digit;
    if (!Number.isInteger(value) || value < 0 || value > 9) return { ok: false, reason: 'Invalid digit.' };
    if (value === hack.heldDigit) return { ok: false, reason: 'Release the key first.' };
    hack.heldDigit = value;
    if (value !== hack.digit) return { ok: false, reason: 'Wrong digit.' };
    if (world.elapsed - hack.lastAcceptedAt + 1e-9 < tuning.hackPressInterval) {
        return { ok: false, reason: 'Press too soon.' };
    }
    const planet = world.planets[hack.bodyId];
    if (isHome(world, bodyFor(hack.bodyId))) return { ok: false, reason: 'Home is protected.' };
    hack.progress += 1;
    hack.lastAcceptedAt = world.elapsed;
    if (hack.progress >= hack.required) {
        Object.assign(planet, { owner: world.player.id, level: 0, stock: 0,
            nextCargoAt: world.elapsed + tuning.cargoSpawnInterval });
        for (const key of ['turrets', 'turretHealth', 'turretDisabledUntil', 'turretAngle', 'nextShotAt']) delete planet[key];
        world.stats.captures += 1;
        emit(world, 'hackCompleted', { bodyId: hack.bodyId });
        emit(world, 'captured', { bodyId: hack.bodyId });
        world.hack = null;
        return { ok: true, reason: 'Captured.' };
    }
    hack.digit = challengeDigit(planet.level, hack.digit);
    hack.challengeId += 1;
    emit(world, 'hackProgress', { bodyId: hack.bodyId, amount: hack.progress });
    return { ok: true, reason: 'Advanced.' };
}

const upgrades = Object.freeze([
    { name: 'Barrier + turret', description: 'Stops hostile shots crossing the small field and adds the first turret.' },
    { name: 'Second turret', description: 'Adds a second turret on another side of the planet.' },
    { name: 'Field + turret', description: 'Adds a third turret and a large soft field that repels hostile rockets and slows bullets.' }
]);

// Describe only the docked planet's next purchase, distinguishing eligibility from affordability.
export function nextUpgrade(world) {
    const bodyId = world.player.docked;
    const planet = world.planets[bodyId];
    const level = planet?.level ?? 0;
    const upgrade = upgrades[level];
    const cost = tuning.upgradeCosts[level] ?? 0;
    let reason = '';
    if (world.player.deadUntil) reason = 'Respawning.';
    else if (!planet) reason = 'Dock at an owned relay.';
    else if (isHome(world, bodyFor(bodyId))) reason = 'Home has no relay.';
    else if (planet.owner !== world.player.id) reason = 'Capture this planet first.';
    else if (!upgrade) reason = 'All upgrades complete.';
    const available = !reason;
    const affordable = available && world.player.cargo >= cost;
    return { cost, name: upgrade?.name ?? 'Complete', description: upgrade?.description ?? 'No further upgrades.',
        available, affordable, reason: reason || (affordable ? '' : 'Not enough cargo.') };
}

// Spend cargo atomically on the one next defense tier, capped at level three.
export function upgradePlanet(world) {
    const upgrade = nextUpgrade(world);
    if (!upgrade.available || !upgrade.affordable) return { ok: false, reason: upgrade.reason };
    const bodyId = world.player.docked;
    world.player.cargo -= upgrade.cost;
    world.planets[bodyId].level += 1;
    prepareTurrets(world.planets[bodyId]);
    emit(world, 'upgraded', { bodyId, amount: world.planets[bodyId].level });
    return { ok: true, reason: upgrade.name };
}

// End a refueling interval once, keeping event counts independent of frame rate.
function stopRefueling(world) {
    if (!world.refueling) return;
    emit(world, 'refuelEnded', { bodyId: world.refueling });
    world.refueling = null;
}

// Flush accumulated service cargo without ever modifying an event a consumer may already have seen.
function flushCollection(world) {
    const collection = world.pendingCollection;
    if (!collection) return;
    emit(world, 'cargoCollected', { bodyId: collection.bodyId, amount: collection.amount });
    world.pendingCollection = null;
}

// Spend fuel as impact health; only damage exceeding the tank destroys the rocket.
function damagePlayer(world, amount, reason, cause = {}) {
    const player = world.player;
    if (player.deadUntil || !Number.isFinite(amount) || amount <= 0) return false;
    const fatal = amount > player.fuel;
    player.fuel = Math.max(0, player.fuel - amount);
    player.damageFlashUntil = world.elapsed + 0.3;
    emit(world, 'damaged', { amount, fuel: player.fuel, reason, x: player.x, y: player.y });
    if (fatal) killPlayer(world, reason, cause);
    return fatal;
}

// Drop cargo once and schedule a short home respawn without releasing territory.
export function killPlayer(world, reason = 'Destroyed.', cause = {}) {
    const player = world.player;
    if (player.deadUntil) return false;
    detach(world);
    stopRefueling(world);
    flushCollection(world);
    if (player.cargo > 0) {
        world.pickups.push({ id: `cargo-${world.eventCounter + 1}`, x: player.x, y: player.y,
            vx: player.vx * 0.25, vy: player.vy * 0.25, amount: player.cargo,
            expiresAt: world.elapsed + tuning.pickupLifetime });
        if (world.pickups.length > tuning.maxPickups) world.pickups.shift();
        emit(world, 'cargoDropped', { amount: player.cargo });
    }
    const previousTier = player.rocketTier || 0;
    player.rocketTier = Math.max(0, previousTier - 1);
    player.lastLostTier = previousTier > 0 ? previousTier : 0;
    player.cargo = 0;
    player.deadUntil = world.elapsed + tuning.respawnDelay;
    player.landedOn = null;
    player.vx = 0;
    player.vy = 0;
    player.rotationVelocity = 0;
    world.stats.deaths += 1;
    emit(world, 'died', { reason, previousTier, rocketTier: player.rocketTier,
        ...(cause.attackerId ? { attackerId: cause.attackerId, source: cause.source } : {}) });
    return true;
}

// Recreate a safe stationary home launch state after the death timer expires.
function respawn(world) {
    const home = bodyFor(world.player.homeId);
    Object.assign(world.player, {
        x: home.x, y: home.y - home.radius - tuning.shipRadius, vx: 0, vy: 0,
        angle: 0, rotationVelocity: 0, fuel: tuning.maxFuel, cargo: 0,
        landedOn: home.id, docked: null, deadUntil: 0, aimAngle: 0, gunHeat: 0, gunOverheatedUntil: 0
    });
    emit(world, 'respawned', { bodyId: home.id });
}

// Find the first swept entry into a circle, including a segment that starts inside it.
function circleHit(start, end, center, radius) {
    const px = start.x - center.x;
    const py = start.y - center.y;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const c = px * px + py * py - radius * radius;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    if (a === 0) return null;
    const b = 2 * (px * dx + py * dy);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const fraction = (-b - Math.sqrt(discriminant)) / (2 * a);
    return fraction >= 0 && fraction <= 1 ? fraction : null;
}

// Return the first entry or exit of a bullet shield, allowing shots wholly inside it to hit.
function circleCrossing(start, end, center, radius) {
    const px = start.x - center.x;
    const py = start.y - center.y;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const a = dx * dx + dy * dy;
    if (a === 0) return null;
    const b = 2 * (px * dx + py * dy);
    const c = px * px + py * py - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
        .find(fraction => fraction >= 0 && fraction <= 1) ?? null;
}

// Sweep the rocket center through one expanded relay part, retaining the contact face normal.
function boxHit(start, end, box) {
    let entry = 0;
    let exit = 1;
    let nx = 0;
    let ny = 0;
    if (start.x >= box.left && start.x <= box.right && start.y >= box.top && start.y <= box.bottom) {
        const faces = [
            { gap: start.x - box.left, x: box.left, y: start.y, nx: -1, ny: 0 },
            { gap: box.right - start.x, x: box.right, y: start.y, nx: 1, ny: 0 },
            { gap: start.y - box.top, x: start.x, y: box.top, nx: 0, ny: -1 },
            { gap: box.bottom - start.y, x: start.x, y: box.bottom, nx: 0, ny: 1 }
        ];
        return { ...faces.reduce((best, face) => face.gap < best.gap ? face : best), fraction: 0 };
    }
    for (const axis of ['x', 'y']) {
        const delta = end[axis] - start[axis];
        const minimum = axis === 'x' ? box.left : box.top;
        const maximum = axis === 'x' ? box.right : box.bottom;
        if (Math.abs(delta) < 1e-12) {
            if (start[axis] < minimum || start[axis] > maximum) return null;
            continue;
        }
        const first = Math.min((minimum - start[axis]) / delta, (maximum - start[axis]) / delta);
        const last = Math.max((minimum - start[axis]) / delta, (maximum - start[axis]) / delta);
        if (first > entry) {
            entry = first;
            nx = axis === 'x' ? -Math.sign(delta) : 0;
            ny = axis === 'y' ? -Math.sign(delta) : 0;
        }
        exit = Math.min(exit, last);
        if (entry > exit) return null;
    }
    if (exit < 0 || entry > 1) return null;
    return { fraction: entry, x: start.x + (end.x - start.x) * entry,
        y: start.y + (end.y - start.y) * entry, nx, ny };
}

// Gather the earliest star, surface, station, or hard home shield contact along a motion segment.
function firstContact(world, start, end) {
    let first = null;
    // Only earlier contacts replace a candidate, giving stars priority in coincident geometry.
    const consider = contact => {
        if (contact && (!first || contact.fraction < first.fraction)) first = contact;
    };
    for (const star of systems) {
        const fraction = circleHit(start, end, star, star.radius + tuning.shipRadius);
        if (fraction !== null) consider({ fraction, type: 'star', body: star });
    }
    for (const body of bodies) {
        const planet = world.planets[body.id];
        if (planet.owner && planet.owner !== world.player.id && isHome(world, body)) {
            const fraction = circleHit(start, end, body, body.radius + tuning.homeShieldAltitude + tuning.shipRadius);
            if (fraction !== null) consider({ fraction, type: 'homeShield', body });
        }
        const surfaceRadius = body.radius + tuning.shipRadius;
        const startDistance = Math.hypot(start.x - body.x, start.y - body.y);
        const movingOut = Math.abs(startDistance - surfaceRadius) < 1e-7
            && (start.x - body.x) * (end.x - start.x) + (start.y - body.y) * (end.y - start.y) > 0;
        const fraction = movingOut ? null : circleHit(start, end, body, surfaceRadius);
        if (fraction !== null) consider({ fraction, type: 'surface', body });
        if (isHome(world, body)) continue;
        const station = stationFor(body);
        if (Math.max(start.x, end.x) < station.x - 100 || Math.min(start.x, end.x) > station.x + 100
            || Math.max(start.y, end.y) < station.y - 100 || Math.min(start.y, end.y) > station.y + 100) continue;
        for (const part of stationGeometry) {
            const hit = boxHit(start, end, {
                left: station.x + part.left - tuning.shipRadius,
                right: station.x + part.right + tuning.shipRadius,
                top: station.y + part.top - tuning.shipRadius,
                bottom: station.y + part.bottom + tuning.shipRadius
            });
            if (hit) consider({ ...hit, type: 'station', body });
        }
    }
    return first;
}

// Dampen gentle collisions using the existing rebound speed and tangential damping.
function bounce(player, nx, ny) {
    const incoming = player.vx * nx + player.vy * ny;
    if (incoming >= 0) return;
    const rebound = Math.min(3, Math.max(1, -incoming * 0.15));
    player.vx = (player.vx - incoming * nx) * 0.65 + rebound * nx;
    player.vy = (player.vy - incoming * ny) * 0.65 + rebound * ny;
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > 6) {
        player.vx *= 6 / speed;
        player.vy *= 6 / speed;
    }
}

// Resolve the earliest swept collision, making only aligned slow pad landings eligible for service.
function resolveMovement(world, start, end) {
    const player = world.player;
    const hit = firstContact(world, start, end);
    player.x = end.x;
    player.y = end.y;
    if (!hit) return;
    player.x = start.x + (end.x - start.x) * hit.fraction;
    player.y = start.y + (end.y - start.y) * hit.fraction;
    if (hit.type === 'star') {
        killPlayer(world, `Star contact: ${hit.body.name}.`);
        return;
    }
    const speed = Math.hypot(player.vx, player.vy);
    if ((hit.type === 'surface' && speed > tuning.surfaceCrashSpeed)
        || (hit.type === 'station' && speed >= tuning.stationCrashSpeed)) {
        const threshold = hit.type === 'surface' ? tuning.surfaceCrashSpeed : tuning.stationCrashSpeed;
        const damage = Math.max(1, Math.ceil((speed - threshold) * tuning.impactFuelDamageRate));
        if (damagePlayer(world, damage, `${hit.type === 'surface' ? 'Surface' : 'Station'} impact: ${hit.body.name}.`)) return;
    }
    let nx = hit.nx;
    let ny = hit.ny;
    if (hit.type !== 'station') {
        const distance = Math.hypot(player.x - hit.body.x, player.y - hit.body.y);
        nx = distance ? (player.x - hit.body.x) / distance : 0;
        ny = distance ? (player.y - hit.body.y) / distance : -1;
        const radius = hit.body.radius + tuning.shipRadius
            + (hit.type === 'homeShield' ? tuning.homeShieldAltitude : 0);
        player.x = hit.body.x + nx * radius;
        player.y = hit.body.y + ny * radius;
    } else {
        player.x = hit.x;
        player.y = hit.y;
    }
    if (hit.type === 'surface' && speed <= tuning.safeLandingSpeed) {
        player.vx = 0;
        player.vy = 0;
        player.landedOn = hit.body.id;
        if (Math.abs(player.x - hit.body.x) <= tuning.padHalfWidth && ny < 0
            && Math.abs(normalizeAngle(player.angle)) <= tuning.safeLandingAngle) {
            emit(world, 'landed', { bodyId: hit.body.id });
        }
        return;
    }
    player.x += nx * 0.01;
    player.y += ny * 0.01;
    bounce(player, nx, ny);
}

// Apply soft hostile fields without clamping rocket positions or changing friendly motion.
function repelRockets(world, dt) {
    const player = world.player;
    for (const body of bodies) {
        const planet = world.planets[body.id];
        if (!planet.owner || planet.owner === player.id) continue;
        const dx = player.x - body.x;
        const dy = player.y - body.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const home = isHome(world, body);
        const small = body.radius + (home ? tuning.homeShieldAltitude : tuning.smallShieldAltitude);
        const outer = body.radius + tuning.outerFieldAltitude;
        const force = distance < small ? tuning.rocketRepulsion * (1 - distance / small)
            : planet.level >= 3 && distance < outer ? tuning.outerRepulsion * (1 - distance / outer) : 0;
        player.vx += dx / distance * force * dt;
        player.vy += dy / distance * force * dt;
    }
}

// Release a banked cargo pod from a random surface point into a stable local orbit.
function launchPlanetCargo(world, body, planet) {
    const seed = world.elapsed * 13.37 + body.x * 0.001 + body.y * 0.002 + planet.nextCargoAt * 7.1;
    const random = value => {
        const sample = Math.sin(value * 12.9898) * 43758.5453;
        return sample - Math.floor(sample);
    };
    const orbitAngle = random(seed) * Math.PI * 2;
    const direction = random(seed + 31.7) < 0.5 ? -1 : 1;
    const altitude = tuning.cargoSurfaceOffset + random(seed + 83.2) * tuning.cargoAltitudeVariation;
    const distance = body.radius + altitude;
    const x = body.x + Math.cos(orbitAngle) * distance;
    const y = body.y + Math.sin(orbitAngle) * distance;
    const gravity = gravityAt(x, y);
    const circularSpeed = Math.sqrt(Math.max(0, gravity.magnitude * distance));
    const speedVariation = (random(seed + 121.9) * 2 - 1) * tuning.cargoOrbitSpeedVariation;
    const speed = circularSpeed * (1 + speedVariation);
    world.pickups.push({ id: `planet-cargo-${body.id}-${Math.round(world.elapsed * 1000)}`,
        bodyId: body.id, orbiting: true, x, y,
        vx: -Math.sin(orbitAngle) * speed * direction,
        vy: Math.cos(orbitAngle) * speed * direction,
        amount: 1, expiresAt: world.elapsed + tuning.pickupLifetime });
    planet.stock -= 1;
    planet.nextCargoAt = world.elapsed + tuning.cargoSpawnInterval;
}

// Refill only on an upright owned pad; cargo must be collected from the nearby floating pods.
function servicePad(world, dt) {
    const player = world.player;
    const body = bodyFor(player.landedOn);
    const planet = body && world.planets[body.id];
    if (!body || planet.owner !== player.id || player.deadUntil || player.docked
        || Math.abs(player.x - body.x) > tuning.padHalfWidth || player.y >= body.y
        || Math.abs(Math.hypot(player.x - body.x, player.y - body.y) - body.radius - tuning.shipRadius) > 0.1
        || Math.hypot(player.vx, player.vy) > 0.01
        || Math.abs(normalizeAngle(player.angle)) > tuning.safeLandingAngle) {
        stopRefueling(world);
        flushCollection(world);
        return;
    }
    flushCollection(world);
    if (player.fuel < tuning.maxFuel) {
        if (world.refueling !== body.id) {
            stopRefueling(world);
            world.refueling = body.id;
            emit(world, 'refuelStarted', { bodyId: body.id });
        }
        const baseRate = body.id === player.homeId ? tuning.homeRefuelRate : tuning.refuelRate;
        player.fuel = Math.min(tuning.maxFuel,
            player.fuel + baseRate * Math.max(0.15, 1 - player.fuel / tuning.maxFuel) * dt);
        if (tuning.maxFuel - player.fuel <= tuning.refuelSnap) player.fuel = tuning.maxFuel;
    }
    if (player.fuel >= tuning.maxFuel) stopRefueling(world);
}

// Create one aimed projectile, retaining a world-time cooldown across drained events and saves.
function firePlayer(world, input) {
    const player = world.player;
    if (!input.fire || player.deadUntil || player.docked || world.projectiles.length >= tuning.maxProjectiles
        || world.elapsed + 1e-9 < (player.gunOverheatedUntil || 0)
        || world.elapsed + 1e-9 < (player.nextShotAt || 0)) return;
    const tier = player.rocketTier || 0;
    const barrels = tier >= 2 && tier < 4 ? [-5, 5] : [tier >= 4 ? (player.nextBarrel ? 5 : -5) : 0];
    if (world.projectiles.length + barrels.length > tuning.maxProjectiles) return;
    const dx = Math.cos(player.aimAngle);
    const dy = Math.sin(player.aimAngle);
    const speed = tuning.bulletSpeed * (tier >= 4 ? 1.3 : 1);
    for (const offset of barrels) world.projectiles.push({ id: `shot-${player.id}-${world.eventCounter + 1}-${offset}`, owner: player.id, source: 'player',
        x: player.x + dx * (tuning.shipRadius + 5) - dy * offset,
        y: player.y + dy * (tuning.shipRadius + 5) + dx * offset,
        vx: player.vx + dx * speed, vy: player.vy + dy * speed,
        radius: tuning.bulletRadius, expiresAt: world.elapsed + tuning.bulletLifetime });
    player.nextBarrel = !player.nextBarrel;
    if (!player.landedOn) {
        player.vx -= dx * tuning.shotRecoil;
        player.vy -= dy * tuning.shotRecoil;
    }
    player.nextShotAt = world.elapsed + tuning.fireCooldown * (tier >= 4 ? .32 : tier >= 1 ? .8 : 1);
    player.gunHeat = Math.min(1, (player.gunHeat || 0) + tuning.gunHeatPerShot * (tier >= 4 ? .28 : tier >= 1 ? .7 : 1));
    if (player.gunHeat >= 1) {
        player.gunHeat = 1;
        player.gunOverheatedUntil = world.elapsed + tuning.gunOverheatDuration;
        emit(world, 'gunOverheated');
    }
    world.stats.shots += barrels.length;
    emit(world, 'fired');
}

// Cool the barrel over time and fade its heat through the fixed overheat lockout.
function coolPlayerGun(player, dt, elapsed) {
    player.gunHeat = Number.isFinite(player.gunHeat) ? player.gunHeat : 0;
    const overheatedUntil = Number.isFinite(player.gunOverheatedUntil) ? player.gunOverheatedUntil : 0;
    if (elapsed < overheatedUntil) {
        player.gunHeat = Math.min(1, (overheatedUntil - elapsed) / tuning.gunOverheatDuration);
        return;
    }
    if (overheatedUntil > 0) {
        player.gunOverheatedUntil = 0;
        player.gunHeat = 0;
        return;
    }
    player.gunHeat = Math.max(0, player.gunHeat - tuning.gunCoolingRate * dt);
}

// Keep added turrets in fixed, evenly spaced slots so upgrades never move an existing defense.
export function turretPositions(body, level) {
    const count = Math.max(0, Math.min(3, Math.floor(level || 0)));
    return Array.from({ length: count }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / 3;
        return { index, angle, x: body.x + Math.cos(angle) * (body.radius + 26),
            y: body.y + Math.sin(angle) * (body.radius + 26) };
    });
}

// Preserve the original turret on old saves and give each new upgrade independent health and timing.
function prepareTurrets(planet) {
    if (!Array.isArray(planet.turrets)) {
        planet.turrets = [];
        if (planet.level >= 2 && planet.turretHealth !== undefined) {
            planet.turrets.push({ health: planet.turretHealth, angle: planet.turretAngle ?? -Math.PI / 2,
                disabledUntil: planet.turretDisabledUntil || 0, nextShotAt: planet.nextShotAt || 0 });
        }
    }
    const count = Math.max(0, Math.min(3, planet.level));
    planet.turrets.length = Math.min(planet.turrets.length, count);
    while (planet.turrets.length < count) {
        const index = planet.turrets.length;
        planet.turrets.push({ health: tuning.turretHealth, angle: -Math.PI / 2 + index * Math.PI * 2 / 3,
            disabledUntil: 0, nextShotAt: 0 });
    }
    for (const key of ['turretHealth', 'turretDisabledUntil', 'turretAngle', 'nextShotAt']) delete planet[key];
    return planet.turrets;
}

// Aim and fire every independent turret at its nearest visible enemy once per galaxy step.
function fireTurrets(world) {
    const players = world.players ? Object.values(world.players).map(actor => actor.player) : [world.player];
    for (const body of bodies) {
        const planet = world.planets[body.id];
        if (!planet.owner || planet.level < 1) continue;
        const states = prepareTurrets(planet);
        const refuge = dockingPoint(body);
        for (const { x, y, index } of turretPositions(body, planet.level)) {
            const turret = states[index];
            if (turret.disabledUntil > world.elapsed) {
                turret.health = tuning.turretHealth * Math.max(0, 1 - (turret.disabledUntil - world.elapsed) / tuning.turretRecoveryDuration);
                continue;
            }
            if (turret.disabledUntil) {
                turret.disabledUntil = 0;
                turret.health = tuning.turretHealth;
                turret.nextShotAt = world.elapsed;
            }
            let target = null;
            let distance = tuning.turretRange;
            for (const player of players) {
                if (player.deadUntil || player.id === planet.owner
                    || Math.hypot(player.x - refuge.x, player.y - refuge.y) <= tuning.refugeRadius + tuning.shipRadius) continue;
                const candidateDistance = Math.hypot(player.x - x, player.y - y);
                if (candidateDistance < 1 || candidateDistance > distance
                    || circleHit({ x, y }, player, body, body.radius) !== null) continue;
                target = player; distance = candidateDistance;
            }
            if (!target) continue;
            turret.angle = Math.atan2(target.y - y, target.x - x);
            if (world.elapsed + 1e-9 < turret.nextShotAt || world.projectiles.length >= tuning.maxProjectiles) continue;
            world.projectiles.push({ id: `turret-${world.eventCounter + 1}`, owner: planet.owner,
                source: 'turret', bodyId: body.id, turretIndex: index, x, y,
                vx: (target.x - x) / distance * tuning.turretBulletSpeed,
                vy: (target.y - y) / distance * tuning.turretBulletSpeed,
                radius: tuning.bulletRadius, expiresAt: world.elapsed + tuning.bulletLifetime });
            turret.nextShotAt = world.elapsed + tuning.turretCooldown;
            emit(world, 'turretFired', { bodyId: body.id, turretIndex: index });
        }
    }
}

// Disable only the turret that was hit; further hits never extend its recovery timer.
function hitTurret(world, body, index) {
    const turret = prepareTurrets(world.planets[body.id])[index];
    if (!turret || turret.disabledUntil > world.elapsed) return;
    turret.health = Math.max(0, turret.health - 1);
    if (turret.health === 0) turret.disabledUntil = world.elapsed + tuning.turretRecoveryDuration;
}

// Step one projectile through shields and refuge before its swept moving-player hit can apply.
function moveProjectile(world, shot, dt, previousPlayer) {
    if (![shot.x, shot.y, shot.vx, shot.vy].every(Number.isFinite)) return false;
    shot.expiresAt ??= world.elapsed + tuning.bulletLifetime;
    if (shot.expiresAt <= world.elapsed) return false;
    const radius = Number.isFinite(shot.radius) ? Math.max(0, shot.radius) : tuning.bulletRadius;
    const start = { x: shot.x, y: shot.y };
    let end = { x: shot.x + shot.vx * dt, y: shot.y + shot.vy * dt };
    const interactions = [];
    for (const body of bodies) {
        const planet = world.planets[body.id];
        if (planet.owner && planet.owner !== shot.owner) {
            const home = isHome(world, body);
            const small = body.radius + (home ? tuning.homeShieldAltitude : tuning.smallShieldAltitude);
            const fraction = home ? circleHit(start, end, body, small + radius)
                : circleCrossing(start, end, body, small + radius);
            if (fraction !== null) interactions.push({ fraction, type: home || planet.level >= 1 ? 'shield' : 'slow', body });
            if (planet.level >= 3) {
                const outerFraction = circleCrossing(start, end, body, body.radius + tuning.outerFieldAltitude + radius);
                if (outerFraction !== null) interactions.push({ fraction: outerFraction, type: 'outer', body });
            }
        }
        if (planet.owner && planet.owner !== shot.owner && planet.level >= 1 && shot.source === 'player') {
            for (const turret of turretPositions(body, planet.level)) {
                const fraction = circleHit(start, end, turret, tuning.turretRadius + radius);
                if (fraction !== null) interactions.push({ fraction, type: 'turret', body, turretIndex: turret.index });
            }
        }
        const surface = circleHit(start, end, body, body.radius + radius);
        if (surface !== null) interactions.push({ fraction: surface, type: 'surface', body });
        if (shot.source === 'turret') {
            const fraction = circleHit(start, end, dockingPoint(body), tuning.refugeRadius + radius);
            if (fraction !== null) interactions.push({ fraction, type: 'refuge', body });
        }
    }
    for (const star of systems) {
        const fraction = circleHit(start, end, star, star.radius + radius);
        if (fraction !== null) interactions.push({ fraction, type: 'surface', body: star });
    }
    const targets = world.players ? Object.values(world.players).map(actor => actor.player) : [world.player];
    for (const player of targets) if (!player.deadUntil && shot.owner !== player.id) {
        const previous = world.previousPlayers?.[player.id] || previousPlayer;
        const relativeStart = { x: start.x - previous.x, y: start.y - previous.y };
        const relativeEnd = { x: end.x - player.x, y: end.y - player.y };
        const fraction = circleHit(relativeStart, relativeEnd, { x: 0, y: 0 }, tuning.shipRadius + radius);
        if (fraction !== null) interactions.push({ fraction, type: 'player', playerId: player.id });
    }
    interactions.sort((a, b) => a.fraction - b.fraction);
    let travelFraction = 1;
    for (const interaction of interactions) {
        if (interaction.fraction > travelFraction) break;
        if (interaction.type === 'slow' || interaction.type === 'outer') {
            const key = `${interaction.type}:${interaction.body.id}`;
            shot.slowedBy ??= [];
            if (shot.slowedBy.includes(key)) continue;
            shot.slowedBy.push(key);
            const factor = interaction.type === 'slow' ? tuning.bulletSlowFactor : tuning.outerBulletSlowFactor;
            shot.vx *= factor;
            shot.vy *= factor;
            travelFraction = interaction.fraction + (travelFraction - interaction.fraction) * factor;
            continue;
        }
        if (interaction.type === 'player') {
            const reason = shot.source === 'turret' ? 'Turret hit.' : 'Projectile hit.';
            const cause = { attackerId: shot.owner, source: shot.source };
            if (world.players) withPlayer(world, interaction.playerId, () => damagePlayer(world, tuning.shotFuelDamage, reason, cause));
            else damagePlayer(world, tuning.shotFuelDamage, reason, cause);
        }
        else if (interaction.type === 'turret') hitTurret(world, interaction.body, interaction.turretIndex);
        else if (interaction.type === 'shield') emit(world, 'shieldBlocked', { bodyId: interaction.body.id });
        else if (interaction.type === 'refuge') emit(world, 'refugeBlocked', { bodyId: interaction.body.id });
        return false;
    }
    end = { x: start.x + (end.x - start.x) * travelFraction, y: start.y + (end.y - start.y) * travelFraction };
    shot.x = end.x;
    shot.y = end.y;
    return true;
}

// Orbit planet cargo, drift death drops, expire, and collect with swept player-relative contact.
function movePickups(world, dt, previousPlayer) {
    world.pickups = world.pickups.filter(pickup => {
        if (pickup.expiresAt <= world.elapsed || !Number.isFinite(pickup.amount) || pickup.amount <= 0) return false;
        const pickupStart = { x: pickup.x, y: pickup.y };
        const pilots = world.players ? Object.values(world.players).map(actor => actor.player) : [world.player];
        const alive = pilots.filter(player => !player.deadUntil);
        const nearest = alive.reduce((best, player) => !best || Math.hypot(player.x - pickup.x, player.y - pickup.y)
            < Math.hypot(best.x - pickup.x, best.y - pickup.y) ? player : best, null);
        if (pickup.orbiting) {
            const gravity = gravityAt(pickup.x, pickup.y);
            pickup.vx = (pickup.vx || 0) + gravity.ax * dt;
            pickup.vy = (pickup.vy || 0) + gravity.ay * dt;
        }
        // Gently attract only nearby cargo; distant orbits and powerless coasting stay unchanged.
        const dx = nearest ? nearest.x - pickup.x : 0;
        const dy = nearest ? nearest.y - pickup.y : 0;
        const distance = Math.hypot(dx, dy);
        if (nearest && distance > 0 && distance < tuning.cargoAttractionRadius) {
            const acceleration = tuning.cargoAttractionAcceleration * (1 - distance / tuning.cargoAttractionRadius);
            pickup.vx = (pickup.vx || 0) + dx / distance * acceleration * dt;
            pickup.vy = (pickup.vy || 0) + dy / distance * acceleration * dt;
        }
        pickup.x += (pickup.vx || 0) * dt;
        pickup.y += (pickup.vy || 0) * dt;
        const contacts = alive.map(player => {
            const previous = world.previousPlayers?.[player.id] || previousPlayer;
            const fraction = circleHit({ x: pickupStart.x - previous.x, y: pickupStart.y - previous.y },
                { x: pickup.x - player.x, y: pickup.y - player.y }, { x: 0, y: 0 }, tuning.pickupRadius + tuning.shipRadius);
            return { player, fraction };
        }).filter(contact => contact.fraction !== null).sort((a, b) => a.fraction - b.fraction);
        if (contacts.length) {
            const collect = () => {
                world.player.cargo += pickup.amount;
                world.stats.cargoCollected += pickup.amount;
                emit(world, 'cargoPickedUp', { amount: pickup.amount });
            };
            if (world.players) withPlayer(world, contacts[0].player.id, collect);
            else collect();
            return false;
        }
        return true;
    });
}

// Accelerate toward the cursor and brake before alignment so fast aim changes produce controlled lag.
function turnTowardAim(player, aimAngle, dt, power) {
    const error = normalizeAngle(aimAngle + Math.PI / 2 - player.angle);
    const agility = 1 + (player.rocketTier || 0) * .08;
    const acceleration = tuning.aimRotationAcceleration * power * agility;
    const previousRate = Number.isFinite(player.rotationVelocity) ? player.rotationVelocity : 0;
    // Damping starts braking while the cursor is still ahead, avoiding a snap at alignment.
    const turnAcceleration = Math.max(-acceleration, Math.min(acceleration, error * tuning.aimRotationResponse - previousRate * tuning.aimRotationDamping));
    player.rotationVelocity = power > 0 ? Math.max(-tuning.maxAimRotationRate * agility,
        Math.min(tuning.maxAimRotationRate * agility, previousRate + turnAcceleration * dt)) : 0;
    player.angle = normalizeAngle(player.angle + player.rotationVelocity * dt);
}

// Remove only axial velocity, easing near rest and clamping the change so braking never reverses motion.
function brakeAlongNose(player, dt, power) {
    const noseX = Math.sin(player.angle);
    const noseY = -Math.cos(player.angle);
    const speed = player.vx * noseX + player.vy * noseY;
    const speedMultiplier = 1 + Math.min(2, Math.abs(speed) / 300);
    const effectivePower = power * speedMultiplier * (1 + (player.rocketTier || 0) * .08);
    const amount = Math.min(Math.abs(speed), tuning.brakeAcceleration * dt * effectivePower,
        Math.abs(speed) * (1 - Math.exp(-tuning.brakeResponse * dt * effectivePower)));
    let change = Math.sign(speed) * amount;
    if (power > 0 && Math.abs(speed - change) < 0.05) change = speed;
    player.vx -= noseX * change;
    player.vy -= noseY * change;
}

// Preserve full main thrust, local RCS, and ramped rotation while allowing powerless coasting.
function movePlayer(world, input, dt) {
    const player = world.player;
    const aiming = Number.isFinite(input.aimAngle);
    const aimError = aiming ? normalizeAngle(input.aimAngle + Math.PI / 2 - player.angle) : 0;
    let rotate = aiming ? (Math.abs(aimError) > 0.001 || Math.abs(player.rotationVelocity || 0) > 0.001 ? 1 : 0)
        : control(input.rotate);
    let rcsX = control(input.rcsX);
    let rcsY = control(input.rcsY);
    let burning = input.burn === true || (Number.isFinite(input.burn) && input.burn > 0);
    if (player.fuel <= 0) {
        player.fuel = 0;
        rotate = 0;
        rcsX = 0;
        rcsY = 0;
        burning = false;
    }
    // Braking a serviced, stationary ship must not launch or detach it.
    if (rcsY > 0 && (player.landedOn || player.docked)) rcsY = 0;
    const moving = burning || rcsX !== 0 || rcsY !== 0;
    if (player.docked && !moving) {
        player.rotationVelocity = 0;
        return;
    }
    if (player.docked) detach(world);
    const fuelCost = dt * ((player.rocketTier || 0) >= 3 ? .8 : 1) / tuning.fuelCapacityScale * ((burning ? tuning.mainFuelRate : 0)
        + tuning.rcsFuelRate * (Math.abs(rcsX) + Math.abs(rcsY)) + tuning.rotationFuelRate * Math.abs(rotate));
    const power = fuelCost > 0 ? Math.min(1, player.fuel / fuelCost) : Number(player.fuel > 0);
    player.fuel = Math.max(0, player.fuel - fuelCost);
    if (aiming) {
        turnTowardAim(player, input.aimAngle, dt, power);
    } else {
        const previousRotation = Number.isFinite(player.rotationVelocity) ? player.rotationVelocity : 0;
        const rotationSpeed = Math.sign(previousRotation) === Math.sign(rotate)
            ? Math.max(tuning.rotationRate, Math.abs(previousRotation)) : tuning.rotationRate;
        player.rotationVelocity = rotate * Math.min(tuning.maxRotationRate,
            rotationSpeed + tuning.rotationAcceleration * dt) * power;
        player.angle = normalizeAngle(player.angle + player.rotationVelocity * dt);
    }
    if (player.landedOn && !moving) return;
    player.landedOn = null;
    const gravity = gravityAt(player.x, player.y);
    const tier = player.rocketTier || 0;
    const bonus = tier ? (.5 + (tier - 1) * .08) / (1 + Math.hypot(player.vx, player.vy) / 180) : 0;
    const thrust = burning ? tuning.mainAcceleration * (1 + bonus) : 0;
    const axialThrust = Math.min(0, rcsY);
    const rcsAx = (rcsX * Math.cos(player.angle) * tuning.rcsAcceleration
        - axialThrust * Math.sin(player.angle) * tuning.rcsAcceleration) * power;
    const rcsAy = (rcsX * Math.sin(player.angle) * tuning.rcsAcceleration
        + axialThrust * Math.cos(player.angle) * tuning.rcsAcceleration) * power;
    player.vx += (gravity.ax + Math.sin(player.angle) * thrust * power + rcsAx) * dt;
    player.vy += (gravity.ay - Math.cos(player.angle) * thrust * power + rcsAy) * dt;
    if (rcsY > 0) brakeAlongNose(player, dt, power * rcsY);
    repelRockets(world, dt);
    const start = { x: player.x, y: player.y };
    const end = { x: player.x + player.vx * dt, y: player.y + player.vy * dt };
    resolveMovement(world, start, end);
}

// Advance bounded fixed substeps so service, swept combat, and respawning continue without active controls.
export function stepWorld(world, input = {}, dt = tuning.fixedStep) {
    if (!Number.isFinite(dt) || dt <= 0) return world;
    input ??= {};
    // Keep saved serviced rockets attached to pads and relays when galaxy positions change.
    const landedBody = bodyFor(world.player.landedOn);
    if (landedBody) {
        world.player.x = landedBody.x;
        world.player.y = landedBody.y - landedBody.radius - tuning.shipRadius;
    }
    const dockedBody = bodyFor(world.player.docked);
    if (dockedBody && !isHome(world, dockedBody)) {
        const dock = dockingPoint(dockedBody);
        world.player.x = dock.x; world.player.y = dock.y;
    }
    // Reconcile older saves so home cargo and removed home relays cannot persist.
    for (const body of bodies) if (isHome(world, body)) world.planets[body.id].stock = 0;
    world.pickups = world.pickups.filter(pickup => !pickup.orbiting || !pickup.bodyId || !isHome(world, bodyFor(pickup.bodyId)));
    if (world.player.docked && isHome(world, bodyFor(world.player.docked))) detach(world);
    const duration = Math.min(dt, tuning.maxStepDuration);
    const steps = Math.ceil(duration / tuning.fixedStep);
    const step = duration / steps;
    for (let index = 0; index < steps; index += 1) {
        world.elapsed += step;
        world.updatedAt = world.createdAt + world.elapsed * 1000;
        coolPlayerGun(world.player, step, world.elapsed);
        for (const [bodyId, planet] of Object.entries(world.planets)) {
            if (planet.owner && !isHome(world, bodyFor(bodyId))) {
                planet.stock = Math.min(tuning.maxStock, planet.stock + tuning.cargoRate * step);
                if (!Number.isFinite(planet.nextCargoAt)) planet.nextCargoAt = world.elapsed + tuning.cargoSpawnInterval;
                const body = bodyFor(bodyId);
                if (planet.stock >= 1 && world.elapsed + 1e-9 >= planet.nextCargoAt
                    && world.pickups.length < tuning.maxPickups && body) launchPlanetCargo(world, body, planet);
            }
        }
        const player = world.player;
        const previousPlayer = { x: player.x, y: player.y };
        if (player.deadUntil && world.elapsed + 1e-9 >= player.deadUntil) {
            respawn(world);
            previousPlayer.x = player.x;
            previousPlayer.y = player.y;
        }
        if (!player.deadUntil) {
            if (Number.isFinite(input.aimAngle)) player.aimAngle = normalizeAngle(input.aimAngle);
            movePlayer(world, input, step);
            servicePad(world, step);
            firePlayer(world, input);
        }
        fireTurrets(world);
        world.projectiles = world.projectiles.filter(shot => moveProjectile(world, shot, step, previousPlayer));
        movePickups(world, step, previousPlayer);
    }
    return world;
}

const actorFields = ['player', 'hack', 'target', 'stats', 'refueling'];

// Select one pilot's context while all actors continue sharing the same economy and entities.
export function withPlayer(world, playerId, action) {
    const actor = world.players?.[playerId];
    if (!actor) throw new Error('Unknown pilot');
    const previous = Object.fromEntries(actorFields.map(key => [key, world[key]]));
    for (const key of actorFields) world[key] = actor[key];
    try { return action(); }
    finally {
        for (const key of actorFields) actor[key] = world[key];
        Object.assign(world, previous);
    }
}

// Describe a pilot's next sequential rocket tier without trusting client-provided prices.
export function nextRocketUpgrade(world) {
    const tier = world.player.rocketTier || 0;
    const cost = tuning.rocketUpgradeCosts[tier];
    const names = ['Agility + rapid fire', 'Twin shooter', 'Fuel efficiency', 'Alternating rapid shooter'];
    const relay = world.planets[world.player.docked];
    const available = !world.player.deadUntil && relay?.owner === world.player.id && !isHome(world, bodyFor(world.player.docked)) && tier < 4;
    return { tier, cost: cost || 0, name: names[tier] || 'Fully upgraded', available,
        affordable: available && world.player.cargo >= cost };
}

// Charge one authoritative rocket purchase, retaining earlier tier benefits.
export function upgradeRocket(world) {
    const upgrade = nextRocketUpgrade(world);
    if (!upgrade.available || !upgrade.affordable) return { ok: false, reason: upgrade.available ? 'Not enough cargo.' : 'Rocket upgrade unavailable.' };
    world.player.cargo -= upgrade.cost;
    world.player.rocketTier = upgrade.tier + 1;
    emit(world, 'rocketUpgraded', { amount: world.player.rocketTier });
    return { ok: true, reason: upgrade.name };
}

// Advance the galaxy once per tick; each pilot moves once and entities are integrated only once.
export function stepGalaxy(world, inputs = {}, dt = tuning.fixedStep) {
    if (!Number.isFinite(dt) || dt <= 0 || !world.players) return world;
    const duration = Math.min(dt, tuning.maxStepDuration);
    const count = Math.ceil(duration / tuning.fixedStep);
    const step = duration / count;
    const ids = Object.keys(world.players).sort();
    for (let index = 0; index < count; index++) {
        world.elapsed += step;
        world.updatedAt = world.createdAt + world.elapsed * 1000;
        world.previousPlayers = {};
        for (const [bodyId, planet] of Object.entries(world.planets)) {
            if (planet.home) { planet.stock = 0; continue; }
            if (!planet.owner) continue;
            planet.stock = Math.min(tuning.maxStock, planet.stock + tuning.cargoRate * step);
            planet.nextCargoAt ??= world.elapsed + tuning.cargoSpawnInterval;
            if (planet.stock >= 1 && world.elapsed + 1e-9 >= planet.nextCargoAt && world.pickups.length < tuning.maxPickups) {
                launchPlanetCargo(world, bodyFor(bodyId), planet);
            }
        }
        for (const id of ids) withPlayer(world, id, () => {
            const player = world.player;
            const input = inputs[id] || {};
            const home = bodyFor(player.landedOn);
            if (home) { player.x = home.x; player.y = home.y - home.radius - tuning.shipRadius; }
            if (player.docked) Object.assign(player, dockingPoint(bodyFor(player.docked)));
            const previous = world.previousPlayers[id] = { x: player.x, y: player.y };
            coolPlayerGun(player, step, world.elapsed);
            if (player.deadUntil && world.elapsed + 1e-9 >= player.deadUntil) {
                respawn(world); previous.x = player.x; previous.y = player.y;
            }
            if (player.deadUntil) return;
            if (Number.isFinite(input.aimAngle)) player.aimAngle = normalizeAngle(input.aimAngle);
            movePlayer(world, input, step);
            servicePad(world, step);
            firePlayer(world, input);
        });
        fireTurrets(world);
        world.projectiles = world.projectiles.filter(shot => moveProjectile(world, shot, step, { x: 0, y: 0 }));
        movePickups(world, step, { x: 0, y: 0 });
        delete world.previousPlayers;
    }
    return world;
}
