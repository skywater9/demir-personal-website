const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldPath, Timestamp } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const localOwnerUid = 'analyticsLocalOwner';

// Classify expected request failures without returning backend details or tokens.
function requestError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

// Permit the demo owner only when all required emulators use loopback addresses.
function getOwnerSettings(environment = process.env) {
    const loopbackHost = /^(127\.0\.0\.1|localhost):\d+$/;
    const local = environment.FUNCTIONS_EMULATOR === 'true'
        && loopbackHost.test(environment.FIRESTORE_EMULATOR_HOST || '')
        && loopbackHost.test(environment.FIREBASE_AUTH_EMULATOR_HOST || '')
        && environment.GCLOUD_PROJECT === 'demo-website-analytics';
    if (local) {
        return { uid: localOwnerUid, local: true };
    }
    if (environment.FIREBASE_AUTH_EMULATOR_HOST) {
        throw requestError(503, 'Dashboard authentication is not configured safely.');
    }
    const uid = environment.ANALYTICS_OWNER_UID?.trim();
    if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
        throw requestError(503, 'Dashboard owner has not been configured.');
    }
    return { uid, local: false };
}

// Reject unbounded requests and arbitrary document paths before querying Firestore.
function parseDashboardQuery(query) {
    const allowed = ['view', 'limit', 'cursor', 'sessionId', 'from', 'to', 'layoutVersion'];
    if (Object.keys(query).some(key => !allowed.includes(key))
        || Object.values(query).some(value => typeof value !== 'string')) {
        throw requestError(400, 'Invalid dashboard query.');
    }
    const view = query.view || 'sessions';
    const limit = query.limit === undefined ? 25 : Number(query.limit);
    if (!['sessions', 'timeline', 'heatmap'].includes(view) || !Number.isInteger(limit) || limit < 1 || limit > 25) {
        throw requestError(400, 'Invalid dashboard view or page size.');
    }
    for (const key of ['cursor', 'sessionId']) {
        if (query[key] !== undefined && !uuidPattern.test(query[key])) {
            throw requestError(400, `Invalid ${key}.`);
        }
    }
    if ((view === 'timeline' && !query.sessionId) || (view !== 'timeline' && query.sessionId)) {
        throw requestError(400, 'A session ID is required only for the timeline.');
    }
    if (view !== 'heatmap' && ['from', 'to', 'layoutVersion'].some(key => query[key] !== undefined)) {
        throw requestError(400, 'Date and layout filters apply only to heatmaps.');
    }
    const result = { view, limit, cursor: query.cursor || null, sessionId: query.sessionId || null };
    if (view === 'heatmap') {
        const startMs = parseHeatmapDate(query.from);
        const endMs = parseHeatmapDate(query.to) + 86400000;
        if (endMs <= startMs || endMs - startMs > 31 * 86400000
            || endMs > Math.floor(Date.now() / 86400000) * 86400000 + 86400000
            || !/^homepage-v[1-9][0-9]{0,3}$/.test(query.layoutVersion || '')) {
            throw requestError(400, 'Choose a valid layout and up to 31 days ending today or earlier.');
        }
        Object.assign(result, { from: query.from, to: query.to, startMs, endMs, layoutVersion: query.layoutVersion });
    }
    return result;
}

// Parse calendar dates strictly so invalid days cannot silently roll into another month.
function parseHeatmapDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw requestError(400, 'Heatmap dates must use YYYY-MM-DD.');
    }
    const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) {
        throw requestError(400, 'Invalid heatmap date.');
    }
    return milliseconds;
}

// Return display fields only, excluding ingestion limits and internal timestamps.
function summarizeSession(document) {
    const data = document.data();
    return {
        sessionId: document.id,
        startedAt: data.startedAt,
        lastActivityAt: data.lastActivityAt,
        lastEventAt: data.lastEventAt,
        durationMs: Math.max(0, (data.lastEventAt || data.lastActivityAt) - data.startedAt),
        visibleMs: data.visibleMs,
        engagedMs: data.engagedMs,
        eventCount: data.eventCount,
        lastPagePath: data.lastPagePath,
        lastMeaningfulAction: data.lastMeaningfulAction,
        sectionVisibleMs: data.sectionVisibleMs || {}
    };
}

// Page through recent sessions using the document as a stable cursor for equal start times.
async function readSessions(db, query) {
    let reference = db.collection('analyticsSessions')
        .orderBy('startedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (query.cursor) {
        const cursor = await db.collection('analyticsSessions').doc(query.cursor).get();
        if (!cursor.exists) {
            throw requestError(400, 'Session cursor no longer exists. Refresh the list.');
        }
        reference = reference.startAfter(cursor);
    }
    const result = await reference.limit(query.limit + 1).get();
    const documents = result.docs.slice(0, query.limit);
    return {
        sessions: documents.map(summarizeSession),
        nextCursor: result.size > query.limit ? documents.at(-1).id : null
    };
}

