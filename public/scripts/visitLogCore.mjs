// Only these product-owned labels can enter the log; DOM text and typed values never do.
export const eventNames = ['pageView', 'firstAction', 'click', 'screenView', 'controlPress', 'controlRelease',
    'throttleChange', 'dockAttempt', 'dockingChecklist', 'historyToggle', 'gameLifecycle', 'conquest', 'briefingToggle', 'pageLeave', 'pageReturn', 'heartbeat'];
export const targets = ['page', 'menu', 'confirm', 'history', 'results', 'flight', 'briefing', 'other',
    'BUTTON', 'A', 'CANVAS', 'H1', 'H2', 'P', 'DIV', 'SPAN', 'INPUT', 'SUMMARY', 'IMG', 'SVG', 'PATH',
    'burn', 'rotateLeft', 'rotateRight', 'rcsUp', 'rcsDown', 'rcsLeft', 'rcsRight',
    'gameMenu', 'gameDock', 'gameBurn', 'gameThrottle', 'gameThrottleDown', 'gameThrottleUp',
    'gameRotateLeft', 'gameRotateRight', 'gameRcsUp', 'gameRcsDown', 'gameRcsLeft', 'gameRcsRight',
    'gameContinue', 'gameStart', 'gameNewRun', 'gameHistory', 'gameConfirmNewRun', 'gameCancelNewRun',
    'gameHistoryBack', 'gameRetry', 'servers', 'records', 'conquest', 'planet', 'relay', 'map', 'fire', 'gameFire',
    'gameServers', 'gameServerJoin', 'gameServerRefresh', 'gameServerBack', 'gameRecords', 'gameBriefing',
    'conquestReset', 'conquestUpgrade', 'conquestInteract', 'conquestSelfDestruct', 'conquestSelfDestructCancel',
    'conquestMap', 'conquestDigit', 'conquestBriefing', 'conquestFire', 'conquestJoin', 'conquestGalaxies'];
export const actions = ['started', 'continued', 'left', 'suspended', 'landed', 'delivered', 'won', 'lost', 'abandoned'];
export const conquestActions = ['joined', 'continued', 'left', 'suspended', 'expired', 'spawned', 'died', 'respawned', 'damaged',
    'landed', 'docked', 'detached', 'hackStarted', 'hackProgress', 'hackCancelled', 'captured', 'cargoCollected', 'cargoDropped',
    'cargoPickedUp', 'refuelStarted', 'refuelEnded', 'upgraded', 'upgradeRejected', 'shotStarted', 'shotEnded',
    'selfDestruct', 'mapTarget', 'reset'];
export const conquestTargets = ['conquest', 'planet', 'relay', 'map'];
export const conquestRanges = { gameplaySeconds: 86400, fuel: 100, cargo: 1000000, owned: 256, planetLevel: 10, amount: 1000000 };
export const queueKey = 'orbital.visitLog.v1';

// Project optional snapshots strictly; extra metadata, coordinates, digits and private IDs never enter a row.
export function safeConquestDetails(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !conquestActions.includes(input.action)) return null;
    const details = { action: input.action };
    for (const [key, maximum] of Object.entries(conquestRanges)) {
        if (!Object.hasOwn(input, key)) continue;
        const value = input[key];
        if (!Number.isFinite(value) || value < 0 || value > maximum
            || (!['gameplaySeconds', 'fuel'].includes(key) && !Number.isInteger(value))) return null;
        details[key] = Math.round(value * 100) / 100;
    }
    if (details.action === 'damaged' && (!Number.isInteger(details.amount) || details.amount <= 0
        || !Number.isFinite(details.fuel))) return null;
    // Optional progress counts are cumulative successful presses: at most twenty five-count milestones per hack.
    if (details.action === 'hackProgress' && Object.hasOwn(details, 'amount') && (!Number.isInteger(details.amount)
        || details.amount < 5 || details.amount > 100 || details.amount % 5 !== 0)) return null;
    return details;
}

// Bound repeated hold notifications and progress updates without collecting projectile or challenge identity.
export class ConquestTracker {
    // Keep only semantic state; the append-only outbox remains the source of saved events.
    constructor() {
        this.firing = null;
        this.hacking = false;
        this.hackCount = -1;
    }

