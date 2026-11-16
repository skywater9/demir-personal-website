import { bodies, route, tuning } from './rocketPhysics.mjs';

export const saveKey = 'orbitalFreight.v1';
const statuses = ['active', 'won', 'lost', 'abandoned'];

// Reject corrupt or incompatible saves before they can reach the simulation or rendered UI.
export function isValidRun(run) {
    if (!run || run.version !== 1 || typeof run.id !== 'string' || run.id.length > 100
        || !statuses.includes(run.status) || !['station', 'planet'].includes(run.phase)
        || !Number.isInteger(run.routeIndex) || run.routeIndex < 0 || run.routeIndex >= route.length
        || !Number.isInteger(run.delivered) || run.delivered < 0 || run.delivered > route.length
        || !Number.isFinite(run.fuel) || run.fuel < 0 || run.fuel > tuning.maxFuel
        || !Number.isFinite(run.throttle) || run.throttle < 0 || run.throttle > 1
        || !Number.isFinite(run.elapsed) || run.elapsed < 0 || run.elapsed > 31536000
        || !Number.isFinite(run.startedAt) || !Number.isFinite(run.updatedAt)
        || typeof run.payload !== 'boolean' || typeof run.docked !== 'boolean'
        || typeof run.reason !== 'string' || run.reason.length > 300
        || !(run.landedOn === null || bodies.some(body => body.id === run.landedOn))) return false;
    for (const key of ['x', 'y', 'vx', 'vy', 'angle']) {
        if (!Number.isFinite(run[key]) || Math.abs(run[key]) > 1e8) return false;
    }
    if (!Array.isArray(run.serviced) || run.serviced.length > route.length
        || !run.serviced.every(index => Number.isInteger(index) && index >= 0 && index <= run.routeIndex)
        || !Array.isArray(run.events) || run.events.length > 200) return false;
    if (!run.events.every(event => event && typeof event.type === 'string' && event.type.length <= 60
        && Number.isFinite(event.at) && Number.isFinite(event.elapsed) && event.elapsed >= 0)) return false;
    if (run.status === 'active' && run.fuel <= 0) return false;
    if (run.status === 'won' && (run.delivered !== route.length || run.routeIndex !== route.length - 1)) return false;
    return true;
}

// Keep browser storage optional so blocked storage never prevents the game from starting.
export class RunStore {
    // Load a bounded archive and expose storage failures through one visible application warning.
    constructor(storage, onError = () => {}) {
        this.storage = storage;
        this.onError = onError;
        this.available = Boolean(storage);
        this.data = { version: 1, active: null, history: [] };
        if (!storage) this.reportError('Browser storage is unavailable. Runs will last only until this page closes.');
        this.restore();
    }

    // Preserve valid history even when an unfinished save has become corrupt or incompatible.
    restore() {
        if (!this.available) return;
        try {
            const raw = this.storage.getItem(saveKey);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (!saved || saved.version !== 1 || !Array.isArray(saved.history)) {
                throw new Error('Unrecognized save format.');
            }
            this.data.history = saved.history.filter(run => isValidRun(run) && run.status !== 'active').slice(0, 100);
            if (saved.active !== null && (!isValidRun(saved.active) || saved.active.status !== 'active')) {
                throw new Error('The unfinished run is invalid.');
            }
            this.data.active = saved.active;
        } catch (error) {
            console.warn('[orbital freight] Could not restore saved progress.', error);
            this.reportError('Saved progress could not be restored. Valid previous results remain available.');
        }
    }

    // Notify the user without throwing through animation frames or storage event handlers.
    reportError(message) {
        this.onError(message);
    }

    // Return independent copies so menu previews cannot accidentally mutate the saved run.
    getActive() {
        return this.data.active ? structuredClone(this.data.active) : null;
    }

    // Keep history newest-first and independent from the mutable live simulation.
    getHistory() {
        return structuredClone(this.data.history);
    }

    // Atomically replace the single local envelope, falling back to an in-memory session on failure.
    persist() {
        if (!this.available) return;
        try {
            this.storage.setItem(saveKey, JSON.stringify(this.data));
        } catch (error) {
            console.warn('[orbital freight] Could not persist runs.', error);
            this.available = false;
            this.reportError('Saving is unavailable or storage is full. This session is now kept in memory only.');
        }
    }

    // Checkpoint an active run without writing invalid or terminal states as resumable progress.
    saveActive(run) {
        if (!isValidRun(run) || run.status !== 'active') return false;
        this.data.active = structuredClone(run);
        this.persist();
        return true;
    }

    // Archive results idempotently; only remove saved progress when it belongs to the same run.
    archive(run) {
        if (!isValidRun(run) || run.status === 'active') return false;
        this.data.history = [structuredClone(run), ...this.data.history.filter(item => item.id !== run.id)].slice(0, 100);
        if (this.data.active?.id === run.id) this.data.active = null;
        this.persist();
        return true;
    }
}
