import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { bodies, createWorld, tuning, withPlayer, stepGalaxy, interact, hackDigit,
    upgradePlanet, upgradeRocket, killPlayer, setTarget, nearestRelay, dockingPoint } from '../public/scripts/conquestPhysics.mjs';

export const reconnectMs = 30000;
export const playerLimit = 8;
const colors = ['#8cdeb0', '#ff9fb8', '#9fbdff', '#edbc83', '#c7a2ff', '#92e7e5', '#f0de87', '#e7a0e9'];

// Hash reconnect secrets before putting them on disk; raw tokens remain client-side only.
function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }

// Use a constant-time comparison for the bounded reconnect token digest.
function matchesToken(token, hash) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(hash || '')) return false;
    return timingSafeEqual(Buffer.from(tokenHash(token), 'hex'), Buffer.from(hash, 'hex'));
}

// Own one shared galaxy, reservations, and safe per-pilot snapshots without network dependencies.
export class GameRoom {
    // Restore durable state and reserve formerly connected pilots for the agreed restart grace period.
    constructor(saved = null, now = Date.now()) {
        this.world = saved?.world || createWorld(randomUUID(), now);
        this.sessions = saved?.sessions || {};
        this.inputs = {};
        this.notices = [];
        if (!saved) {
            this.world.players = {};
            this.world.events = [];
            for (const planet of Object.values(this.world.planets)) Object.assign(planet, { owner: null, home: false });
        }
        this.world.events = [];
        for (const session of Object.values(this.sessions)) {
            if (session.connected) session.expiresAt = now + reconnectMs;
            session.connected = false;
        }
        for (const id of Object.keys(this.world.players)) withPlayer(this.world, id, () => {
            if (this.world.player.docked) interact(this.world);
        });
        this.expire(now);
    }

    // Start each home near useful neutral territory, keeping Moon as Earth's first destination when free.
    starterRelay(player) {
        const neutral = bodies.filter(body => !body.station && !this.world.planets[body.id].owner && !this.world.planets[body.id].home);
        if (player.homeId === 'earth' && neutral.some(body => body.id === 'moon')) return bodies.find(body => body.id === 'moon');
        return neutral.sort((a, b) => {
            const first = dockingPoint(a), second = dockingPoint(b);
            return Math.hypot(first.x - player.x, first.y - player.y) - Math.hypot(second.x - player.x, second.y - player.y);
        })[0] || nearestRelay(player, this.world);
    }

    // Join anonymously or recover the same pilot using an opaque, unexpired credential.
    join(token = '', now = Date.now()) {
        this.expire(now);
        for (const [id, session] of Object.entries(this.sessions)) {
            if (matchesToken(token, session.tokenHash)) {
                if (!session.connected) this.announce(id, 'rejoined the galaxy.');
                session.connected = true; session.expiresAt = null;
                this.inputs[id] = { value: {}, at: now };
                return { playerId: id, token, resumed: true };
            }
        }
        if (Object.keys(this.sessions).length >= playerLimit) throw new Error('Room full. Try again shortly.');
        const homeIds = bodies.filter(body => body.station).map(body => body.id);
        const freeHome = body => !this.world.planets[body.id].owner
            && !Object.values(this.world.players).some(actor => actor.player.docked === body.id);
        const home = homeIds.map(id => bodies.find(body => body.id === id)).find(freeHome)
            ;
        if (!home) throw new Error('No free home planet.');
        const id = `p-${randomUUID()}`;
        const seed = createWorld(randomUUID(), now);
        const used = new Set(Object.values(this.world.players).map(actor => actor.player.color));
        const color = colors.find(color => !used.has(color));
        const occupiedLabels = new Set(Object.values(this.world.players).map(actor => actor.player.label));
        let labelNumber = 1;
        while (occupiedLabels.has(`Pilot ${labelNumber}`)) labelNumber++;
        const player = { ...seed.player, id, label: `Pilot ${labelNumber}`, color, homeId: home.id, rocketTier: 0, joinedAt: this.world.elapsed,
            x: home.x, y: home.y - home.radius - tuning.shipRadius, landedOn: home.id };
        this.world.players[id] = { player, hack: null, target: { bodyId: home.id, type: 'planet' }, stats: seed.stats, refueling: null };
        Object.assign(this.world.planets[home.id], { owner: id, home: true, level: 0, stock: 0 });
        withPlayer(this.world, id, () => { this.world.target = { bodyId: this.starterRelay(player).id, type: 'relay' }; });
        for (const actorId of Object.keys(this.world.players)) withPlayer(this.world, actorId, () => {
            if (this.world.target.bodyId === home.id && this.world.target.type === 'relay') {
                this.world.target = { bodyId: this.starterRelay(this.world.player).id, type: 'relay' };
            }
        });
        token = randomBytes(32).toString('hex');
        this.sessions[id] = { tokenHash: tokenHash(token), connected: true, expiresAt: null, lastActionId: 0 };
        this.inputs[id] = { value: {}, at: now };
        this.announce(id, 'joined the galaxy.');
        return { playerId: id, token, resumed: false };
    }

