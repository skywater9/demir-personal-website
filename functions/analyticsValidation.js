const maxSessionMs = 24 * 60 * 60 * 1000;
const maxClockSkewMs = 5 * 60 * 1000;
const sectionIds = ['header', 'clickCounter', 'game', 'visitCounter', 'menu', 'cockpit', 'history', 'results'];
const elementIds = [
    'headerClick', 'counterIncrement', 'counterReset', 'gameStart', 'gameContinue',
    'gameNewRun', 'gameConfirmNewRun', 'gameCancelNewRun', 'gameMenu', 'gameRetry',
    'gameHistory', 'gameHistoryBack', 'gameDock', 'gameThrottleUp', 'gameThrottleDown',
    'gameRotateLeft', 'gameRotateRight', 'gameRcsUp', 'gameRcsDown', 'gameRcsLeft',
    'gameRcsRight', 'gameResume', 'gameBurn', 'gameThrottle'
];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Reject unknown fields so unplanned personal data cannot enter analytics documents.
function requireKeys(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || required.some(key => !Object.hasOwn(value, key))
        || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
        throw new Error('Unexpected or missing analytics fields.');
    }
}

// Enforce finite bounds for times, coordinates, and counts before database writes.
function requireNumber(value, minimum, maximum) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error('Analytics number is outside its allowed range.');
    }
}

// Restrict identifiers to the explicitly instrumented homepage elements.
function requireChoice(value, choices, nullable = false) {
    if (!(nullable && value === null) && !choices.includes(value)) {
        throw new Error('Unknown analytics identifier.');
    }
}

// Bound the anonymous session summary and reject contradictory timing totals.
function validateSession(session, now) {
    requireKeys(session, ['sessionId', 'startedAt', 'lastActivityAt', 'visibleMs',
        'engagedMs', 'sectionVisibleMs', 'lastMeaningfulAction']);
    if (!uuidPattern.test(session.sessionId)) {
        throw new Error('Invalid session ID.');
    }
    requireNumber(session.startedAt, now - maxSessionMs, now + maxClockSkewMs);
    requireNumber(session.lastActivityAt, session.startedAt, now + maxClockSkewMs);
    requireNumber(session.visibleMs, 0, Math.min(maxSessionMs, Math.max(0, now - session.startedAt) + maxClockSkewMs));
    requireNumber(session.engagedMs, 0, session.visibleMs);
    requireKeys(session.sectionVisibleMs, [], sectionIds);
    for (const duration of Object.values(session.sectionVisibleMs)) {
        requireNumber(duration, 0, session.visibleMs);
    }
    if (session.lastMeaningfulAction !== null) {
        requireKeys(session.lastMeaningfulAction, ['elementId', 'recordedAt']);
        requireChoice(session.lastMeaningfulAction.elementId, elementIds);
        requireNumber(session.lastMeaningfulAction.recordedAt, session.startedAt, session.lastActivityAt);
    }
}

// Validate the fields for each event type instead of accepting arbitrary properties.
function validateProperties(event) {
    const properties = event.properties;
    switch (event.eventName) {
        case 'pageView':
        case 'pageRestore':
        case 'sessionTimeout':
            requireKeys(properties, []);
            break;
        case 'visibilityChange':
            requireKeys(properties, ['visible']);
            if (typeof properties.visible !== 'boolean') {
                throw new Error('Invalid visibility flag.');
            }
            break;
        case 'sectionView':
            requireKeys(properties, ['sectionId']);
            requireChoice(properties.sectionId, sectionIds);
            break;
        case 'scrollMilestone':
            requireKeys(properties, ['percent']);
            requireChoice(properties.percent, [25, 50, 75, 100]);
            break;
        case 'interaction':
            requireKeys(properties, ['elementId', 'sectionId', 'inputType']);
            requireChoice(properties.elementId, elementIds);
            requireChoice(properties.sectionId, sectionIds, true);
            requireChoice(properties.inputType, ['keyboard', 'pointer']);
            break;
        case 'gameLifecycle':
            requireKeys(properties, ['action', 'runId', 'routeIndex', 'deliveries', 'fuel', 'gameplaySeconds']);
            requireChoice(properties.action, ['started', 'continued', 'left', 'suspended', 'landed',
                'delivered', 'won', 'lost', 'abandoned']);
            if (typeof properties.runId !== 'string' || !uuidPattern.test(properties.runId)
                || !Number.isInteger(properties.routeIndex) || !Number.isInteger(properties.deliveries)) {
                throw new Error('Invalid gameplay identifiers or counts.');
            }
            requireNumber(properties.routeIndex, 0, 9);
            requireNumber(properties.deliveries, 0, 10);
            requireNumber(properties.fuel, 0, 100);
            requireNumber(properties.gameplaySeconds, 0, 31536000);
            break;
        case 'sessionCheckpoint':
            requireKeys(properties, ['visibleMs', 'engagedMs']);
            requireNumber(properties.visibleMs, 0, maxSessionMs);
            requireNumber(properties.engagedMs, 0, properties.visibleMs);
            break;
        case 'click':
            requireKeys(properties, ['elementId', 'sectionId', 'documentX', 'documentY',
                'viewportWidth', 'viewportHeight', 'pageWidth', 'pageHeight', 'relativeX', 'relativeY']);
            requireChoice(properties.elementId, elementIds, true);
            requireChoice(properties.sectionId, sectionIds, true);
            for (const field of ['viewportWidth', 'viewportHeight', 'pageWidth', 'pageHeight']) {
                requireNumber(properties[field], 1, 200000);
            }
            requireNumber(properties.documentX, 0, properties.pageWidth);
            requireNumber(properties.documentY, 0, properties.pageHeight);
            for (const field of ['relativeX', 'relativeY']) {
                if (properties[field] !== null) {
                    requireNumber(properties[field], 0, 1);
                }
            }
            break;
        default:
            throw new Error('Unknown analytics event.');
    }
}