    // Accept each firing edge and increasing milestone once; unnumbered progress is recorded once per hack.
    accept(input) {
        const details = safeConquestDetails(input);
        const target = input?.target === undefined ? 'conquest' : input.target;
        if (!details || !conquestTargets.includes(target)) return null;
        const { action } = details;
        if (action === 'shotStarted' || action === 'shotEnded') {
            const firing = action === 'shotStarted';
            if (this.firing === firing) return null;
            this.firing = firing;
        }
        if (action === 'hackStarted') {
            if (this.hacking) return null;
            this.hacking = true;
            this.hackCount = -1;
        }
        if (action === 'hackProgress') {
            const count = details.amount ?? 0;
            if (count <= this.hackCount) return null;
            this.hackCount = count;
            this.hacking = true;
        }
        if (['detached', 'hackCancelled', 'captured', 'joined', 'continued', 'left', 'suspended',
            'expired', 'died', 'respawned', 'selfDestruct', 'reset'].includes(action)) {
            this.hacking = false;
            this.hackCount = -1;
        }
        if (['joined', 'continued', 'left', 'suspended', 'expired', 'died', 'respawned', 'selfDestruct', 'reset'].includes(action)) {
            this.firing = null;
        }
        return { target, details };
    }
}

// Project application metadata into a bounded schema instead of accepting arbitrary strings or maps.
export function safeDetails(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const details = {};
    if (actions.includes(input.action)) details.action = input.action;
    for (const key of ['restored', 'open']) if (typeof input[key] === 'boolean') details[key] = input[key];
    const ranges = { routeIndex: 9, deliveries: 10, fuel: 100, gameplaySeconds: 86400, throttle: 100 };
    for (const [key, maximum] of Object.entries(ranges)) {
        if (Number.isFinite(input[key])) details[key] = Math.round(Math.max(0, Math.min(maximum, input[key])) * 100) / 100;
    }
    return details;
}

// Encode only plain data supported by the small Firestore REST schema.
export function firestoreValue(value) {
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) } };
}

// Persist the outbox before sending so refreshes can retry the same immutable event IDs.
export class VisitQueue {
    // Restore one tab's visit, never a long-lived cross-device visitor identity.
    constructor(storage, now = Date.now(), uuid = () => crypto.randomUUID()) {
        this.storage = storage;
        this.conquest = new ConquestTracker();
        let saved;
        try { saved = JSON.parse(storage?.getItem(queueKey) || 'null'); } catch { /* Start a new visit if storage is unavailable. */ }
        const valid = saved && /^[a-f0-9-]{36}$/.test(saved.sessionId) && Number.isSafeInteger(saved.sequence)
            && saved.sequence >= 0 && saved.sequence <= 5000 && Number.isFinite(saved.startedAt)
            && now >= saved.startedAt && now - saved.startedAt < 86400000 && now - saved.lastAt < 1800000
            && Array.isArray(saved.pending) && saved.pending.length <= 5000;
        this.state = valid ? saved : { sessionId: uuid(), startedAt: now, lastAt: now, sequence: 0, firstAction: false, pending: [] };
        this.persist();
    }

    // Keep storage errors separate from game state; the UI still reports unsaved network data.
    persist() {
        try { this.storage?.setItem(queueKey, JSON.stringify(this.state)); } catch { /* Memory-only outbox still retries while this page is open. */ }
    }

    // Allocate stable sequence numbers and strip anything outside the approved event schema.
    add(eventName, target, details = {}, now = Date.now()) {
        if (!eventNames.includes(eventName) || this.state.sequence >= 5000) return null;
        if (eventName === 'conquest') {
            const conquest = this.conquest.accept({ ...details, target });
            if (!conquest) return null;
            target = conquest.target;
            details = conquest.details;
        } else details = safeDetails(details);
        const recordedAt = Math.max(this.state.lastAt, now);
        const event = { sessionId: this.state.sessionId, sequence: ++this.state.sequence, eventName,
            target: targets.includes(target) ? target : 'other', recordedAt,
            elapsedMs: recordedAt - this.state.startedAt, details };
        this.state.lastAt = recordedAt;
        this.state.pending.push(event);
        this.persist();
        return event;
    }

    // Remove only acknowledged rows, retaining events captured during an in-flight upload.
    acknowledge(events) {
        const sent = new Set(events.map(event => event.sequence));
        this.state.pending = this.state.pending.filter(event => !sent.has(event.sequence));
        this.persist();
    }
}

// Build an atomic, retry-safe chunk; maximum transforms prevent late requests rolling the summary back.
export function eventWrites(documentRoot, events) {
    if (!events.length) return [];
    return [...events.map(event => ({
        update: { name: `${documentRoot}/events/${event.sequence}`, fields: firestoreValue(event).mapValue.fields },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'receivedAt', setToServerValue: 'REQUEST_TIME' }]
    })), { transform: { document: documentRoot, fieldTransforms: [
        { fieldPath: 'lastEventAt', maximum: firestoreValue(Math.max(...events.map(event => event.recordedAt))) },
        { fieldPath: 'lastSequence', maximum: firestoreValue(Math.max(...events.map(event => event.sequence))) },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }
    ] } }];
}
