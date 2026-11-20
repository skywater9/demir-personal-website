import {
    tuning as motionTuning, normalizeAngle, stationGeometry
} from './rocketPhysics.mjs?v=20261118-shop-price';

export { stationGeometry };

// Keep station geometry for the starting outpost and use surface pads for planetary shops.
export function stationFor(body) {
    return body.station ? { x: body.x, y: body.y } : { x: body.x, y: body.y - body.radius - 45 };
}

// Resolve attachment points without creating separate relays around planets.
export function dockingPoint(body) {
    return { x: body.station ? body.x - 58 : body.x, y: body.station ? body.y : body.y - body.radius - tuning.shipRadius, angle: 0,
        name: body.station ? 'Starter station' : `${body.name} surface` };
}

const planetCaptureRange = 250;

export const tuning = Object.freeze({
    ...motionTuning,
    mainAcceleration: 240, brakeAcceleration: 300, brakeResponse: 8,
    hackingDistance: planetCaptureRange, dockingSpeed: 20, dockingAngle: 35 * Math.PI / 180,
    gunHeatPerShot: 0.18, gunCoolingRate: 0.25, gunOverheatDuration: 2.5, shotRecoil: 1.25,
    shotFuelDamage: 5, impactFuelDamageRate: 0.5,
    maxStepDuration: 1, respawnDelay: 0.9,
    aimRotationAcceleration: 150, maxAimRotationRate: 8,
    aimRotationResponse: 100, aimRotationDamping: 20,
    cargoRate: 0.3, maxStock: 60, cargoSpawnInterval: 3.34, cargoSurfaceOffset: 70,
    cargoAltitudeVariation: 90, cargoOrbitSpeedVariation: 0.14,
    pickupLifetime: 90, pickupRadius: 30, maxPickups: 64,
    cargoAttractionRadius: 200, cargoAttractionAcceleration: 35,
    cargoBubbleSpeed: 100, cargoBubbleAcceleration: 100,
    refuelRate: 24, homeRefuelRate: 48, refuelSnap: 0.05,
    recaptureCooldown: 5, blackHoleInfluenceAltitude: 3500,
    hackPressInterval: 0.1, hackBasePresses: 8, hackExtraPresses: 2, captureDecayRate: .65,
    maxPlanetLevel: 10, maxRocketLevel: 10, turretRepairCooldown: 5,
    upgradeCosts: Object.freeze([8, 16, 28, ...Array.from({ length: 7 }, (_, index) => 40 + index * 12)]),
    homeShieldAltitude: 150, smallShieldAltitude: planetCaptureRange + motionTuning.shipRadius, outerFieldAltitude: 1000,
    rocketRepulsion: 24, outerRepulsion: 14, bulletSlowFactor: 0.45,
    outerBulletSlowFactor: 0.75, dockingDistance: 100, refugeRadius: 100,
    bulletSpeed: 680, bulletRadius: 3, bulletLifetime: 5, fireCooldown: 0.24,
    turretRange: 1700, turretCooldown: 1.4, turretBulletSpeed: 190, turretHomingRate: .28,
    turretHealth: 1, turretRadius: 32,
    rocketUpgradeCosts: Object.freeze([8, 16, 28, ...Array.from({ length: 7 }, (_, index) => 40 + index * 12)]),
    laserRange: 12000, laserFlashDuration: .14, blackHoleCargoCount: 6, blackHoleCargoValue: 5, blackHoleCargoInterval: 12,
    maxProjectiles: 256, maxEvents: 200
});

// Each system record is its central lethal star, keeping map and collision coordinates identical.
export const systems = Object.freeze([
    { id: 'sol', name: 'Sol', x: 0, y: 0, radius: 540, gravity: 18, color: '#fff0a6' },
    { id: 'vega', name: 'Vega', x: 9100, y: -6175, radius: 630, gravity: 22, color: '#e5f5ff' },
    { id: 'ember', name: 'Ember', x: -7150, y: -8450, radius: 480, gravity: 16, color: '#ffc58f' }
].map(system => Object.freeze(system)));

// Keep the central hazard separate from systems so it never generates planets.
export const blackHole = Object.freeze({ id: 'central-black-hole', name: 'Black hole',
    x: systems.reduce((sum, system) => sum + system.x, 0) / systems.length,
    y: systems.reduce((sum, system) => sum + system.y, 0) / systems.length - 1800,
    radius: 320, gravity: 360 });

const planetNames = [
    ['Earth', 'Moon', 'Venus', 'Mercury', 'Mars', 'Jupiter', 'Saturn', 'Neptune'],
    ['Aster', 'Cobalt', 'Iris', 'Lumen', 'Nacre', 'Opal', 'Prism', 'Vale'],
    ['Ash', 'Basalt', 'Cinder', 'Flint', 'Garnet', 'Ochre', 'Rust', 'Slate']
];
const planetColors = ['#4b91b5', '#a4a9b5', '#d7ad6b', '#a99786', '#bc7155', '#cfad8e', '#d6c291', '#587fbf'];
const planetGravity = [9.81, 1.62, 8.87, 3.7, 3.71, 24.79, 10.44, 11.15];

// Scatter eight stationary planets around each star without imposing a route or spawning opponents.
export const planetBodies = Object.freeze(systems.flatMap((system, systemIndex) =>
    planetNames[systemIndex].map((name, index) => {
        const angle = index * Math.PI / 4 + systemIndex * 0.18;
        const orbit = 2000 + (index % 3) * 450;
        return Object.freeze({
            id: name.toLowerCase(), name,
            x: systemIndex === 0 && (index === 1 || index === 7) ? 2000 : system.x + Math.cos(angle) * orbit,
            y: systemIndex === 0 && index === 1 ? -1100 : systemIndex === 0 && index === 7 ? 1500 : system.y + Math.sin(angle) * orbit,
            radius: Math.round([260, 145, 245, 170, 205, 380, 320, 270][index] * 0.8),
            gravity: planetGravity[index], color: planetColors[index], land: '#728579',
            gas: index >= 5, systemId: system.id
        });
    })
));

// Reserve small protected outposts for pilots without granting a starting planet.
export const starterStations = Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({
    id: `station-${index + 1}`, name: `Starter station ${index + 1}`, station: true,
    x: 2450 + (index % 4) * 450, y: 600 + Math.floor(index / 4) * 450,
    radius: 35, gravity: 0, color: '#8cbdcc', systemId: 'sol'
})));
export const bodies = Object.freeze([...planetBodies, ...starterStations]);

