const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, webcrypto } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { validateBatch, mergeSession } = require('./analyticsValidation');

// Build a real-shaped batch so rejection tests exercise the boundary used by the endpoint.
function makeBatch(now = Date.now()) {
    const sessionId = randomUUID();
    return {
        schemaVersion: 1,
        batchId: randomUUID(),
        pageInstanceId: randomUUID(),
        session: {
            sessionId, startedAt: now - 10000, lastActivityAt: now - 1000,
            visibleMs: 9000, engagedMs: 8000,
            sectionVisibleMs: { header: 8000 }, lastMeaningfulAction: null
        },
        events: [{
            eventName: 'pageView', sequence: 1, sessionId, pagePath: '/',
            layoutVersion: 'homepage-v1', recordedAt: now - 10000, elapsedMs: 0, properties: {}
        }]
    };
}

test('validation accepts planned data and rejects sensitive, malformed, and oversized event structures', () => {
    const now = Date.now();
    assert.doesNotThrow(() => validateBatch(makeBatch(now), now));
    const changes = [
        batch => { batch.session.email = 'private@example.com'; },
        batch => { batch.events[0].properties.text = 'unplanned page contents'; },
        batch => { batch.events[0].pagePath = '/?email=private@example.com'; },
        batch => { batch.session.engagedMs = batch.session.visibleMs + 1; },
        batch => { batch.session.sectionVisibleMs.header = -1; },
        batch => { batch.events[0].sessionId = randomUUID(); },
        batch => { batch.events[0].eventName = 'keystroke'; },
        batch => { batch.events[0].elapsedMs = 10000; },
        batch => { batch.session.visibleMs = Infinity; },
        batch => { batch.events = Array(41).fill(batch.events[0]); },
        batch => { batch.batchId = '../../otherDocument'; }
    ];
    for (const change of changes) {
        const batch = makeBatch(now);
        change(batch);
        assert.throws(() => validateBatch(batch, now));
    }
});

test('heatmap validation rejects positions outside the page and unknown controls', () => {
    const batch = makeBatch();
    const event = batch.events[0];
    event.eventName = 'click';
    event.properties = {
        elementId: 'counterReset', sectionId: 'clickCounter', documentX: 10, documentY: 20,
        viewportWidth: 1000, viewportHeight: 500, pageWidth: 1000, pageHeight: 2000,
        relativeX: 0.2, relativeY: 0.4
    };
    assert.doesNotThrow(() => validateBatch(batch));
    event.properties.relativeX = 1.1;
    assert.throws(() => validateBatch(batch));
    event.properties.relativeX = 0.2;
    event.properties.documentY = 2001;
    assert.throws(() => validateBatch(batch));
    event.properties.documentY = 20;
    event.properties.elementId = 'unplannedControl';
    assert.throws(() => validateBatch(batch));
});

test('out-of-order summaries preserve maxima without adding cumulative timing twice', () => {
    const batch = makeBatch();
    const first = mergeSession(null, batch.session, batch.events, Date.now());
    const older = { ...batch.session, visibleMs: 1000, engagedMs: 500, sectionVisibleMs: { header: 500 } };
    const merged = mergeSession(first, older, batch.events, Date.now());
    assert.equal(merged.visibleMs, first.visibleMs);
    assert.equal(merged.engagedMs, first.engagedMs);
    assert.equal(merged.sectionVisibleMs.header, first.sectionVisibleMs.header);
    assert.equal(merged.eventCount, 2);
    assert.throws(() => mergeSession(first, { ...older, startedAt: older.startedAt + 1 }, batch.events, Date.now()));
});