// Validate a small immutable batch, including event ownership and chronological sequence.
function validateBatch(batch, now = Date.now()) {
    requireKeys(batch, ['schemaVersion', 'batchId', 'pageInstanceId', 'session', 'events']);
    if (batch.schemaVersion !== 1 || !uuidPattern.test(batch.batchId) || !uuidPattern.test(batch.pageInstanceId)) {
        throw new Error('Invalid analytics batch identifiers.');
    }
    validateSession(batch.session, now);
    if (!Array.isArray(batch.events) || batch.events.length < 1 || batch.events.length > 40) {
        throw new Error('Analytics batches require between 1 and 40 events.');
    }
    let previousSequence = 0;
    for (const event of batch.events) {
        requireKeys(event, ['eventName', 'sessionId', 'pagePath', 'layoutVersion',
            'recordedAt', 'elapsedMs', 'sequence', 'properties']);
        if (event.sessionId !== batch.session.sessionId || !['/', '/index.html'].includes(event.pagePath)
            || !['homepage-v1', 'homepage-v2', 'homepage-v3'].includes(event.layoutVersion) || !Number.isSafeInteger(event.sequence)
            || event.sequence <= previousSequence || event.sequence > 1000000) {
            throw new Error('Invalid analytics event context.');
        }
        previousSequence = event.sequence;
        requireNumber(event.recordedAt, batch.session.startedAt, now + maxClockSkewMs);
        requireNumber(event.elapsedMs, 0, maxSessionMs);
        if (Math.abs(event.elapsedMs - (event.recordedAt - batch.session.startedAt)) > 1000) {
            throw new Error('Inconsistent analytics event time.');
        }
        validateProperties(event);
    }
    return batch;
}

// Merge cumulative snapshots with maxima so late retries cannot double-count or reverse time.
function mergeSession(previous, incoming, events, now) {
    if (previous && previous.startedAt !== incoming.startedAt) {
        throw new Error('Session start time cannot change.');
    }
    const sectionVisibleMs = { ...(previous?.sectionVisibleMs || {}) };
    for (const [sectionId, duration] of Object.entries(incoming.sectionVisibleMs)) {
        sectionVisibleMs[sectionId] = Math.max(sectionVisibleMs[sectionId] || 0, duration);
    }
    const lastEvent = events.at(-1);
    const replaceLastEvent = !previous || lastEvent.recordedAt >= previous.lastEventAt;
    const previousAction = previous?.lastMeaningfulAction;
    const incomingAction = incoming.lastMeaningfulAction;
    return {
        ...incoming,
        visibleMs: Math.max(previous?.visibleMs || 0, incoming.visibleMs),
        engagedMs: Math.max(previous?.engagedMs || 0, incoming.engagedMs),
        lastActivityAt: Math.max(previous?.lastActivityAt || 0, incoming.lastActivityAt),
        sectionVisibleMs,
        lastMeaningfulAction: (previousAction?.recordedAt || 0) > (incomingAction?.recordedAt || 0)
            ? previousAction : incomingAction,
        lastPagePath: replaceLastEvent ? lastEvent.pagePath : previous.lastPagePath,
        lastEventAt: Math.max(previous?.lastEventAt || 0, lastEvent.recordedAt),
        eventCount: (previous?.eventCount || 0) + events.length,
        batchCount: (previous?.batchCount || 0) + 1,
        rateWindowStartedAt: previous && now - previous.rateWindowStartedAt < 60000
            ? previous.rateWindowStartedAt : now,
        rateWindowCount: previous && now - previous.rateWindowStartedAt < 60000
            ? previous.rateWindowCount + 1 : 1
    };
}

module.exports = { validateBatch, mergeSession };