    // Stop held inputs and partial hacks immediately, without granting disconnect invulnerability.
    disconnect(id, now = Date.now()) {
        const session = this.sessions[id];
        if (!session || !session.connected) return;
        this.announce(id, 'disconnected — reconnecting for up to 30 seconds.');
        session.connected = false; session.expiresAt = now + reconnectMs;
        this.inputs[id] = { value: {}, at: now };
        withPlayer(this.world, id, () => { if (this.world.player.docked) interact(this.world); });
    }

    // Release all territory after departure and remove the corresponding pilot reservation.
    leave(id) {
        if (!this.sessions[id]) return;
        this.announce(id, 'left the galaxy.');
        for (const planet of Object.values(this.world.planets)) if (planet.owner === id) {
            Object.assign(planet, { owner: null, home: false, level: 0, stock: 0, nextShotAt: 0 });
            for (const key of ['turrets', 'turretHealth', 'turretDisabledUntil', 'turretAngle']) delete planet[key];
        }
        this.world.projectiles = this.world.projectiles.filter(shot => shot.owner !== id);
        delete this.world.players[id]; delete this.sessions[id]; delete this.inputs[id];
    }

    // Keep a bounded transient activity feed made only from generated pilot labels and server actions.
    announce(id, action) {
        const player = this.world.players[id]?.player;
        if (!player) return;
        this.notices.push({ text: `${player.label} ${action}`, color: player.color });
        if (this.notices.length > 40) this.notices.shift();
    }

    // Expire absence using wall time so a paused or restarted process cannot retain abandoned homes.
    expire(now = Date.now()) {
        for (const [id, session] of Object.entries(this.sessions)) {
            if (!session.connected && session.expiresAt <= now) this.leave(id);
        }
    }

    // Accept only bounded controls, never position, velocity, resources, or client hit claims.
    setInput(id, value, now = Date.now()) {
        if (!this.sessions[id]?.connected || !value || typeof value !== 'object' || Array.isArray(value)) return false;
        if (Object.keys(value).some(key => !['burn', 'rcsX', 'rcsY', 'aimAngle', 'fire', 'capture', 'captureBody'].includes(key))) return false;
        if (typeof value.burn !== 'boolean' || typeof value.fire !== 'boolean'
            || !Number.isFinite(value.rcsX) || Math.abs(value.rcsX) > 1
            || !Number.isFinite(value.rcsY) || value.rcsY < 0 || value.rcsY > 1
            || (value.aimAngle !== null && (!Number.isFinite(value.aimAngle) || Math.abs(value.aimAngle) > 10000))) return false;
        if (value.capture !== undefined && typeof value.capture !== 'boolean') return false;
        if (value.captureBody != null && !bodies.some(body => body.id === value.captureBody)) return false;
        const controls = { ...value };
        if (controls.aimAngle === null) delete controls.aimAngle;
        this.inputs[id] = { value: controls, at: now };
        return true;
    }