// Read bounded batch pages and order their events by recorded time, then page and sequence.
async function readTimeline(db, query) {
    const sessionDocument = await db.collection('analyticsSessions').doc(query.sessionId).get();
    if (!sessionDocument.exists) {
        throw requestError(404, 'Session no longer exists.');
    }
    let reference = db.collection('analyticsBatches').where('sessionId', '==', query.sessionId)
        .orderBy('receivedAt', 'asc').orderBy(FieldPath.documentId(), 'asc');
    if (query.cursor) {
        const cursor = await db.collection('analyticsBatches').doc(query.cursor).get();
        if (!cursor.exists || cursor.data().sessionId !== query.sessionId) {
            throw requestError(400, 'Invalid timeline cursor. Refresh the session.');
        }
        reference = reference.startAfter(cursor);
    }
    const result = await reference.limit(query.limit + 1).get();
    const documents = result.docs.slice(0, query.limit);
    const events = documents.flatMap(document => {
        const batch = document.data();
        return batch.events.map(event => ({
            ...event,
            eventId: `${document.id}:${event.sequence}`,
            pageInstanceId: batch.pageInstanceId
        }));
    });
    events.sort((first, second) => first.recordedAt - second.recordedAt
        || first.pageInstanceId.localeCompare(second.pageInstanceId) || first.sequence - second.sequence);
    return {
        session: summarizeSession(sessionDocument),
        events,
        nextCursor: result.size > query.limit ? documents.at(-1).id : null
    };
}

// Return only homepage pointer coordinates, keeping other layouts and actions out of the map.
function extractHeatmapClicks(documents, layoutVersion) {
    const clicks = [];
    for (const document of documents) {
        const batch = document.data();
        for (const event of batch.events || []) {
            if (event.eventName !== 'click' || event.layoutVersion !== layoutVersion
                || !['/', '/index.html'].includes(event.pagePath)) continue;
            const properties = event.properties;
            if (!properties || !['documentX', 'documentY', 'viewportWidth', 'viewportHeight', 'pageWidth', 'pageHeight']
                .every(key => Number.isFinite(properties[key]))) continue;
            clicks.push({
                eventId: `${document.id}:${event.sequence}`,
                layoutVersion: event.layoutVersion,
                documentX: properties.documentX,
                documentY: properties.documentY,
                viewportWidth: properties.viewportWidth,
                viewportHeight: properties.viewportHeight,
                pageWidth: properties.pageWidth,
                pageHeight: properties.pageHeight,
                elementId: properties.elementId,
                sectionId: properties.sectionId
            });
        }
    }
    return clicks;
}

// Scan bounded upload-date pages; clients must load remaining pages before claiming completeness.
async function readHeatmap(db, query) {
    let reference = db.collection('analyticsBatches')
        .where('receivedAt', '>=', Timestamp.fromMillis(query.startMs))
        .where('receivedAt', '<', Timestamp.fromMillis(query.endMs))
        .orderBy('receivedAt', 'asc').orderBy(FieldPath.documentId(), 'asc');
    if (query.cursor) {
        const cursor = await db.collection('analyticsBatches').doc(query.cursor).get();
        const receivedAt = cursor.exists ? cursor.data().receivedAt?.toMillis() : null;
        if (!Number.isFinite(receivedAt) || receivedAt < query.startMs || receivedAt >= query.endMs) {
            throw requestError(400, 'Heatmap cursor is outside this date range. Reload the heatmap.');
        }
        reference = reference.startAfter(cursor);
    }
    const result = await reference.limit(query.limit + 1).get();
    const documents = result.docs.slice(0, query.limit);
    return {
        clicks: extractHeatmapClicks(documents, query.layoutVersion),
        scannedBatches: documents.length,
        nextCursor: result.size > query.limit ? documents.at(-1).id : null
    };
}

// Authorize every read on the server; public HTML visibility never grants data access.
async function analyticsDashboardHandler(request, response) {
    response.set('Cache-Control', 'private, no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET') {
        response.set('Allow', 'GET').status(405).json({ error: 'GET required.' });
        return;
    }
    const authorization = request.get('Authorization');
    const token = /^Bearer ([^\s]{1,8192})$/.exec(authorization || '')?.[1];
    if (!token) {
        response.status(401).json({ error: 'Sign in to view analytics.' });
        return;
    }
    let owner;
    try {
        owner = getOwnerSettings();
    } catch (error) {
        response.status(error.status).json({ error: error.message });
        return;
    }
    let identity;
    try {
        identity = await getAuth().verifyIdToken(token, true);
    } catch {
        response.status(401).json({ error: 'Your sign-in has expired or is invalid. Sign in again.' });
        return;
    }
    if (identity.uid !== owner.uid || (!owner.local
        && (identity.firebase?.sign_in_provider !== 'google.com' || identity.email_verified !== true))) {
        logger.warn('analytics.dashboardDenied', { reason: 'notOwner' });
        response.status(403).json({ error: 'This account does not have access to analytics.' });
        return;
    }
    try {
        const query = parseDashboardQuery(request.query);
        const db = getFirestore();
        const readers = { sessions: readSessions, timeline: readTimeline, heatmap: readHeatmap };
        const result = await readers[query.view](db, query);
        logger.info('analytics.dashboardRead', { view: query.view, pageSize: query.limit });
        response.status(200).json(result);
    } catch (error) {
        const status = error.status || 500;
        if (status === 500) {
            logger.error('analytics.dashboardReadFailed', { code: error.code || 'unknown' });
        }
        response.status(status).json({ error: status === 500
            ? 'Analytics could not be loaded. Check the backend configuration and indexes.' : error.message });
    }
}

module.exports = { analyticsDashboardHandler, getOwnerSettings, parseDashboardQuery, summarizeSession, extractHeatmapClicks };
