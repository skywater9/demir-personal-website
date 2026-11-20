import { bodies, territoryBodies, celestialBodies, roguePlanets, extraStarterStations, createWorld, stepWorld, tuning, interact, removeRetiredPlanets, migrateUpgradeTracks } from './conquestPhysics.mjs?v=20261120-soft-galaxy-edge';

export const conquestKey = 'orbital.conquest.stationPrototype.v1';
export const reconnectWindow = 30000;
const bodyIds = new Set(bodies.map(body => body.id));

// Reject malformed snapshots before resuming physics, keeping legacy flight records separate.
export function validWorld(world) {
    if (!world || (world.upgradeTracksVersion !== undefined && world.upgradeTracksVersion !== 2) || world.version !== 2 || typeof world.id !== 'string' || world.id.length > 100 || !world.player
        || !Number.isFinite(world.createdAt) || !Number.isFinite(world.updatedAt)
        || !Number.isInteger(world.eventCounter) || world.eventCounter < 0
        || !Number.isFinite(world.elapsed) || world.elapsed < 0 || world.elapsed > 31536000
        || !world.planets || Object.keys(world.planets).some(id => !territoryBodies.some(body => body.id === id))
        || world.celestialTargetsVersion !== undefined && world.celestialTargetsVersion !== 1) return false;
    if (world.galaxyExpanded !== undefined && typeof world.galaxyExpanded !== 'boolean') return false;
    if (![undefined, 1, 2, 3, 4, 5, 6].includes(world.roguePlanetsVersion)) return false;
    const player = world.player;
    for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'fuel', 'cargo', 'deadUntil', 'aimAngle', 'rotationVelocity']) {
        if (!Number.isFinite(player[key]) || Math.abs(player[key]) > 1e8) return false;
    }
    if (player.rocketTier !== undefined && (!Number.isInteger(player.rocketTier) || player.rocketTier < 0 || player.rocketTier > (world.upgradeTracksVersion === 2 ? tuning.maxRocketLevel : 4))) return false;
    if (player.dashReadyAt !== undefined && !Number.isFinite(player.dashReadyAt)) return false;
    if (player.dashUntil !== undefined && (!Number.isFinite(player.dashUntil) || Math.abs(player.dashUntil) > 1e8)) return false;
    for (const key of ['dashRecoveryUntil', 'dashBaseSpeed']) {
        if (player[key] !== undefined && (!Number.isFinite(player[key]) || Math.abs(player[key]) > 1e8)) return false;
    }
    if (player.id !== 'pilot' || !bodyIds.has(player.homeId) || player.fuel < 0 || player.fuel > 100
        || player.cargo < 0 || !(player.docked === null || bodyIds.has(player.docked))
        || !(player.landedOn === null || bodyIds.has(player.landedOn))) return false;
    if (world.upgradeTracksVersion === 2 && (!Number.isInteger(player.weaponTier) || player.weaponTier < 0 || player.weaponTier > tuning.maxRocketLevel)) return false;
    for (const body of territoryBodies) {
        const state = world.planets[body.id];
        if (!state && extraStarterStations.includes(body)) continue;
        if (!state && roguePlanets.includes(body) && (world.roguePlanetsVersion ?? 0) < 6) continue;
        if (!state && celestialBodies.some(candidate => candidate.id === body.id) && world.celestialTargetsVersion !== 1) continue;
        if (!state || !(state.owner === null || state.owner === 'pilot')
            || !Number.isInteger(state.level) || state.level < 0 || state.level > (world.upgradeTracksVersion === 2 ? tuning.maxPlanetLevel : 20)
            || !Number.isFinite(state.stock) || state.stock < 0 || state.stock > 1e6) return false;
        if (state.nextCargoAt !== undefined && (!Number.isFinite(state.nextCargoAt) || Math.abs(state.nextCargoAt) > 1e8)) return false;
        if (state.recaptureAt !== undefined && (!Number.isFinite(state.recaptureAt) || state.recaptureAt < 0 || state.recaptureAt > 1e8)) return false;
        if (state.capturedAt !== undefined && (!Number.isFinite(state.capturedAt) || state.capturedAt < 0 || state.capturedAt > world.elapsed)) return false;
        if (state.turrets !== undefined && (!Array.isArray(state.turrets) || state.turrets.length !== state.level
            || !state.turrets.every(turret => turret && ['health', 'angle', 'disabledUntil', 'nextShotAt'].every(key =>
                Number.isFinite(turret[key]) && Math.abs(turret[key]) < 1e8)
                && (turret.repairAt === undefined || Number.isFinite(turret.repairAt) && turret.repairAt >= 0 && turret.repairAt < 1e8)
                && (turret.double === undefined || typeof turret.double === 'boolean')
                && turret.health >= 0 && turret.health <= 5))) return false;
        if (state.turretHealth !== undefined && (!Number.isFinite(state.turretHealth) || state.turretHealth < 0 || state.turretHealth > 5)) return false;
        for (const key of ['turretAngle', 'turretDisabledUntil']) {
            if (state[key] !== undefined && (!Number.isFinite(state[key]) || Math.abs(state[key]) > 1e8)) return false;
        }
    }
    if (world.planets[player.homeId].owner !== player.id) return false;
    if (!world.stats || !['captures', 'deaths', 'cargoCollected', 'shots'].every(key => Number.isFinite(world.stats[key]) && world.stats[key] >= 0)) return false;
    if (!world.target || !territoryBodies.some(body => body.id === world.target.bodyId) || !['planet', 'relay'].includes(world.target.type)) return false;
    for (const key of ['events', 'projectiles', 'pickups']) {
        if (!Array.isArray(world[key]) || world[key].length > 1500) return false;
    }
    for (const entity of [...world.projectiles, ...world.pickups]) {
        if (!['x', 'y'].every(key => Number.isFinite(entity[key]) && Math.abs(entity[key]) < 1e8)) return false;
    }
    if (!world.events.every(event => Number.isInteger(event.seq) && event.seq >= 1
        && typeof event.type === 'string' && event.type.length <= 60 && Number.isFinite(event.elapsed))) return false;
    return true;
}