    // Apply purchases, captures, and other commands in the authoritative pilot context.
    action(id, message) {
        if (!this.sessions[id]?.connected) return { ok: false, reason: 'Not connected.' };
        return withPlayer(this.world, id, () => {
            switch (message.action) {
                case 'interact': return interact(this.world, typeof message.bodyId === 'string' ? message.bodyId : null);
                case 'digit': {
                    if (!Number.isInteger(message.digit) || message.digit < 0 || message.digit > 9
                        || !Number.isInteger(message.challengeId)) return { ok: false, reason: 'Invalid code.' };
                    const result = hackDigit(this.world, message.digit, { challengeId: message.challengeId });
                    hackDigit(this.world, null); return result;
                }
                case 'planetUpgrade': return upgradePlanet(this.world);
                case 'rocketUpgrade': return upgradeRocket(this.world);
                case 'selfDestruct': return { ok: killPlayer(this.world, 'Self-destruct.') };
                case 'target': return { ok: setTarget(this.world, message.bodyId, message.targetType) };
                default: return { ok: false, reason: 'Unknown action.' };
            }
        });
    }

    // Advance the shared simulation once, clearing stale controls and expired reconnect reservations.
    tick(dt, now = Date.now()) {
        this.expire(now);
        const inputs = {};
        for (const id of Object.keys(this.world.players)) inputs[id] = now - (this.inputs[id]?.at || 0) <= 300
            && this.sessions[id]?.connected ? this.inputs[id].value : {};
        for (const [id, actor] of Object.entries(this.world.players)) {
            actor.player.thrusting = Boolean(inputs[id]?.burn);
            actor.player.braking = Boolean(inputs[id]?.rcsY);
        }
        stepGalaxy(this.world, inputs, dt);
    }

    // Reveal nearby ships and recently firing ships, keeping distant private pilot state off the wire.
    view(id) {
        const actor = this.world.players[id];
        if (!actor) return null;
        const player = actor.player;
        const others = Object.values(this.world.players).filter(other => other.player.id !== id
            && (Math.hypot(other.player.x - player.x, other.player.y - player.y) <= 2400
                || ((other.player.nextShotAt || 0) > 0 && other.player.nextShotAt > this.world.elapsed - 1.5))).map(other => {
                    const p = other.player;
                    return { id: p.id, label: p.label, color: p.color, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
                        angle: p.angle, aimAngle: p.aimAngle, deadUntil: p.deadUntil, cargo: p.cargo > 0 ? 1 : 0,
                        damageFlashUntil: p.damageFlashUntil || 0,
                        rocketTier: p.rocketTier || 0, gunHeat: p.gunHeat || 0, gunOverheatedUntil: p.gunOverheatedUntil || 0,
                        thrusting: Boolean(p.thrusting), braking: Boolean(p.braking), docked: p.docked };
                });
        return { version: 2, id: this.world.id, createdAt: this.world.createdAt, updatedAt: this.world.updatedAt,
            elapsed: this.world.elapsed, player, planets: this.world.planets, projectiles: this.world.projectiles,
            pickups: this.world.pickups, events: [], eventCounter: this.world.eventCounter, ...actor,
            ownerColors: Object.fromEntries(Object.values(this.world.players).map(actor => [actor.player.id, actor.player.color])),
            mapPlayers: Object.values(this.world.players).map(actor => ({ id: actor.player.id, label: actor.player.label,
                color: actor.player.color, x: actor.player.x, y: actor.player.y, angle: actor.player.angle,
                deadUntil: actor.player.deadUntil, connected: Boolean(this.sessions[actor.player.id]?.connected) })),
            others, online: Object.values(this.sessions).filter(session => session.connected).length };
    }

    // Export only durable gameplay and hashed reservations; chat and controls are intentionally omitted.
    saved() { return { schema: 1, world: { ...this.world, events: [] }, sessions: this.sessions }; }
}