// Share the visible refueling box between rendering and authoritative service checks.
export function fuelZone(body) {
    const halfWidth = tuning.padHalfWidth + 16;
    return { left: body.x - halfWidth, right: body.x + halfWidth,
        top: body.y - body.radius - 110, bottom: body.y - body.radius + 15 };
}

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
    const home = starterStations[0];
    const world = {
        version: 2, upgradeTracksVersion: 2, id, createdAt: now, updatedAt: now, elapsed: 0,
        player: {
            id: 'pilot', color: '#8ac4a8', homeId: home.id, rocketTier: 0, weaponTier: 0,
            ...dockingPoint(home),
            vx: 0, vy: 0, angle: 0, rotationVelocity: 0,
            fuel: tuning.maxFuel, cargo: 0, landedOn: home.id, docked: null,
            deadUntil: 0, aimAngle: 0, gunHeat: 0, gunOverheatedUntil: 0
        },
        planets: Object.fromEntries(bodies.map(body => [body.id, {
            owner: body.id === home.id ? 'pilot' : null, home: body.id === home.id, level: 0, stock: 0,
            nextCargoAt: tuning.cargoSpawnInterval
        }])),
        projectiles: [], pickups: [], events: [], hack: null,
        target: { bodyId: bodies[1].id, type: 'relay' },
        stats: { captures: 0, deaths: 0, cargoCollected: 0, shots: 0 },
        refueling: null, eventCounter: 0
    };
    world.target = { bodyId: nearestCapturablePlanet(world).id, type: 'planet' };
    emit(world, 'started', { bodyId: home.id });
    return world;
}

// Choose the closest unowned or hostile planet for first-capture guidance at any spawn.
export function nearestCapturablePlanet(world, player = world.player) {
    return planetBodies.filter(body => world.planets[body.id]?.owner !== player.id)
        .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - a.radius
            - (Math.hypot(b.x - player.x, b.y - player.y) - b.radius))[0] || null;
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
    for (const body of [...bodies, ...systems, blackHole]) {
        const dx = body.x - x;
        const dy = body.y - y;
        const distance = Math.max(0.001, Math.hypot(dx, dy));
        const surface = body.radius + tuning.shipRadius;
        const radialDistance = Math.max(surface, distance);
        const influence = body.id === blackHole.id ? tuning.blackHoleInfluenceAltitude : tuning.influenceAltitude;
        const fade = Math.max(0, Math.min(1, (influence - radialDistance + surface) / 300));
        const acceleration = body.gravity * (surface / radialDistance) ** 2 * fade;
        ax += dx / distance * acceleration;
        ay += dy / distance * acceleration;
    }
    return { ax, ay, magnitude: Math.hypot(ax, ay) };
}

// Return the nearest relay's planet, rather than the planet with the nearest surface.
export function nearestRelay(player, world = null) {
    const relays = bodies.filter(body => !body.station || body.id === player.homeId);
    return relays.reduce((nearest, body) => {
        const point = dockingPoint(body);
        const other = dockingPoint(nearest);
        return Math.hypot(player.x - body.x, player.y - body.y) - body.radius
            < Math.hypot(player.x - nearest.x, player.y - nearest.y) - nearest.radius ? body : nearest;
    }, relays[0]);
}

// Resolve the selected navigation marker into the same exact geometry used by interactions.
export function targetFor(world) {
    const body = bodyFor(world.target.bodyId) || bodies[0];
    const type = body.station ? 'relay' : 'planet';
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

    const point = dockingPoint(body);
    const distance = body.station ? Math.max(0, Math.hypot(player.x - body.x, player.y - body.y) - body.radius)
        : Math.max(0, Math.hypot(player.x - body.x, player.y - body.y) - body.radius - tuning.shipRadius);
    const speed = Math.hypot(player.vx, player.vy);
    const angle = Math.abs(normalizeAngle(player.angle - point.angle));
    const protectedHome = body.station && world.planets[body.id].owner !== player.id;
    const otherPilots = world.players ? Object.values(world.players).map(actor => actor.player) : world.others || [];
    const defensesActive = !body.station && world.planets[body.id].owner !== player.id
        && world.planets[body.id].level > 0 && (!world.planets[body.id].turrets?.length
            || world.planets[body.id].turrets.some(turret => turret.health > 0));
    const occupied = otherPilots.some(other => other.id !== player.id && other.docked === body.id);
    const recaptureLocked = !body.station && world.planets[body.id].owner !== player.id
        && world.elapsed < (world.planets[body.id].recaptureAt || 0);
    const ready = !player.deadUntil && !player.docked && !protectedHome && !occupied && !defensesActive && !recaptureLocked
        && distance <= (body.station ? tuning.homeShieldAltitude : planetInteractionDistance(body, world.planets[body.id]))
;
    return { bodyId: body.id, distance, speed, angle, ready,
        reason: ready ? '' : player.deadUntil ? 'RESPAWNING'
            : recaptureLocked ? 'CAPTURE COOLDOWN' : defensesActive ? 'DESTROY TURRETS FIRST' : occupied ? 'OCCUPIED' : protectedHome ? 'PROTECTED'
                : distance > (body.station ? tuning.homeShieldAltitude : planetInteractionDistance(body, world.planets[body.id])) ? 'NOT IN RANGE'
                    : 'UNAVAILABLE' };
}