// Keep one local galaxy per tab, with a 30-second refresh/reconnect allowance and bounded records.
export class ConquestStore {
    // Accept injected storage and clocks so lifecycle rules can be exercised without a browser.
    constructor(storage, onError = () => {}, now = () => Date.now()) {
        this.storage = storage;
        this.onError = onError;
        this.now = now;
        this.available = Boolean(storage);
        this.memory = null;
        this.expired = false;
        if (!storage) onError('Storage is unavailable. This local galaxy lasts until the page closes.');
    }

    // Read a bounded envelope while treating bad storage as recoverable rather than blocking play.
    read() {
        if (!this.available) return this.memory;
        try {
            const raw = this.storage.getItem(conquestKey);
            if (!raw) return null;
            if (raw.length > 2000000) throw new Error('Snapshot is too large.');
            const value = JSON.parse(raw);
            if (!value || value.version !== 2 || !Array.isArray(value.records) || value.records.length > 30) throw new Error('Invalid local galaxy record.');
            removeRetiredPlanets(value.world);
            if (value.world && !validWorld(value.world)) throw new Error('Invalid galaxy snapshot.');
            if (value.world) migrateUpgradeTracks(value.world);
            if (!Number.isFinite(value.savedAt) || !Number.isFinite(value.lastEvent)) throw new Error('Invalid save timestamp.');
            this.memory = value;
            return value;
        } catch (error) {
            this.onError('The local galaxy could not be restored. Start a new galaxy; previous story records are untouched.');
            return this.memory;
        }
    }

    // Save one envelope atomically and keep a working in-memory fallback if storage is denied or full.
    write(value) {
        this.memory = value;
        if (!this.available) return;
        try { this.storage.setItem(conquestKey, JSON.stringify(value)); }
        catch {
            this.available = false;
            this.onError('Saving is unavailable. Keep this tab open to retain the local galaxy.');
        }
    }

    // Summarize a departed local session without storing an unbounded event history.
    summarize(world) {
        return { at: this.now(), elapsed: world.elapsed, fuel: world.player.fuel,
            owned: Object.values(world.planets).filter(planet => planet.owner === world.player.id).length,
            cargo: world.player.cargo, ...world.stats };
    }

    // Resume the latest state and simulate only the short interval allowed for a reconnection.
    restore() {
        const saved = this.read();
        if (!saved?.world) return null;
        const away = this.now() - saved.savedAt;
        if (away < 0 || away > reconnectWindow) {
            this.expired = true;
            this.write({ ...saved, world: null, records: [this.summarize(saved.world), ...saved.records].slice(0, 30), savedAt: this.now() });
            return null;
        }
        const world = structuredClone(saved.world);
        migrateUpgradeTracks(world);
        if (world.hack && world.player.docked) interact(world);
        world.hack = null;
        // Use fixed steps so offline coasting, fuel service, production, and respawn obey the live rules.
        let remaining = away / 1000;
        while (remaining > 0) {
            const dt = Math.min(tuning.fixedStep, remaining);
            stepWorld(world, {}, dt);
            remaining -= dt;
        }
        this.save(world, saved.lastEvent);
        return { world, lastEvent: saved.lastEvent };
    }

    // Checkpoint the current galaxy; old story-mode storage uses a different key and is never overwritten.
    save(world, lastEvent = 0) {
        if (!validWorld(world)) return false;
        const records = this.memory?.records || this.read()?.records || [];
        this.write({ version: 2, savedAt: this.now(), world: structuredClone(world), records, lastEvent });
        return true;
    }

    // Replace a session after explicit confirmation, retaining a small local archive of its statistics.
    start() {
        const previous = this.read();
        const records = previous?.world ? [this.summarize(previous.world), ...(previous.records || [])].slice(0, 30) : previous?.records || [];
        const world = createWorld(undefined, this.now());
        this.expired = false;
        this.write({ version: 2, savedAt: this.now(), world: structuredClone(world), records, lastEvent: 0 });
        return world;
    }

    // End participation without deleting the archive or any earlier story-game records.
    leave(world) {
        const saved = this.read();
        this.write({ version: 2, world: null, savedAt: this.now(), lastEvent: 0,
            records: [this.summarize(world), ...(saved?.records || [])].slice(0, 30) });
    }

    // Return detached summary data so UI rendering cannot mutate the save envelope.
    records() {
        return structuredClone(this.read()?.records || []);
    }
}