// Load the actual browser modules in a controlled clock/DOM without contacting Firebase.
async function createBrowserHarness({ search = '', port = '5050', blockStorage = false, responses = [] } = {}) {
    let elapsed = 0;
    const wallStart = Date.now();
    const handlers = {};
    const requests = [];
    const timers = [];
    const storage = new Map();
    const window = {
        location: { search, pathname: '/', hostname: '127.0.0.1', port },
        innerWidth: 1000, innerHeight: 500, scrollX: 0, scrollY: 0,
        addEventListener(name, handler) { handlers[name] = handler; },
        setInterval(handler) { timers.push(handler); }
    };
    const document = {
        visibilityState: 'visible', documentElement: { scrollWidth: 1000, scrollHeight: 2000 },
        addEventListener(name, handler) { handlers[name] = handler; },
        querySelectorAll() { return []; }
    };
    class Element {}
    const context = vm.createContext({
        window, document, URLSearchParams, TextEncoder, AbortSignal, Element,
        crypto: webcrypto, performance: { now: () => elapsed }, Date: { now: () => wallStart + elapsed },
        console: { debug() {}, info() {}, warn() {} },
        sessionStorage: {
            getItem(key) { if (blockStorage) throw Error('blocked'); return storage.get(key) || null; },
            setItem(key, value) { if (blockStorage) throw Error('blocked'); storage.set(key, value); }
        },
        IntersectionObserver: class { observe() {} },
        async fetch(url, options) {
            requests.push({ url, ...options });
            const responseCode = responses.shift() || 200;
            return { ok: responseCode === 200, status: responseCode, async json() { return { accepted: true }; } };
        }
    });
    const modules = new Map();

    // Resolve only local tracker modules; a test cannot accidentally import a remote SDK.
    async function loadModule(filename) {
        if (modules.has(filename)) return modules.get(filename);
        const source = await readFile(filename, 'utf8');
        const module = new vm.SourceTextModule(source, { context, identifier: filename });
        modules.set(filename, module);
        await module.link((specifier, referencing) => {
            assert.ok(specifier.startsWith('./'), 'Remote SDK imports are not allowed in this harness.');
            return loadModule(path.resolve(path.dirname(referencing.identifier), specifier));
        });
        return module;
    }

    const tracker = await loadModule(path.resolve(__dirname, '../public/scripts/analytics.js'));
    await tracker.evaluate();
    // Allow queued promise continuations to finish without real-time waits.
    async function settle() {
        for (let index = 0; index < 20; index++) await Promise.resolve();
    }
    await settle();
    return {
        window, document, handlers, requests, timers, Element, settle,
        now() { return wallStart + elapsed; },
        advance(ms) { elapsed += ms; },
        snapshot() { return window.websiteAnalytics.getSnapshot(); }
    };
}

test('debug remains local, defaults stay disabled, and foreground/engaged timing excludes hidden time', async () => {
    const disabled = await createBrowserHarness();
    assert.equal(disabled.window.websiteAnalytics, undefined);
    const preview = await createBrowserHarness({ search: '?analyticsDebug=1&analyticsCollect=1', blockStorage: true });
    preview.advance(70000);
    assert.equal(preview.snapshot().session.visibleMs, 70000);
    assert.equal(preview.snapshot().session.engagedMs, 60000);
    preview.document.visibilityState = 'hidden';
    preview.handlers.visibilitychange();
    preview.advance(20000);
    assert.equal(preview.snapshot().session.visibleMs, 70000);
    assert.equal(preview.requests.length, 0);
    assert.equal(preview.snapshot().mode, 'localDebug');
    const nonEmulator = await createBrowserHarness({ search: '?analyticsCollect=1', port: '8000' });
    assert.equal(nonEmulator.window.websiteAnalytics, undefined);
});

test('collection sends server-valid batches and retries the identical payload after failure', async () => {
    const harness = await createBrowserHarness({ search: '?analyticsCollect=1', responses: [503, 200] });
    assert.equal(harness.requests.length, 1);
    const firstBody = harness.requests[0].body;
    assert.doesNotThrow(() => validateBatch(JSON.parse(firstBody)));
    harness.advance(15000);
    harness.timers[0]();
    await harness.settle();
    assert.equal(harness.requests[1].body, firstBody);
    for (const request of harness.requests) {
        assert.doesNotThrow(() => validateBatch(JSON.parse(request.body)));
        assert.equal(request.keepalive, true);
    }
    assert.equal(harness.snapshot().collection.pendingBatches, 0);
    assert.ok(harness.snapshot().collection.sentBatches >= 2);
});

test('keyboard activation has no heatmap coordinate and timeout batches stay assigned to their session', async () => {
    const harness = await createBrowserHarness({ search: '?analyticsCollect=1' });
    const target = new harness.Element();
    target.dataset = { analyticsId: 'counterReset', analyticsSection: 'clickCounter' };
    target.closest = () => target;
    target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
    const firstSessionId = harness.snapshot().session.sessionId;
    harness.handlers.click({ target, detail: 0 });
    harness.advance(31 * 60 * 1000);
    harness.handlers.keydown();
    harness.timers[0]();
    await harness.settle();
    assert.notEqual(harness.snapshot().session.sessionId, firstSessionId);
    const batches = harness.requests.map(request => JSON.parse(request.body));
    for (const batch of batches) assert.doesNotThrow(() => validateBatch(batch, harness.now()));
    const events = batches.flatMap(batch => batch.events);
    assert.ok(events.some(event => event.eventName === 'interaction'));
    assert.equal(events.some(event => event.eventName === 'click'), false);
    assert.ok(batches.some(batch => batch.session.sessionId !== firstSessionId));
});