// Treat optional home markers as hostile fixture data while always protecting the local home.
function isHome(world, body) {
    return Boolean(body && ((world.players ? false : body.id === world.player.homeId) || world.planets[body.id]?.home));
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
export function interact(world, bodyId = null) {
    const player = world.player;
    if (player.deadUntil) return { ok: false, reason: 'RESPAWNING' };
    if (player.shoppingOn) {
        player.shoppingOn = null;
        return { ok: true, reason: 'Shop closed.' };
    }
    if (world.hack) {
        emit(world, 'hackCancelled', { bodyId: world.hack.bodyId });
        world.hack = null;
        return { ok: true, reason: 'Hack cancelled.' };
    }
    if (player.docked) {
        detach(world);
        return { ok: true, reason: 'Detached.' };
    }
    const status = dockingStatus(world, bodyId || nearestRelay(player, world).id);
    if (!status.ready) return { ok: false, reason: status.reason };
    const body = bodyFor(status.bodyId);
    const planet = world.planets[body.id];
    if (!body.station && planet.owner !== player.id) {
        if (prepareTurrets(planet).some(turret => turret.health > 0)) {
            return { ok: false, reason: 'DESTROY TURRETS FIRST' };
        }
        world.hack = { bodyId: body.id, progress: 0, required: tuning.hackBasePresses + planet.level * tuning.hackExtraPresses, digit: 0,
            heldDigit: null, lastAcceptedAt: world.elapsed - tuning.hackPressInterval, challengeId: world.eventCounter + 1 };
        emit(world, 'hackStarted', { bodyId: body.id });
        return { ok: true, reason: 'Enter the displayed numbers.' };
    }
    if (!body.station) {
        player.shoppingOn = body.id;
        return { ok: true, reason: 'Planet upgrades open.' };
    }
    const point = dockingPoint(body);
    Object.assign(player, { x: point.x, y: point.y, vx: 0, vy: 0, angle: 0,
        rotationVelocity: 0, landedOn: null, docked: body.id });
    emit(world, 'docked', { bodyId: body.id });
    return { ok: true, reason: 'Attached.' };
}

// Accept deliberate number presses without requiring the rocket to face the planet.
export function capturePress(world, { repeat = false, challengeId } = {}) {
    const hack = world.hack;
    if (!hack || world.player.deadUntil) return { ok: false, reason: 'No active hack.' };
    if (repeat || (challengeId !== undefined && challengeId !== hack.challengeId)) return { ok: false, reason: 'Stale press.' };
    if (world.elapsed - hack.lastAcceptedAt + 1e-9 < tuning.hackPressInterval) return { ok: false, reason: 'Press too soon.' };
    if (!dockingStatus(world, hack.bodyId).ready) return { ok: false, reason: 'Connection lost.' };
    hack.progress += 1;
    hack.lastAcceptedAt = world.elapsed;
    if (hack.progress >= hack.required) {
        Object.assign(world.planets[hack.bodyId], { owner: world.player.id, level: 0,
            recaptureAt: world.elapsed + tuning.recaptureCooldown,
            nextCargoAt: world.elapsed + tuning.cargoSpawnInterval });
        delete world.planets[hack.bodyId].turrets;
        world.stats.captures += 1;
        emit(world, 'captured', { bodyId: hack.bodyId });
        const winnerId = world.player.id;
        world.hack = null;
        for (const [id, actor] of Object.entries(world.players || {})) {
            if (id === winnerId || actor.hack?.bodyId !== hack.bodyId) continue;
            withPlayer(world, id, () => {
                world.hack = null;
                emit(world, 'hackCancelled', { bodyId: hack.bodyId, reason: 'Another pilot captured this planet.' });
            });
        }
        return { ok: true, reason: 'Captured.' };
    }
    emit(world, 'hackProgress', { bodyId: hack.bodyId, amount: hack.progress });
    return { ok: true };
}

// Retain the old exported API without allowing removed number-code input to advance capture.
export function hackDigit(world, digit) {
    return digit === null ? { ok: true } : { ok: false, reason: 'Press E to capture.' };
}

// Keep an initiated capture active independently of aim, until the rocket leaves interaction range.
function updatePlanetCapture(world, input, dt = 0) {
    const shoppingOn = world.player.shoppingOn;
    if (shoppingOn && (world.planets[shoppingOn]?.owner !== world.player.id
        || dockingStatus(world, shoppingOn).distance > planetInteractionDistance(bodyFor(shoppingOn), world.planets[shoppingOn]))) world.player.shoppingOn = null;
    if (!world.hack) return;
    const hack = world.hack;
    if (!dockingStatus(world, hack.bodyId).ready) {
        world.hack = null;
        emit(world, 'hackCancelled', { bodyId: hack.bodyId });
    } else {
        hack.progress = Math.max(0, hack.progress - tuning.captureDecayRate * dt);
    }
}

// Pay the station owner one cargo per elapsed minute, independent of their location.
function produceStationCargo(world, dt) {
    for (const station of starterStations) {
        const state = world.planets[station.id];
        if (!state?.owner) continue;
        const player = world.players ? world.players[state.owner]?.player : world.player;
        if (!player || player.id !== state.owner) continue;
        state.stock += dt / 60;
        const amount = Math.floor(state.stock + 1e-9);
        if (amount > 0) { player.cargo += amount; state.stock = Math.max(0, state.stock - amount); }
    }
}

// Give every defense level the same predictable benefit.
const upgrades = Object.freeze(Array.from({ length: tuning.maxPlanetLevel }, (_, index) => ({
    name: `Shield + turret / level ${index + 1}`,
    description: 'Adds one turret and enlarges the soft shield, increasing enemy bullet resistance.'
})));

// Match planet services and capture access to the visible growing shield boundary.
export function planetInteractionDistance(body, planet) {
    return planetShield(body, planet).altitude - tuning.shipRadius;
}

// Preserve earned levels where possible while moving old combined upgrades into separate tracks.
export function migrateUpgradeTracks(world) {
    if (world.upgradeTracksVersion === 2) return world;
    const actors = world.players ? Object.values(world.players) : [{ player: world.player, hack: world.hack }];
    for (const actor of actors) {
        const player = actor.player;
        player.weaponTier = [0, 1, 3, 4, 5][player.rocketTier || 0] || 0;
        player.rocketTier = Math.min(tuning.maxRocketLevel, player.rocketTier || 0);
        actor.hack = null;
    }
    world.hack = null;
    for (const planet of Object.values(world.planets)) {
        planet.level = Math.min(tuning.maxPlanetLevel, planet.level);
        if (Array.isArray(planet.turrets)) {
            planet.turrets.length = Math.min(planet.turrets.length, planet.level);
            planet.turrets.forEach((turret, index) => { turret.double = index >= 5; });
        }
    }
    world.upgradeTracksVersion = 2;
    return world;
}

// Fade only the extra booster acceleration with speed, leaving normal engine strength intact.
export function boosterStats(player) {
    const level = Math.max(0, Math.min(tuning.maxRocketLevel, player.rocketTier || 0));
    const speed = Math.hypot(player.vx || 0, player.vy || 0);
    return { bonus: level * .15 / (1 + (speed / 180) ** 2), fuelFactor: 1 - level * .035 };
}

// Define progressive firing, heat endurance and the three visible weapon milestones independently.
export function weaponStats(player) {
    const level = Math.max(0, Math.min(tuning.maxRocketLevel, player.weaponTier || 0));
    return { level, cooldown: tuning.fireCooldown * .94 ** level,
        heat: tuning.gunHeatPerShot * .94 ** level, lifetime: tuning.bulletLifetime * (1 + level * .04),
        double: level >= 3, alternating: level >= 5, laser: level >= 10 };
}

// Share one bounded field definition across physics, cargo containment, and rendering.
export function planetShield(body, planet) {
    const level = Math.max(0, Math.min(tuning.maxPlanetLevel, planet?.level || 0));
    const altitude = tuning.smallShieldAltitude + level * 30;
    return { altitude, radius: body.radius + altitude, retention: .94 - level * .016,
        repulsion: .08 + level * .012, rocketForce: tuning.rocketRepulsion + level * 2 };
}

// Describe only the docked planet's next purchase, distinguishing eligibility from affordability.
export function nextUpgrade(world) {
    const bodyId = world.player.shoppingOn || world.player.docked;
    const planet = world.planets[bodyId];
    const level = planet?.level ?? 0;
    const upgrade = upgrades[level];
    const cost = tuning.upgradeCosts[level] ?? 0;
    let reason = '';
    if (world.player.deadUntil) reason = 'Respawning.';
    else if (!planet) reason = 'Open an owned planet shop.';
    else if (dockingStatus(world, bodyId).distance > planetInteractionDistance(bodyFor(bodyId), planet)) reason = 'Planet is out of range.';
    else if (bodyFor(bodyId)?.station) reason = 'Rocket upgrades available at this station.';
    else if (planet.owner !== world.player.id) reason = 'Capture this planet first.';
    else if (planet.turrets?.some(turret => turret.health === 0)) reason = 'Repair turrets first.';
    else if (!upgrade) reason = 'All upgrades complete.';
    const available = !reason;
    const affordable = available && world.player.cargo >= cost;
    return { cost, name: upgrade?.name ?? 'Complete', description: upgrade?.description ?? 'No further upgrades.',
        available, affordable, reason: reason || (affordable ? '' : 'Not enough cargo.') };
}

// Spend cargo atomically on the one next defense tier, capped at ten levels.
export function upgradePlanet(world) {
    const upgrade = nextUpgrade(world);
    if (!upgrade.available || !upgrade.affordable) return { ok: false, reason: upgrade.reason };
    const bodyId = world.player.shoppingOn || world.player.docked;
    world.player.cargo -= upgrade.cost;
    world.planets[bodyId].level += 1;
    prepareTurrets(world.planets[bodyId]);
    emit(world, 'upgraded', { bodyId, amount: world.planets[bodyId].level });
    return { ok: true, reason: upgrade.name };
}

// Repair one destroyed gun only after its cooldown, paying the current planet-level cost.
export function repairTurret(world, index) {
    const bodyId = world.player.shoppingOn;
    const body = bodyFor(bodyId);
    const planet = world.planets[bodyId];
    if (world.player.deadUntil || !body || body.station || planet?.owner !== world.player.id
        || dockingStatus(world, bodyId).distance > planetInteractionDistance(bodyFor(bodyId), planet)) return { ok: false, reason: 'Open your planet shop in range.' };
    if (!Number.isInteger(index) || index < 0 || index >= planet.level) return { ok: false, reason: 'Invalid turret.' };
    const turret = prepareTurrets(planet)[index];
    if (turret.health > 0) return { ok: false, reason: 'Turret is operational.' };
    if (world.elapsed < (turret.repairAt || 0)) return { ok: false, reason: 'Repair cooling down.' };
    const cost = planet.level * 2;
    if (world.player.cargo < cost) return { ok: false, reason: 'Not enough cargo.' };
    world.player.cargo -= cost;
    Object.assign(turret, { health: tuning.turretHealth, repairAt: 0, nextShotAt: world.elapsed });
    emit(world, 'turretRepaired', { bodyId, turretIndex: index, amount: cost });
    return { ok: true, reason: 'Turret repaired.' };
}

// Describe an all-gun repair without charging or modifying the existing shop state.
export function turretRepairStatus(world) {
    const bodyId = world.player.shoppingOn;
    const body = bodyFor(bodyId), planet = world.planets[bodyId];
    const broken = (planet?.turrets || []).map((turret, index) => ({ turret, index })).filter(({ turret }) => turret.health === 0);
    const readyAt = Math.max(0, ...broken.map(({ turret }) => turret.repairAt || 0));
    const cost = broken.length * (planet?.level || 0) * 2;
    const available = Boolean(broken.length && !world.player.deadUntil && body && !body.station
        && planet.owner === world.player.id && dockingStatus(world, bodyId).distance <= planetInteractionDistance(body, planet)
        && world.elapsed >= readyAt);
    return { brokenCount: broken.length, readyAt, cost, available, affordable: available && world.player.cargo >= cost,
        indices: broken.map(({ index }) => index) };
}

// Repair all destroyed guns atomically through the replacement planet-upgrade button.
export function repairTurrets(world) {
    const repair = turretRepairStatus(world);
    if (!repair.available || !repair.affordable) return { ok: false,
        reason: world.elapsed < repair.readyAt ? 'Repair cooling down.' : repair.available ? 'Not enough cargo.' : 'Repair unavailable.' };
    for (const index of repair.indices) repairTurret(world, index);
    return { ok: true, reason: 'Turrets repaired.' };
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
    const previousWeaponTier = player.weaponTier || 0;
    player.weaponTier = Math.max(0, previousWeaponTier - 1);
    player.lastLostWeaponTier = previousWeaponTier;
    player.cargo = 0;
    player.shoppingOn = null;
    player.deadUntil = world.elapsed + tuning.respawnDelay;
    player.landedOn = null;
    player.vx = 0;
    player.vy = 0;
    player.rotationVelocity = 0;
    world.stats.deaths += 1;
    emit(world, 'died', { reason, previousTier, rocketTier: player.rocketTier, previousWeaponTier, weaponTier: player.weaponTier,
        ...(cause.attackerId ? { attackerId: cause.attackerId, source: cause.source } : {}) });
    return true;
}

// Recreate a safe stationary home launch state after the death timer expires.
function respawn(world) {
    const home = bodyFor(world.player.homeId);
    Object.assign(world.player, {
        ...dockingPoint(home), vx: 0, vy: 0,
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
    for (const star of [...systems, blackHole]) {
        const fraction = circleHit(start, end, star, star.radius + tuning.shipRadius);
        if (fraction !== null) consider({ fraction, type: 'star', body: star });
    }
    for (const body of bodies) {
        const planet = world.planets[body.id];
        if (body.station && !planet.owner) continue;
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
        if (!body.station) continue;
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

// Recognize physical contact with the top pad, not arbitrary points on a planet's surface.
function onLandingPad(player, body) {
    return !body.station && Math.abs(player.x - body.x) <= tuning.padHalfWidth && player.y < body.y
        && Math.abs(Math.hypot(player.x - body.x, player.y - body.y) - body.radius - tuning.shipRadius) < .1
        && Math.abs(normalizeAngle(player.angle)) <= tuning.safeLandingAngle;
}

// Station bays stay anchored; planet landings preserve their actual contact point and reject old side-contact flags.
function maintainLandingContact(player) {
    if (!player.landedOn) return;
    const body = bodyFor(player.landedOn);
    if (body?.station) {
        const point = dockingPoint(body);
        player.x = point.x; player.y = point.y;
    } else if (!body || !onLandingPad(player, body) || Math.hypot(player.vx, player.vy) > .05) {
        player.landedOn = null;
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
        killPlayer(world, hit.body.id === blackHole.id ? 'Absorbed by the black hole.' : `Star contact: ${hit.body.name}.`);
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
    if (hit.type === 'surface' && speed <= tuning.safeLandingSpeed && onLandingPad(player, hit.body)) {
        player.vx = 0;
        player.vy = 0;
        player.landedOn = hit.body.id;
        emit(world, 'landed', { bodyId: hit.body.id });
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
        const field = planetShield(body, planet);
        const small = home ? body.radius + tuning.homeShieldAltitude : field.radius;
        const force = distance < small ? (home ? tuning.rocketRepulsion : field.rocketForce) * (1 - distance / small) : 0;
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
    const station = bodyFor(player.docked || player.landedOn);
    const body = station?.station ? station : bodies.find(candidate => {
        if (candidate.station || world.planets[candidate.id]?.owner !== player.id) return false;
        const zone = fuelZone(candidate);
        return player.x >= zone.left && player.x <= zone.right && player.y >= zone.top && player.y <= zone.bottom;
    });
    const planet = body && world.planets[body.id];
    if (!body || planet.owner !== player.id || player.deadUntil) {
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
    const weapon = weaponStats(player);
    const barrels = weapon.laser ? [0] : weapon.alternating ? [player.nextBarrel ? 5 : -5] : weapon.double ? [-5, 5] : [0];
    if (world.projectiles.length + barrels.length > tuning.maxProjectiles) return;
    const dx = Math.cos(player.aimAngle);
    const dy = Math.sin(player.aimAngle);
    const speed = weapon.laser ? tuning.laserRange : tuning.bulletSpeed;
    for (const offset of barrels) world.projectiles.push({ id: `shot-${player.id}-${world.eventCounter + 1}-${offset}`, owner: player.id, source: 'player',
        x: player.x + dx * (tuning.shipRadius + 5) - dy * offset,
        y: player.y + dy * (tuning.shipRadius + 5) + dx * offset,
        vx: (weapon.laser ? 0 : player.vx) + dx * speed, vy: (weapon.laser ? 0 : player.vy) + dy * speed,
        laser: weapon.laser, color: player.color,
        radius: tuning.bulletRadius, expiresAt: world.elapsed + weapon.lifetime });
    player.nextBarrel = !player.nextBarrel;
    if (!player.landedOn) {
        player.vx -= dx * tuning.shotRecoil;
        player.vy -= dy * tuning.shotRecoil;
    }
    player.nextShotAt = world.elapsed + weapon.cooldown;
    player.gunHeat = Math.min(1, (player.gunHeat || 0) + weapon.heat);
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

// Redistribute each level's defenses into equally spaced positions around the planet.
export function turretPositions(body, level) {
    const count = Math.max(0, Math.min(tuning.maxPlanetLevel, Math.floor(level || 0)));
    return Array.from({ length: count }, (_, index) => {
        const angle = -Math.PI / 4 + index * Math.PI * 2 / count;
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
    const count = Math.max(0, Math.min(tuning.maxPlanetLevel, planet.level));
    planet.turrets.length = Math.min(planet.turrets.length, count);
    while (planet.turrets.length < count) {
        const index = planet.turrets.length;
        planet.turrets.push({ health: tuning.turretHealth, angle: -Math.PI / 2 + index * Math.PI * 2 / 3,
            disabledUntil: 0, nextShotAt: 0, double: index >= 5 });
    }
    // Old five-health saves remain readable; recovery timers no longer reactivate destroyed guns.
    for (const turret of planet.turrets) {
        turret.health = turret.health > 0 ? tuning.turretHealth : 0;
        turret.disabledUntil = 0;
    }
    for (const key of ['turretHealth', 'turretDisabledUntil', 'turretAngle', 'nextShotAt']) delete planet[key];
    return planet.turrets;
}

// Solve a constant-velocity intercept; use direct aim when no reachable positive intercept exists.
function turretAim(x, y, target, speed = tuning.turretBulletSpeed, lifetime = tuning.bulletLifetime) {
    const dx = target.x - x, dy = target.y - y;
    const vx = target.vx || 0, vy = target.vy || 0;
    const a = vx * vx + vy * vy - speed ** 2;
    const b = 2 * (dx * vx + dy * vy);
    const c = dx * dx + dy * dy;
    let time = 0;
    if (Math.abs(a) < 1e-8) {
        if (Math.abs(b) > 1e-8) time = -c / b;
    } else {
        const discriminant = b * b - 4 * a * c;
        if (discriminant >= 0) {
            const root = Math.sqrt(discriminant);
            const times = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(value => value > 0);
            if (times.length) time = Math.min(...times);
        }
    }
    if (!Number.isFinite(time) || time < 0 || time > lifetime) time = 0;
    return Math.atan2(dy + vy * time, dx + vx * time);
}

// Aim and fire every independent turret at its nearest visible enemy once per galaxy step.
function fireTurrets(world) {
    const players = world.players ? Object.values(world.players).map(actor => actor.player) : [world.player];
    // Share intrusion priorities across owned worlds while retaining each gun's range and occlusion.
    const intruders = new Map();
    for (const body of planetBodies) {
        const planet = world.planets[body.id];
        if (!planet.owner) continue;
        for (const player of players) {
            if (!player.deadUntil && player.id !== planet.owner
                && Math.hypot(player.x - body.x, player.y - body.y) <= planetShield(body, planet).radius) {
                if (!intruders.has(planet.owner)) intruders.set(planet.owner, new Set());
                intruders.get(planet.owner).add(player.id);
            }
        }
    }
    for (const body of bodies) {
        const planet = world.planets[body.id];
        if (!planet.owner || planet.level < 1) continue;
        const states = prepareTurrets(planet);
        const refuge = dockingPoint(body);
        for (const { x, y, index } of turretPositions(body, planet.level)) {
            const turret = states[index];
            if (turret.health <= 0) continue;
            let target = null;
            let distance = tuning.turretRange;
            let defending = false;
            for (const player of players) {
                if (player.deadUntil || player.id === planet.owner) continue;
                const candidateDistance = Math.hypot(player.x - x, player.y - y);
                const candidateDefending = intruders.get(planet.owner)?.has(player.id) || false;
                if (candidateDistance < 1 || candidateDistance > tuning.turretRange
                    || defending && !candidateDefending || candidateDefending === defending && candidateDistance > distance
                    || circleHit({ x, y }, player, body, body.radius) !== null) continue;
                target = player; distance = candidateDistance; defending = candidateDefending;
            }
            if (!target) continue;
            turret.angle = turretAim(x, y, target);
            if (world.elapsed + 1e-9 < turret.nextShotAt || world.projectiles.length >= tuning.maxProjectiles) continue;
            const offsets = turret.double ? [-6, 6] : [0];
            if (world.projectiles.length + offsets.length > tuning.maxProjectiles) continue;
            for (const offset of offsets) world.projectiles.push({ id: `turret-${world.eventCounter + 1}-${offset}`, owner: planet.owner,
                source: 'turret', bodyId: body.id, turretIndex: index, targetId: target.id,
                x: x - Math.sin(turret.angle) * offset, y: y + Math.cos(turret.angle) * offset,
                vx: Math.cos(turret.angle) * tuning.turretBulletSpeed,
                vy: Math.sin(turret.angle) * tuning.turretBulletSpeed,
                radius: tuning.bulletRadius, expiresAt: world.elapsed + tuning.bulletLifetime });
            turret.nextShotAt = world.elapsed + tuning.turretCooldown;
            emit(world, 'turretFired', { bodyId: body.id, turretIndex: index });
        }
    }
}

// One hostile hit permanently destroys only this gun; emit a durable outcome before broadcasting it.
function hitTurret(world, body, index, attackerId) {
    const turret = prepareTurrets(world.planets[body.id])[index];
    if (!turret || turret.health <= 0) return;
    turret.health = 0;
    turret.nextShotAt = 0;
    turret.repairAt = world.elapsed + tuning.turretRepairCooldown;
    const destroyed = () => emit(world, 'turretDestroyed', { bodyId: body.id, turretIndex: index,
        allTurretsDown: world.planets[body.id].turrets.every(state => state.health === 0) });
    if (world.players?.[attackerId]) withPlayer(world, attackerId, destroyed);
    else destroyed();
}

// Gently correct a turret shot toward its original live enemy without changing its speed or retargeting.
function steerTurretShot(world, shot, dt) {
    if (shot.source !== 'turret' || typeof shot.targetId !== 'string') return;
    const target = world.players ? world.players[shot.targetId]?.player
        : world.player.id === shot.targetId ? world.player : null;
    if (!target || target.deadUntil || target.id === shot.owner) return;
    const speed = Math.hypot(shot.vx, shot.vy);
    if (speed < 1e-8) return;
    const angle = Math.atan2(shot.vy, shot.vx);
    const desired = turretAim(shot.x, shot.y, target, speed, shot.expiresAt - world.elapsed);
    const change = normalizeAngle(desired - angle);
    const limit = tuning.turretHomingRate * dt;
    const next = angle + Math.max(-limit, Math.min(limit, change));
    shot.vx = Math.cos(next) * speed;
    shot.vy = Math.sin(next) * speed;
}

// Step one projectile through shields and refuge before its swept moving-player hit can apply.
function moveProjectile(world, shot, dt, previousPlayer, startFraction = 0) {
    if (![shot.x, shot.y, shot.vx, shot.vy].every(Number.isFinite)) return false;
    if (shot.laser && shot.resolved) return shot.expiresAt > world.elapsed;
    if (shot.laser && startFraction === 0) {
        shot.originX = shot.x; shot.originY = shot.y;
        shot.resolved = true; shot.expiresAt = world.elapsed + tuning.laserFlashDuration; dt = 1;
    }
    shot.expiresAt ??= world.elapsed + tuning.bulletLifetime;
    if (shot.expiresAt <= world.elapsed) return false;
    if (startFraction === 0) steerTurretShot(world, shot, dt);
    const radius = Number.isFinite(shot.radius) ? Math.max(0, shot.radius) : tuning.bulletRadius;
    const start = { x: shot.x, y: shot.y };
    let end = { x: shot.x + shot.vx * dt, y: shot.y + shot.vy * dt };
    const interactions = [];
    for (const body of bodies) {
        const planet = world.planets[body.id];
        if (planet.owner && planet.owner !== shot.owner) {
            const home = isHome(world, body);
            const small = home ? body.radius + tuning.homeShieldAltitude : planetShield(body, planet).radius;
            const fraction = home ? circleHit(start, end, body, small + radius)
                : circleCrossing(start, end, body, small + radius);
            if (fraction !== null && (home || !shot.slowedBy?.includes(`slow:${body.id}`))) {
                interactions.push({ fraction, type: home ? 'shield' : shot.laser ? 'laserField' : 'slow', body });
            }
        }
        if (planet.owner && planet.owner !== shot.owner && planet.level >= 1 && shot.source === 'player') {
            for (const turret of turretPositions(body, planet.level)) {
                if (planet.turrets?.[turret.index]?.health === 0) continue;
                const fraction = circleHit(start, end, turret, tuning.turretRadius + radius);
                if (fraction !== null) interactions.push({ fraction, type: 'turret', body, turretIndex: turret.index });
            }
        }
        const surface = circleHit(start, end, body, body.radius + radius);
        if (surface !== null) interactions.push({ fraction: surface, type: 'surface', body });
        if (shot.source === 'turret' && body.station) {
            const fraction = circleHit(start, end, dockingPoint(body), tuning.refugeRadius + radius);
            if (fraction !== null) interactions.push({ fraction, type: 'refuge', body });
        }
    }
    for (const star of [...systems, blackHole]) {
        const fraction = circleHit(start, end, star, star.radius + radius);
        if (fraction !== null) interactions.push({ fraction, type: 'surface', body: star });
    }
    const targets = world.players ? Object.values(world.players).map(actor => actor.player) : [world.player];
    for (const player of targets) if (!player.deadUntil && shot.owner !== player.id) {
        const previous = shot.laser ? player : world.previousPlayers?.[player.id] || previousPlayer;
        const relativeStart = { x: start.x - (previous.x + (player.x - previous.x) * startFraction),
            y: start.y - (previous.y + (player.y - previous.y) * startFraction) };
        const relativeEnd = { x: end.x - player.x, y: end.y - player.y };
        const fraction = circleHit(relativeStart, relativeEnd, { x: 0, y: 0 }, tuning.shipRadius + radius);
        if (fraction !== null) interactions.push({ fraction, type: 'player', playerId: player.id });
    }
    interactions.sort((a, b) => a.fraction - b.fraction);
    for (const interaction of interactions) {
        if (interaction.type === 'laserField') continue;
        if (interaction.type === 'slow') {
            const body = interaction.body;
            const field = planetShield(body, world.planets[body.id]);
            const fraction = interaction.fraction;
            const x = start.x + (end.x - start.x) * fraction;
            const y = start.y + (end.y - start.y) * fraction;
            const distance = Math.max(1, Math.hypot(x - body.x, y - body.y));
            const nx = (x - body.x) / distance, ny = (y - body.y) / distance;
            const inward = -(shot.vx * nx + shot.vy * ny);
            shot.slowedBy ??= [];
            shot.slowedBy.push(`slow:${body.id}`);
            // Bound outward deflection so even the strongest field always admits a direct shot.
            if (inward > 0) {
                const kick = Math.min(Math.hypot(shot.vx, shot.vy) * field.repulsion, inward * .4) * field.retention;
                shot.vx = shot.vx * field.retention + nx * kick;
                shot.vy = shot.vy * field.retention + ny * kick;
            }
            shot.x = x; shot.y = y;
            return moveProjectile(world, shot, dt * (1 - fraction), previousPlayer,
                startFraction + (1 - startFraction) * fraction);
        }
        if (shot.laser) {
            shot.x = start.x + (end.x - start.x) * interaction.fraction;
            shot.y = start.y + (end.y - start.y) * interaction.fraction;
        }
        if (interaction.type === 'player') {
            const reason = shot.source === 'turret' ? 'Turret hit.' : 'Projectile hit.';
            const cause = { attackerId: shot.owner, source: shot.source };
            if (world.players) withPlayer(world, interaction.playerId, () => damagePlayer(world, tuning.shotFuelDamage, reason, cause));
            else damagePlayer(world, tuning.shotFuelDamage, reason, cause);
        }
        else if (interaction.type === 'turret') hitTurret(world, interaction.body, interaction.turretIndex, shot.owner);
        else if (interaction.type === 'shield') emit(world, 'shieldBlocked', { bodyId: interaction.body.id });
        else if (interaction.type === 'refuge') emit(world, 'refugeBlocked', { bodyId: interaction.body.id });
        return Boolean(shot.laser);
    }
    shot.x = end.x;
    shot.y = end.y;
    return true;
}

// Sweep cargo against planet surfaces so fast death drops cannot tunnel through a world.
function moveCargoWithBounce(pickup, dt) {
    let remaining = dt;
    for (let bounce = 0; bounce < 3 && remaining > 1e-8; bounce++) {
        const start = { x: pickup.x, y: pickup.y };
        const end = { x: start.x + (pickup.vx || 0) * remaining, y: start.y + (pickup.vy || 0) * remaining };
        let hit = null;
        for (const body of planetBodies) {
            const radius = body.radius + 5;
            const inside = Math.hypot(start.x - body.x, start.y - body.y) < radius;
            const fraction = inside ? 0 : circleHit(start, end, body, radius);
            if (fraction !== null && (!hit || fraction < hit.fraction)) hit = { body, radius, fraction };
        }
        if (!hit) { pickup.x = end.x; pickup.y = end.y; return; }
        const x = start.x + (end.x - start.x) * hit.fraction;
        const y = start.y + (end.y - start.y) * hit.fraction;
        const distance = Math.hypot(x - hit.body.x, y - hit.body.y);
        const nx = distance > 0 ? (x - hit.body.x) / distance : 1;
        const ny = distance > 0 ? (y - hit.body.y) / distance : 0;
        pickup.x = hit.body.x + nx * (hit.radius + 0.05);
        pickup.y = hit.body.y + ny * (hit.radius + 0.05);
        const incoming = (pickup.vx || 0) * nx + (pickup.vy || 0) * ny;
        if (incoming < 0) {
            pickup.vx -= 1.75 * incoming * nx;
            pickup.vy -= 1.75 * incoming * ny;
        }
        remaining *= 1 - hit.fraction;
    }
}

// Replenish a small shared orbiting cache, with five cargo per pod and a bounded spawn cadence.
function produceBlackHoleCargo(world) {
    world.nextBlackHoleCargoAt ??= 10;
    if (world.elapsed < world.nextBlackHoleCargoAt || world.pickups.length >= tuning.maxPickups) return;
    world.nextBlackHoleCargoAt = world.elapsed + tuning.blackHoleCargoInterval;
    if (world.pickups.filter(pickup => pickup.blackHoleOrbit).length >= tuning.blackHoleCargoCount) return;
    const angle = world.elapsed * 2.399963;
    const radius = blackHole.radius + 850 + (world.eventCounter % 3) * 130;
    const x = blackHole.x + Math.cos(angle) * radius, y = blackHole.y + Math.sin(angle) * radius;
    const gravity = gravityAt(x, y);
    const speed = Math.sqrt(Math.max(1, gravity.magnitude * radius));
    world.pickups.push({ id: `black-hole-cargo-${Math.round(world.elapsed * 1000)}`, blackHoleOrbit: true,
        orbitAngle: angle, orbitRadius: radius, orbitSpeed: speed / radius,
        x, y, vx: -Math.sin(angle) * speed, vy: Math.cos(angle) * speed,
        amount: tuning.blackHoleCargoValue, expiresAt: world.elapsed + 300 });
}

// Derive availability from current planet ownership, so capture transfers collection rights immediately.
export function canCollectCargo(world, pickup, player = world.player) {
    if (pickup.bodyId === undefined || pickup.bodyId === null) return true;
    const body = bodyFor(pickup.bodyId);
    return Boolean(body && (body.station || world.planets[body.id]?.owner === player.id));
}

// Keep an entire planet pod within its inner bubble and remove outward radial motion at the boundary.
function containPlanetCargo(pickup, body, planet) {
    const dx = pickup.x - body.x, dy = pickup.y - body.y;
    const distance = Math.hypot(dx, dy);
    const radius = planetShield(body, planet).radius - 5;
    if (distance <= radius || distance < 1e-8) return;
    const nx = dx / distance, ny = dy / distance;
    pickup.x = body.x + nx * radius; pickup.y = body.y + ny * radius;
    const outward = (pickup.vx || 0) * nx + (pickup.vy || 0) * ny;
    if (outward > 0) {
        pickup.vx = (pickup.vx || 0) - outward * nx;
        pickup.vy = (pickup.vy || 0) - outward * ny;
    }
}

// Pull planet cargo toward its owner, routing around the surface and strengthening closer to the planet.

function attractBubbleCargo(pickup, player, body, dt, planet) {
    const dx = player.x - pickup.x, dy = player.y - pickup.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-8) return;
    let directionX = dx / distance, directionY = dy / distance;
    if (circleHit(pickup, player, body, body.radius + 5) !== null) {
        const radialX = pickup.x - body.x, radialY = pickup.y - body.y;
        const radius = Math.hypot(radialX, radialY);
        if (radius < 1e-8) return;
        const targetX = player.x - body.x, targetY = player.y - body.y;
        const turn = radialX * targetY - radialY * targetX >= 0 ? 1 : -1;
        directionX = -radialY / radius * turn;
        directionY = radialX / radius * turn;
    }
    const altitude = Math.max(0, Math.hypot(player.x - body.x, player.y - body.y) - body.radius);
    const proximity = Math.max(0, 1 - altitude / planetShield(body, planet).altitude);
    const strength = .55 + .45 * proximity;
    const speed = Math.min(tuning.cargoBubbleSpeed * strength, distance * 1.5);
    const changeX = directionX * speed - (pickup.vx || 0);
    const changeY = directionY * speed - (pickup.vy || 0);
    const change = Math.hypot(changeX, changeY);
    const blend = change > 0 ? Math.min(1, tuning.cargoBubbleAcceleration * strength * dt / change) : 0;
    pickup.vx = (pickup.vx || 0) + changeX * blend;
    pickup.vy = (pickup.vy || 0) + changeY * blend;
}

// Orbit planet cargo, drift death drops, expire, and collect with swept player-relative contact.
function movePickups(world, dt, previousPlayer) {
    world.pickups = world.pickups.filter(pickup => {
        if (pickup.expiresAt <= world.elapsed || !Number.isFinite(pickup.amount) || pickup.amount <= 0) return false;
        const body = bodyFor(pickup.bodyId);
        const planetBody = body && !body.station ? body : null;
        if (planetBody) containPlanetCargo(pickup, planetBody, world.planets[planetBody.id]);
        const pickupStart = { x: pickup.x, y: pickup.y };
        const pilots = world.players ? Object.values(world.players).map(actor => actor.player) : [world.player];
        const alive = pilots.filter(player => !player.deadUntil && canCollectCargo(world, pickup, player));
        const bubble = planetBody && world.planets[body.id]?.owner ? body : null;
        const insideBubble = player => bubble && Math.hypot(player.x - bubble.x, player.y - bubble.y)
            <= planetShield(bubble, world.planets[bubble.id]).radius;
        const eligible = alive.filter(player => insideBubble(player)
            || Math.hypot(player.x - pickup.x, player.y - pickup.y) < tuning.cargoAttractionRadius);
        const nearest = eligible.reduce((best, player) => !best || Math.hypot(player.x - pickup.x, player.y - pickup.y)
            < Math.hypot(best.x - pickup.x, best.y - pickup.y) ? player : best, null);
        if (pickup.blackHoleOrbit) {
            const approaching = alive.some(player => Math.hypot(player.x - pickup.x, player.y - pickup.y) < tuning.cargoAttractionRadius);
            if (approaching) pickup.blackHoleOrbit = false;
            else {
                pickup.orbitAngle += pickup.orbitSpeed * dt;
                const x = blackHole.x + Math.cos(pickup.orbitAngle) * pickup.orbitRadius;
                const y = blackHole.y + Math.sin(pickup.orbitAngle) * pickup.orbitRadius;
                pickup.vx = (x - pickup.x) / dt; pickup.vy = (y - pickup.y) / dt;
            }
        }
        if (pickup.orbiting) {
            const gravity = gravityAt(pickup.x, pickup.y);
            pickup.vx = (pickup.vx || 0) + gravity.ax * dt;
            pickup.vy = (pickup.vy || 0) + gravity.ay * dt;
        }
        // Only the owner attracts planet pods; dropped cargo keeps its public nearby-pickup magnet.
        const dx = nearest ? nearest.x - pickup.x : 0;
        const dy = nearest ? nearest.y - pickup.y : 0;
        const distance = Math.hypot(dx, dy);
        if (nearest && insideBubble(nearest)) {
            attractBubbleCargo(pickup, nearest, bubble, dt, world.planets[bubble.id]);
        } else if (nearest && distance > 0 && distance < tuning.cargoAttractionRadius) {
            const acceleration = tuning.cargoAttractionAcceleration * (1 - distance / tuning.cargoAttractionRadius);
            pickup.vx = (pickup.vx || 0) + dx / distance * acceleration * dt;
            pickup.vy = (pickup.vy || 0) + dy / distance * acceleration * dt;
        }
        moveCargoWithBounce(pickup, dt);
        if (planetBody) containPlanetCargo(pickup, planetBody, world.planets[planetBody.id]);
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
    const agility = 1;
    const acceleration = tuning.aimRotationAcceleration * power * agility;
    const previousRate = Number.isFinite(player.rotationVelocity) ? player.rotationVelocity : 0;
    // Damping starts braking while the cursor is still ahead, avoiding a snap at alignment.
    const turnAcceleration = Math.max(-acceleration, Math.min(acceleration, error * tuning.aimRotationResponse - previousRate * tuning.aimRotationDamping));
    player.rotationVelocity = power > 0 ? Math.max(-tuning.maxAimRotationRate * agility,
        Math.min(tuning.maxAimRotationRate * agility, previousRate + turnAcceleration * dt)) : 0;
    player.angle = normalizeAngle(player.angle + player.rotationVelocity * dt);
}

// Cancel the full velocity vector, easing near rest without overshooting or depending on hull heading.
function brakeVelocity(player, dt, power) {
    const speed = Math.hypot(player.vx, player.vy);
    if (speed === 0 || power <= 0) return;
    const speedMultiplier = 1 + Math.min(2, speed / 300);
    const effectivePower = power * speedMultiplier;
    const maximumChange = tuning.brakeAcceleration * dt * effectivePower;
    const amount = speed <= maximumChange ? speed : Math.min(maximumChange,
        speed * (1 - Math.exp(-tuning.brakeResponse * dt * effectivePower)));
    const remaining = speed - amount;
    const scale = remaining < 0.05 ? 0 : remaining / speed;
    player.vx *= scale;
    player.vy *= scale;
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
    const fuelCost = dt * boosterStats(player).fuelFactor / tuning.fuelCapacityScale * ((burning ? tuning.mainFuelRate : 0)
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
    const bonus = boosterStats(player).bonus;
    const thrust = burning ? tuning.mainAcceleration * (1 + bonus) : 0;
    const axialThrust = Math.min(0, rcsY);
    const rcsAx = (rcsX * Math.cos(player.angle) * tuning.rcsAcceleration
        - axialThrust * Math.sin(player.angle) * tuning.rcsAcceleration) * power;
    const rcsAy = (rcsX * Math.sin(player.angle) * tuning.rcsAcceleration
        + axialThrust * Math.cos(player.angle) * tuning.rcsAcceleration) * power;
    player.vx += (gravity.ax + Math.sin(player.angle) * thrust * power + rcsAx) * dt;
    player.vy += (gravity.ay - Math.cos(player.angle) * thrust * power + rcsAy) * dt;
    if (rcsY > 0) brakeVelocity(player, dt, power * rcsY);
    repelRockets(world, dt);
    const start = { x: player.x, y: player.y };
    const end = { x: player.x + player.vx * dt, y: player.y + player.vy * dt };
    resolveMovement(world, start, end);
}

// Advance bounded fixed substeps so service, swept combat, and respawning continue without active controls.
export function stepWorld(world, input = {}, dt = tuning.fixedStep) {
    if (!Number.isFinite(dt) || dt <= 0) return world;
    input ??= {};
    maintainLandingContact(world.player);
    if (world.player.docked && !bodyFor(world.player.docked)?.station) {
        world.player.shoppingOn = world.player.docked;
        world.player.docked = null;
    }
    const dockedBody = bodyFor(world.player.docked);
    if (dockedBody) {
        const dock = dockingPoint(dockedBody);
        world.player.x = dock.x; world.player.y = dock.y;
    }
    // Reconcile older saves so home cargo and removed home relays cannot persist.

    world.pickups = world.pickups.filter(pickup => !pickup.orbiting || !pickup.bodyId || !isHome(world, bodyFor(pickup.bodyId)));

    const duration = Math.min(dt, tuning.maxStepDuration);
    const steps = Math.ceil(duration / tuning.fixedStep);
    const step = duration / steps;
    for (let index = 0; index < steps; index += 1) {
        world.elapsed += step;
        world.updatedAt = world.createdAt + world.elapsed * 1000;
        coolPlayerGun(world.player, step, world.elapsed);
        produceStationCargo(world, step);
        produceBlackHoleCargo(world);
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
            updatePlanetCapture(world, input, step);
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

// Offer either independent rocket track at an owned planet shop or the home station.
function nextTrackUpgrade(world, track) {
    const tier = world.player[track] || 0;
    const cost = tuning.rocketUpgradeCosts[tier] || 0;
    const bodyId = world.player.shoppingOn || world.player.docked;
    const body = bodyFor(bodyId), planet = world.planets[bodyId];
    const inRange = body && (body.station ? world.player.docked === bodyId
        : dockingStatus(world, bodyId).distance <= planetInteractionDistance(body, planet));
    const available = !world.player.deadUntil && !world.hack && planet?.owner === world.player.id && inRange && tier < tuning.maxRocketLevel;
    const name = track === 'rocketTier' ? `Booster ${tier + 1}: acceleration + efficiency`
        : tier + 1 === 10 ? 'Weapon 10: long-range laser' : tier + 1 === 5 ? 'Weapon 5: alternating twin fire'
            : tier + 1 === 3 ? 'Weapon 3: twin fire' : `Weapon ${tier + 1}: faster fire + endurance`;
    return { tier, cost, name: tier >= tuning.maxRocketLevel ? 'Fully upgraded' : name, available: Boolean(available),
        affordable: Boolean(available && world.player.cargo >= cost) };
}

// Preserve the existing purchase API while naming its independent track BOOSTER in the interface.
export function nextRocketUpgrade(world) { return nextTrackUpgrade(world, 'rocketTier'); }

// Describe the independent weapon purchase using server-owned eligibility and prices.
export function nextWeaponUpgrade(world) { return nextTrackUpgrade(world, 'weaponTier'); }

// Charge one authoritative purchase without changing the other rocket upgrade track.
function upgradeTrack(world, track) {
    const upgrade = nextTrackUpgrade(world, track);
    if (!upgrade.available || !upgrade.affordable) return { ok: false, reason: upgrade.available ? 'Not enough cargo.' : 'Upgrade unavailable.' };
    world.player.cargo -= upgrade.cost;
    world.player[track] = upgrade.tier + 1;
    emit(world, track === 'rocketTier' ? 'rocketUpgraded' : 'weaponUpgraded', { amount: world.player[track] });
    return { ok: true, reason: upgrade.name };
}

// Buy the next booster level while preserving the public rocket upgrade command.
export function upgradeRocket(world) { return upgradeTrack(world, 'rocketTier'); }

// Buy the next weapon level independently of the booster.
export function upgradeWeapon(world) { return upgradeTrack(world, 'weaponTier'); }

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
        produceStationCargo(world, step);
        produceBlackHoleCargo(world);
        for (const [bodyId, planet] of Object.entries(world.planets)) {
            if (planet.home || bodyFor(bodyId)?.station) continue;
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
            maintainLandingContact(player);
            if (player.docked && !bodyFor(player.docked)?.station) {
                player.shoppingOn = player.docked; player.docked = null;
            }
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
            updatePlanetCapture(world, input, step);
        });
        fireTurrets(world);
        world.projectiles = world.projectiles.filter(shot => moveProjectile(world, shot, step, { x: 0, y: 0 }));
        movePickups(world, step, { x: 0, y: 0 });
        delete world.previousPlayers;
    }
    return world;
}
