import { mkdir, readFile, writeFile, rename, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { bodies, tuning } from '../public/scripts/conquestPhysics.mjs';

// Validate snapshots before restoration rather than silently replacing corrupt persistent territory.
export function validateSave(data) {
    const world = data?.world;
    if (data?.schema !== 1 || !world?.players || !data.sessions || !Number.isFinite(world.elapsed)
        || world.elapsed < 0 || world.elapsed > 31536000 || !Number.isFinite(world.createdAt) || !Number.isFinite(world.updatedAt)
        || !Number.isInteger(world.eventCounter) || world.eventCounter < 0 || !world.planets
        || !Array.isArray(world.pickups) || !Array.isArray(world.projectiles)
        || world.pickups.length > 64 || world.projectiles.length > 256) throw new Error('Invalid galaxy snapshot. Restore a valid backup before starting.');
    const ids = Object.keys(world.players);
    if (ids.length > 8 || Object.keys(data.sessions).length !== ids.length) throw new Error('Invalid pilot reservations.');
    for (const id of ids) {
        const actor = world.players[id], p = actor.player, session = data.sessions[id];
        if (!/^p-[a-f0-9-]{36}$/.test(id) || p?.id !== id || !session || !/^[a-f0-9]{64}$/.test(session.tokenHash)
            || !['x', 'y', 'vx', 'vy', 'angle', 'fuel', 'cargo', 'aimAngle', 'deadUntil'].every(key => Number.isFinite(p[key]) && Math.abs(p[key]) < 1e8)
            || !bodies.some(body => body.id === p.homeId) || !Number.isInteger(p.rocketTier) || p.rocketTier < 0 || p.rocketTier > 4
            || !actor.stats || !['captures', 'deaths', 'cargoCollected', 'shots'].every(key => Number.isFinite(actor.stats[key]) && actor.stats[key] >= 0)
            || !/^Pilot [1-8]$/.test(p.label) || !/^#[a-f0-9]{6}$/i.test(p.color)
            || p.fuel < 0 || p.fuel > 100 || p.cargo < 0
            || !['rotationVelocity', 'gunHeat', 'gunOverheatedUntil', 'joinedAt'].every(key => Number.isFinite(p[key]))
            || p.gunHeat < 0 || p.gunHeat > 1 || !actor.target || !bodies.some(body => body.id === actor.target.bodyId)
            || !['planet', 'relay'].includes(actor.target.type)
            || !Number.isSafeInteger(session.lastActionId) || session.lastActionId < 0
            || typeof session.connected !== 'boolean'
            || (!session.connected && !Number.isFinite(session.expiresAt))) throw new Error('Invalid saved pilot.');
    }
    for (const body of bodies) {
        const planet = world.planets[body.id];
        if (!planet || (planet.owner !== null && !ids.includes(planet.owner)) || !Number.isInteger(planet.level)
            || planet.level < 0 || planet.level > 3 || !Number.isFinite(planet.stock) || planet.stock < 0
            || typeof planet.home !== 'boolean' || (planet.home && !planet.owner)) throw new Error('Invalid saved territory.');
        if (planet.turretHealth !== undefined && (!Number.isFinite(planet.turretHealth) || planet.turretHealth < 0 || planet.turretHealth > tuning.turretHealth)) throw new Error('Invalid saved turret health.');
        for (const key of ['turretAngle', 'turretDisabledUntil']) {
            if (planet[key] !== undefined && (!Number.isFinite(planet[key]) || Math.abs(planet[key]) > 1e8)) throw new Error('Invalid saved turret state.');
        }
    }
    const homes = new Set();
    for (const id of ids) {
        const actor = world.players[id];
        if (homes.has(actor.player.homeId) || world.planets[actor.player.homeId].owner !== id || !world.planets[actor.player.homeId].home) throw new Error('Invalid home reservation.');
        homes.add(actor.player.homeId);
        if (actor.hack && (!bodies.some(body => body.id === actor.hack.bodyId) || !Number.isInteger(actor.hack.digit)
            || actor.hack.digit < 0 || actor.hack.digit > 9 || !Number.isInteger(actor.hack.progress)
            || !Number.isInteger(actor.hack.required) || actor.hack.required < 1 || actor.hack.required > 100
            || actor.hack.progress < 0 || actor.hack.progress >= actor.hack.required)) throw new Error('Invalid saved challenge.');
    }
    for (const entity of [...world.pickups, ...world.projectiles]) {
        if (!['x', 'y', 'vx', 'vy', 'expiresAt'].every(key => Number.isFinite(entity[key]) && Math.abs(entity[key]) < 1e8)) throw new Error('Invalid saved entity.');
    }
    return data;
}

// Serialize atomic, durable snapshots so overlapping checkpoints cannot overwrite newer state.
export class GalaxyStore {
    // Keep runtime state at an explicit path owned by this service.
    constructor(file) { this.file = file; this.pending = Promise.resolve(); }

    // Missing state means a new galaxy; malformed state is an actionable startup error.
    async load() {
        try { return validateSave(JSON.parse(await readFile(this.file, 'utf8'))); }
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
