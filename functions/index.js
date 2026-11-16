const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getAppCheck } = require('firebase-admin/app-check');
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { validateBatch, mergeSession } = require('./analyticsValidation');
const { analyticsDashboardHandler } = require('./analyticsDashboard');

initializeApp();

// Permit attestation-free requests only when both Functions and loopback Firestore emulators run.
function usingLocalEmulators() {
    return process.env.FUNCTIONS_EMULATOR === 'true'
        && /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '');
}

// Restrict browser origins independently of App Check; custom domains belong in the environment.
function getAllowedOrigins() {
    if (usingLocalEmulators()) {
        return ['http://127.0.0.1:5050', 'http://localhost:5050'];
    }
    return (process.env.ANALYTICS_ALLOWED_ORIGINS
        || 'https://demir-personal-website.web.app,https://demir-personal-website.firebaseapp.com')
        .split(',').map(origin => origin.trim()).filter(Boolean);
}

// Verify attestation for the specific web app rather than trusting a client-provided flag.
async function verifyAppCheck(request) {
    if (usingLocalEmulators()) {
        return;
    }
    const token = request.get('X-Firebase-AppCheck');
    if (!token || token.length > 4096) {
        throw new Error('Missing App Check token.');
    }
    const result = await getAppCheck().verifyToken(token);
    const expectedAppId = process.env.ANALYTICS_APP_ID || '1:104633469125:web:d356f795162b7536f4c8ac';
    if (result.appId !== expectedAppId) {
        throw new Error('Wrong Firebase app.');
    }
}

// Commit a batch and its summary atomically so concurrent retries are harmless.
async function storeBatch(batch) {
    const db = getFirestore();
    const batchRef = db.collection('analyticsBatches').doc(batch.batchId);
    const sessionRef = db.collection('analyticsSessions').doc(batch.session.sessionId);
    return db.runTransaction(async transaction => {
        const existingBatch = await transaction.get(batchRef);
        if (existingBatch.exists) {
            return { duplicate: true };
        }
        const existingSession = await transaction.get(sessionRef);
        const previous = existingSession.exists ? existingSession.data() : null;
        const now = Date.now();
        if (previous && (previous.batchCount >= 1000
            || (now - previous.rateWindowStartedAt < 60000 && previous.rateWindowCount >= 20))) {
            const error = new Error('Session collection limit reached.');
            error.status = 429;
            throw error;
        }
        if (previous && previous.startedAt !== batch.session.startedAt) {
            const error = new Error('Session start time cannot change.');
            error.status = 400;
            throw error;
        }
        const summary = mergeSession(previous, batch.session, batch.events, now);
        const expiresAt = Timestamp.fromMillis(batch.session.startedAt + 30 * 24 * 60 * 60 * 1000);
        transaction.create(batchRef, {
            ...batch,
            sessionId: batch.session.sessionId,
            receivedAt: FieldValue.serverTimestamp(),
            expiresAt
        });
        transaction.set(sessionRef, { ...summary, updatedAt: FieldValue.serverTimestamp(), expiresAt });
        return { duplicate: false };
    });
}

// Accept only small validated writes; this endpoint never returns stored analytics.
async function collectAnalyticsHandler(request, response) {
    response.set('Cache-Control', 'no-store');
    if (!getAllowedOrigins().includes(request.get('Origin'))) {
        response.status(403).json({ error: 'Origin is not allowed.' });
        return;
    }
    if (request.method !== 'POST') {
        response.set('Allow', 'POST').status(405).json({ error: 'POST required.' });
        return;
    }
    if (!request.is('application/json')) {
        response.status(415).json({ error: 'JSON required.' });
        return;
    }
    const bodyBytes = request.rawBody?.length ?? Buffer.byteLength(JSON.stringify(request.body || {}));
    if (bodyBytes > 48000) {
        response.status(413).json({ error: 'Batch is too large.' });
        return;
    }
    try {
        await verifyAppCheck(request);
    } catch {
        logger.warn('analytics.rejected', { reason: 'appCheck' });
        response.status(401).json({ error: 'App Check verification required.' });
        return;
    }
    let batch;
    try {
        batch = validateBatch(request.body);
    } catch (error) {
        logger.warn('analytics.rejected', { reason: 'validation' });
        response.status(400).json({ error: error.message });
        return;
    }
    try {
        const result = await storeBatch(batch);
        logger.info('analytics.accepted', { eventCount: batch.events.length, duplicate: result.duplicate });
        response.status(200).json({ accepted: true, duplicate: result.duplicate });
    } catch (error) {
        const status = error.status || 500;
        logger.error('analytics.writeFailed', { status, code: error.code || 'unknown' });
        if (status === 429) {
            response.set('Retry-After', '60');
        }
        response.status(status).json({ error: status === 500 ? 'Collection temporarily unavailable.' : error.message });
    }
}

exports.collectAnalytics = onRequest({
    region: 'us-central1',
    maxInstances: 2,
    concurrency: 20,
    timeoutSeconds: 15,
    memory: '256MiB',
    invoker: 'public',
    cors: false
}, collectAnalyticsHandler);

exports.readAnalytics = onRequest({
    region: 'us-central1',
    maxInstances: 2,
    concurrency: 20,
    timeoutSeconds: 15,
    memory: '256MiB',
    invoker: 'public',
    cors: false
}, analyticsDashboardHandler);
