import { analyticsConfig } from './analyticsConfig.js?v=20261116-visit-log';
import { firebaseConfig } from './firebaseConfig.js?v=20261116-visit-log';

// Queue immutable batches in memory; retries reuse IDs and never expose database credentials.
export function createAnalyticsTransport(useEmulators) {
    const pageInstanceId = crypto.randomUUID();
    const queue = [];
    const status = { sentBatches: 0, pendingBatches: 0, droppedEvents: 0, lastError: null };
    let lastSequence = 0;
    let sending = false;
    let retryAt = 0;
    let appCheckPromise;
    let cachedToken;

    // Initialize attestation only for production collection, leaving local preview independent.
    async function getToken() {
        if (useEmulators) {
            return null;
        }
        if (!analyticsConfig.appCheckSiteKey) {
            throw new Error('Production collection requires an App Check site key.');
        }
        if (cachedToken && cachedToken.expireTimeMillis > Date.now() + 60000) {
            return cachedToken.token;
        }
        if (!appCheckPromise) {
            appCheckPromise = Promise.all([
                import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app-check.js')
            ]).then(([appSdk, appCheckSdk]) => {
                const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
                const appCheck = appCheckSdk.initializeAppCheck(app, {
                    provider: new appCheckSdk.ReCaptchaEnterpriseProvider(analyticsConfig.appCheckSiteKey),
                    isTokenAutoRefreshEnabled: true
                });
                return { appCheck, getToken: appCheckSdk.getToken };
            });
        }
        const appCheckSdk = await appCheckPromise;
        cachedToken = await appCheckSdk.getToken(appCheckSdk.appCheck);
        return cachedToken.token;
    }

    // Count discarded events without logging visitor data or full request bodies.
    function dropBatch(batch, reason) {
        status.droppedEvents += batch.events.length;
        status.lastError = reason;
        console.warn('[analytics collection]', reason);
    }

    // Upload one request at a time with bounded retries and keepalive for visibility transitions.
    async function flush() {
        if (sending || !queue.length || Date.now() < retryAt) {
            return;
        }
        sending = true;
        try {
            while (queue.length) {
                const item = queue[0];
                item.attempts += 1;
                try {
                    const token = await getToken();
                    const headers = { 'Content-Type': 'application/json' };
                    if (token) {
                        headers['X-Firebase-AppCheck'] = token;
                    }
                    const response = await fetch(analyticsConfig.endpoint, {
                        method: 'POST',
                        headers,
                        body: item.body,
                        credentials: 'omit',
                        keepalive: true,
                        signal: AbortSignal.timeout(10000)
                    });
                    if (!response.ok) {
                        if ([400, 403, 404, 405, 413, 415].includes(response.status)) {
                            dropBatch(item.batch, `Batch rejected (HTTP ${response.status}).`);
                            queue.shift();
                            continue;
                        }
                        if (response.status === 401) {
                            cachedToken = null;
                        }
                        throw new Error(`Upload failed (HTTP ${response.status}).`);
                    }
                    const result = await response.json();
                    if (result.accepted !== true) {
                        throw new Error('Collector returned an invalid response.');
                    }
                    queue.shift();
                    status.sentBatches += 1;
                    status.lastError = null;
                    retryAt = 0;
                } catch (error) {
                    status.lastError = error.message;
                    if (item.attempts >= analyticsConfig.maxAttempts) {
                        dropBatch(item.batch, 'Retry limit reached; batch discarded.');
                        queue.shift();
                    }
                    retryAt = Date.now() + Math.min(60000, 2000 * (2 ** item.attempts));
                    console.warn('[analytics collection] Upload deferred.', { reason: error.message });
                    break;
                }
            }
        } finally {
            sending = false;
            status.pendingBatches = queue.length;
        }
    }

    // Split newly observed events into small immutable requests with cumulative session totals.
    function captureSnapshot(snapshot) {
        const newEvents = snapshot.events.filter(event => event.sequence > lastSequence
            && event.sessionId === snapshot.session.sessionId);
        if (newEvents.length && newEvents[0].sequence > lastSequence + 1) {
            status.droppedEvents += newEvents[0].sequence - lastSequence - 1;
        }
        lastSequence = snapshot.events.at(-1)?.sequence || lastSequence;
        for (let offset = 0; offset < newEvents.length; offset += analyticsConfig.maxBatchEvents) {
            const batch = {
                schemaVersion: 1,
                batchId: crypto.randomUUID(),
                pageInstanceId,
                session: snapshot.session,
                events: newEvents.slice(offset, offset + analyticsConfig.maxBatchEvents)
            };
            const body = JSON.stringify(batch);
            if (new TextEncoder().encode(body).length > analyticsConfig.maxBatchBytes) {
                dropBatch(batch, 'Local batch size limit reached.');
                continue;
            }
            if (queue.length >= analyticsConfig.maxQueuedBatches) {
                // Preserve an in-flight batch so its completion cannot remove a different request.
                const discardIndex = sending ? 1 : 0;
                const discarded = queue.splice(discardIndex, 1)[0];
                dropBatch(discarded.batch, 'Local queue limit reached.');
            }
            queue.push({ batch, body, attempts: 0 });
        }
        status.pendingBatches = queue.length;
        void flush();
    }

    // Return copied operational counters for verification without exposing mutable queue state.
    function getStatus() {
        return { ...status };
    }

    return Object.freeze({ captureSnapshot, getStatus, flush });
}
