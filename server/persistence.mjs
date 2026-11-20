import { mkdir, readFile, writeFile, rename, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { bodies, territoryBodies, celestialBodies, roguePlanets, planetBodies, starterStations, extraStarterStations, dockingPoint, tuning, removeRetiredPlanets, migrateUpgradeTracks } from '../public/scripts/conquestPhysics.mjs';

// Move legacy planet homes to stations without erasing earned territory or pilot resources.
export function migrateStationHomes(data) {
    if (data?.schema !== 1 || !data.world?.planets || !data.world.players) return { data, migrated: false };
    if (starterStations.some(station => data.world.planets[station.id])) return { data, migrated: false };
    const legacy = data.world;
    const actors = Object.values(legacy.players);
    const homeIds = new Set();
    if (actors.length > starterStations.length || planetBodies.some(body => !roguePlanets.includes(body) && !legacy.planets[body.id])) {
        throw new Error('Invalid legacy galaxy; station migration stopped.');
    }
    for (const actor of actors) {
        const home = actor.player?.homeId;
        if (!planetBodies.some(body => body.id === home) || homeIds.has(home)
            || legacy.planets[home]?.owner !== actor.player.id || !legacy.planets[home]?.home) {
            throw new Error('Invalid legacy home; station migration stopped.');
        }
        homeIds.add(home);
    }
    const migrated = structuredClone(data);
    const world = migrated.world;
    for (const body of planetBodies) {
        if (world.planets[body.id]) world.planets[body.id].home = false;
    }
    for (const station of starterStations) world.planets[station.id] = {
        owner: null, home: false, level: 0, stock: 0, nextCargoAt: world.elapsed + tuning.cargoSpawnInterval
    };
    Object.values(world.players).forEach((actor, index) => {
        const station = starterStations[index];
        Object.assign(world.planets[station.id], { owner: actor.player.id, home: true });
        Object.assign(actor.player, dockingPoint(station), { homeId: station.id, landedOn: station.id,
            docked: null, vx: 0, vy: 0, angle: 0, rotationVelocity: 0 });
        actor.hack = null;
        actor.refueling = null;
    });
    validateSave(migrated);
    return { data: migrated, migrated: true };
}

// Validate snapshots before restoration rather than silently replacing corrupt persistent territory.
export function validateSave(data) {
    const world = data?.world;
    if (data?.schema !== 1 || (world?.upgradeTracksVersion !== undefined && world.upgradeTracksVersion !== 2) || !world?.players || !data.sessions || !Number.isFinite(world.elapsed)
        || world.elapsed < 0 || world.elapsed > 31536000 || !Number.isFinite(world.createdAt) || !Number.isFinite(world.updatedAt)
        || !Number.isInteger(world.eventCounter) || world.eventCounter < 0 || !world.planets
        || !Array.isArray(world.pickups) || !Array.isArray(world.projectiles)
        || world.pickups.length > 64 || world.projectiles.length > 256) throw new Error('Invalid galaxy snapshot. Restore a valid backup before starting.');
    if (world.galaxyExpanded !== undefined && typeof world.galaxyExpanded !== 'boolean') throw new Error('Invalid saved galaxy boundary.');
    const pilotLabels = starterStations.map((_, index) => `Pilot ${index + 1}`);
    const ids = Object.keys(world.players);
    if (ids.length > starterStations.length || Object.keys(data.sessions).length !== ids.length) throw new Error('Invalid pilot reservations.');
    for (const id of ids) {
        const actor = world.players[id], p = actor.player, session = data.sessions[id];
        if (!/^p-[a-f0-9-]{36}$/.test(id) || p?.id !== id || !session || !/^[a-f0-9]{64}$/.test(session.tokenHash)
            || !['x', 'y', 'vx', 'vy', 'angle', 'fuel', 'cargo', 'aimAngle', 'deadUntil'].every(key => Number.isFinite(p[key]) && Math.abs(p[key]) < 1e8)
            || !bodies.some(body => body.id === p.homeId) || !Number.isInteger(p.rocketTier) || p.rocketTier < 0 || p.rocketTier > (world.upgradeTracksVersion === 2 ? tuning.maxRocketLevel : 4)
            || (world.upgradeTracksVersion === 2 && (!Number.isInteger(p.weaponTier) || p.weaponTier < 0 || p.weaponTier > tuning.maxRocketLevel))
            || !actor.stats || !['captures', 'deaths', 'cargoCollected', 'shots'].every(key => Number.isFinite(actor.stats[key]) && actor.stats[key] >= 0)
            || !pilotLabels.includes(p.label) || !/^#[a-f0-9]{6}$/i.test(p.color)
            || p.fuel < 0 || p.fuel > 100 || p.cargo < 0
            || !['rotationVelocity', 'gunHeat', 'gunOverheatedUntil', 'joinedAt'].every(key => Number.isFinite(p[key]))
            || p.gunHeat < 0 || p.gunHeat > 1 || !actor.target || !territoryBodies.some(body => body.id === actor.target.bodyId)
            || !['planet', 'relay'].includes(actor.target.type)
            || !Number.isSafeInteger(session.lastActionId) || session.lastActionId < 0
            || typeof session.connected !== 'boolean'
            || (!session.connected && !Number.isFinite(session.expiresAt))) throw new Error('Invalid saved pilot.');
    }
    for (const body of territoryBodies) {
        const planet = world.planets[body.id];
        if (!planet && extraStarterStations.includes(body)) continue;
        if (!planet && roguePlanets.includes(body) && (world.roguePlanetsVersion ?? 0) < 6) continue;
        if (!planet && celestialBodies.some(candidate => candidate.id === body.id) && world.celestialTargetsVersion !== 1) continue;
        if (!planet || (planet.owner !== null && !ids.includes(planet.owner)) || !Number.isInteger(planet.level)
            || planet.level < 0 || planet.level > (world.upgradeTracksVersion === 2 ? tuning.maxPlanetLevel : 20) || !Number.isFinite(planet.stock) || planet.stock < 0
            || typeof planet.home !== 'boolean' || (planet.home && !planet.owner)) throw new Error('Invalid saved territory.');
        if (planet.recaptureAt !== undefined && (!Number.isFinite(planet.recaptureAt) || planet.recaptureAt < 0 || planet.recaptureAt > 1e8)) throw new Error('Invalid saved recapture timer.');
        if (planet.capturedAt !== undefined && (!Number.isFinite(planet.capturedAt) || planet.capturedAt < 0 || planet.capturedAt > world.elapsed)) throw new Error('Invalid saved capture timer.');
        if (planet.turrets !== undefined && (!Array.isArray(planet.turrets) || planet.turrets.length !== planet.level
            || !planet.turrets.every(turret => turret && ['health', 'angle', 'disabledUntil', 'nextShotAt'].every(key =>
                Number.isFinite(turret[key]) && Math.abs(turret[key]) < 1e8)
                && (turret.repairAt === undefined || Number.isFinite(turret.repairAt) && turret.repairAt >= 0 && turret.repairAt < 1e8)
                && (turret.double === undefined || typeof turret.double === 'boolean')
                && turret.health >= 0 && turret.health <= 5))) throw new Error('Invalid saved turret array.');
        if (planet.turretHealth !== undefined && (!Number.isFinite(planet.turretHealth) || planet.turretHealth < 0 || planet.turretHealth > 5)) throw new Error('Invalid saved turret health.');
        for (const key of ['turretAngle', 'turretDisabledUntil']) {
            if (planet[key] !== undefined && (!Number.isFinite(planet[key]) || Math.abs(planet[key]) > 1e8)) throw new Error('Invalid saved turret state.');
        }
    }
    const homes = new Set();
    for (const id of ids) {
        const actor = world.players[id];
        if (homes.has(actor.player.homeId) || world.planets[actor.player.homeId].owner !== id || !world.planets[actor.player.homeId].home) throw new Error('Invalid home reservation.');
        homes.add(actor.player.homeId);
        if (actor.hack && (!territoryBodies.some(body => body.id === actor.hack.bodyId) || !Number.isInteger(actor.hack.digit)
            || actor.hack.digit < 0 || actor.hack.digit > 9 || !Number.isFinite(actor.hack.progress)
            || !Number.isInteger(actor.hack.required) || actor.hack.required < 1 || actor.hack.required > 100
            || actor.hack.progress < 0 || actor.hack.progress >= actor.hack.required)) throw new Error('Invalid saved challenge.');
    }
    if (world.nextBlackHoleCargoAt !== undefined && (!Number.isFinite(world.nextBlackHoleCargoAt) || world.nextBlackHoleCargoAt < 0 || world.nextBlackHoleCargoAt > 1e8)) throw new Error('Invalid cargo spawn timer.');
    for (const entity of [...world.pickups, ...world.projectiles]) {
        if (!['x', 'y', 'vx', 'vy', 'expiresAt'].every(key => Number.isFinite(entity[key]) && Math.abs(entity[key]) < 1e8)) throw new Error('Invalid saved entity.');
        if (entity.blackHoleOrbit && !['orbitAngle', 'orbitRadius', 'orbitSpeed'].every(key => Number.isFinite(entity[key]) && Math.abs(entity[key]) < 1e8)) throw new Error('Invalid saved cargo orbit.');
        if (entity.laser && entity.resolved && !['originX', 'originY'].every(key => Number.isFinite(entity[key]) && Math.abs(entity[key]) < 1e8)) throw new Error('Invalid saved beam.');
    }
    return data;
}

// Serialize atomic, durable snapshots so overlapping checkpoints cannot overwrite newer state.
export class GalaxyStore {
    // Keep runtime state at an explicit path owned by this service.
    constructor(file) { this.file = file; this.pending = Promise.resolve(); }

    // Missing state means a new galaxy; malformed state is an actionable startup error.
    async load() {
        try {
            const original = await readFile(this.file, 'utf8');
            const snapshot = JSON.parse(original);
            removeRetiredPlanets(snapshot?.world);
            const result = migrateStationHomes(snapshot);
            const data = validateSave(result.data);
            if (data.world.upgradeTracksVersion !== 2 || data.world.celestialTargetsVersion !== 1 || data.world.roguePlanetsVersion !== 6
                || extraStarterStations.some(station => !data.world.planets[station.id])) {
                await writeFile(`${this.file}.pre-upgrades-${Date.now()}.bak`, original, { mode: 0o600, flag: 'wx' });
            }
            migrateUpgradeTracks(data.world);
            validateSave(data);
            if (result.migrated) {
                // Preserve the exact original privately before the service can checkpoint the new schema.
                await writeFile(`${this.file}.pre-stations-${Date.now()}.bak`, original, { mode: 0o600, flag: 'wx' });
            }
            return data;
        }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }

    // Flush bytes before an atomic rename and flush the directory before acknowledging a transaction.
    save(data) {
        const json = JSON.stringify(data);
        this.pending = this.pending.then(async () => {
            await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
            const temporary = `${this.file}.next`;
            await writeFile(temporary, json, { mode: 0o600 });
            const handle = await open(temporary, 'r');
            try { await handle.sync(); } finally { await handle.close(); }
            await rename(temporary, this.file);
            const directory = await open(dirname(this.file), 'r');
            try { await directory.sync(); } finally { await directory.close(); }
        });
        return this.pending;
    }
}