test('production refuses missing App Check even when a request claims emulator mode', async () => {
    const { collectAnalytics } = require('./index');
    const request = {
        method: 'POST', headers: {}, body: { emulator: true }, rawBody: Buffer.from('{}'),
        get(name) { return name === 'Origin' ? 'https://demir-personal-website.web.app' : undefined; },
        is(contentType) { return contentType === 'application/json'; }
    };
    const response = {
        statusCode: 0, body: null,
        on() {}, set() { return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
    const savedFunctionsEmulator = process.env.FUNCTIONS_EMULATOR;
    const savedFirestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
    try {
        process.env.FUNCTIONS_EMULATOR = 'true';
        process.env.FIRESTORE_EMULATOR_HOST = 'remote.example:8080';
        await collectAnalytics(request, response);
        assert.equal(response.statusCode, 401);
        assert.match(response.body.error, /App Check/);
    } finally {
        if (savedFunctionsEmulator === undefined) delete process.env.FUNCTIONS_EMULATOR;
        else process.env.FUNCTIONS_EMULATOR = savedFunctionsEmulator;
        if (savedFirestoreHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
        else process.env.FIRESTORE_EMULATOR_HOST = savedFirestoreHost;
    }
});

test('emulators: atomic deduplication, validation, and denied public reads/writes', {
    skip: !process.env.FIRESTORE_EMULATOR_HOST
}, async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
    const projectId = 'demo-website-analytics';
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const app = initializeApp({ projectId }, 'analyticsTests');
    const db = getFirestore(app);
    const batch = makeBatch();
    const endpoint = 'http://127.0.0.1:5050/api/events';
    const options = {
        method: 'POST', headers: { Origin: 'http://127.0.0.1:5050', 'Content-Type': 'application/json' },
        body: JSON.stringify(batch)
    };
    const results = await Promise.all([fetch(endpoint, options), fetch(endpoint, options)]);
    for (const result of results) assert.equal(result.status, 200, await result.text());
    const summary = (await db.collection('analyticsSessions').doc(batch.session.sessionId).get()).data();
    assert.equal(summary.batchCount, 1);
    assert.equal(summary.eventCount, 1);
    assert.equal(summary.visibleMs, 9000);
    assert.ok(summary.expiresAt.toMillis() > Date.now());
    assert.equal((await db.collection('analyticsBatches').doc(batch.batchId).get()).exists, true);

    const invalid = { ...batch, batchId: randomUUID(), email: 'unplanned@example.com' };
    assert.equal((await fetch(endpoint, { ...options, body: JSON.stringify(invalid) })).status, 400);
    assert.equal((await fetch(endpoint, { ...options, headers: { ...options.headers, Origin: 'https://other.example' } })).status, 403);
    assert.equal((await fetch(endpoint, { headers: { Origin: 'http://127.0.0.1:5050' } })).status, 405);
    assert.equal((await fetch(endpoint, { ...options, body: JSON.stringify({ extra: 'x'.repeat(49000) }) })).status, 413);

    const documentUrl = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/analyticsSessions/${batch.session.sessionId}`;
    assert.equal((await fetch(documentUrl)).status, 403);
    assert.equal((await fetch(documentUrl, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: {} })
    })).status, 403);
    const batchUrl = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/analyticsBatches/${batch.batchId}`;
    assert.equal((await fetch(batchUrl)).status, 403);
    assert.equal((await fetch(batchUrl, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: {} })
    })).status, 403);
    await db.collection('analyticsSessions').doc(batch.session.sessionId).update({
        rateWindowStartedAt: Date.now(), rateWindowCount: 20
    });
    const throttledBatch = { ...batch, batchId: randomUUID() };
    const throttled = await fetch(endpoint, { ...options, body: JSON.stringify(throttledBatch) });
    assert.equal(throttled.status, 429);
    assert.equal(throttled.headers.get('Retry-After'), '60');
    await deleteApp(app);
});
