const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, webcrypto } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { validateBatch, mergeSession } = require('./analyticsValidation');
const gameElementIds = [
    'gameStart', 'gameContinue', 'gameNewRun', 'gameConfirmNewRun', 'gameCancelNewRun',
    'gameMenu', 'gameRetry', 'gameHistory', 'gameHistoryBack', 'gameDock',
    'gameThrottleUp', 'gameThrottleDown', 'gameRotateLeft', 'gameRotateRight',
    'gameRcsUp', 'gameRcsDown', 'gameRcsLeft', 'gameRcsRight', 'gameResume', 'gameBurn', 'gameThrottle'
];
const gameSectionIds = ['game', 'menu', 'cockpit', 'history', 'results'];

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
            layoutVersion: 'homepage-v3', recordedAt: now - 10000, elapsedMs: 0, properties: {}
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

test('v3 accepts every planned game control and section while retaining v1 identifiers', () => {
    const now = Date.now();
    for (const elementId of [...gameElementIds, 'headerClick', 'counterIncrement', 'counterReset']) {
        for (const sectionId of [...gameSectionIds, 'header', 'clickCounter', 'visitCounter', null]) {
            const batch = makeBatch(now);
            batch.session.lastMeaningfulAction = { elementId, recordedAt: batch.session.lastActivityAt };
            batch.events[0].eventName = 'interaction';
            batch.events[0].properties = { elementId, sectionId, inputType: 'pointer' };
            assert.doesNotThrow(() => validateBatch(batch, now), `${elementId} / ${sectionId}`);
            batch.events[0].eventName = 'click';
            batch.events[0].properties = {
                elementId, sectionId, documentX: 0, documentY: 500,
                viewportWidth: 1000, viewportHeight: 500, pageWidth: 1000, pageHeight: 500,
                relativeX: 0, relativeY: 1
            };
            assert.doesNotThrow(() => validateBatch(batch, now));
        }
    }
    for (const sectionId of [...gameSectionIds, 'header', 'clickCounter', 'visitCounter']) {
        const batch = makeBatch(now);
        batch.session.sectionVisibleMs[sectionId] = 1000;
        batch.events[0].eventName = 'sectionView';
        batch.events[0].properties = { sectionId };
        assert.doesNotThrow(() => validateBatch(batch, now));
    }
    const historical = makeBatch(now);
    historical.events[0].layoutVersion = 'homepage-v1';
    historical.events[0].eventName = 'interaction';
    historical.events[0].properties = { elementId: 'counterReset', sectionId: 'clickCounter', inputType: 'keyboard' };
    assert.doesNotThrow(() => validateBatch(historical, now));
    historical.events[0].layoutVersion = 'homepage-v2';
    assert.doesNotThrow(() => validateBatch(historical, now));
});

test('game adaptation still rejects unknown layouts, IDs, lifecycle payloads, and personal data', () => {
    const now = Date.now();
    const changes = [
        batch => { batch.events[0].layoutVersion = 'homepage-v4'; },
        batch => { batch.events[0].layoutVersion = 'homepage-v3?player=secret'; },
        batch => { batch.events[0].properties.elementId = 'gameUnknown'; },
        batch => { batch.events[0].properties.sectionId = 'unknown'; },
        batch => { batch.events[0].properties.inputType = 'touch'; },
        batch => { batch.events[0].properties.score = 10; },
        batch => { batch.events[0].properties.playerName = 'private'; },
        batch => { batch.session.sectionVisibleMs.unknown = 100; },
        batch => { batch.session.sectionVisibleMs.cockpit = batch.session.visibleMs + 1; },
        batch => { batch.session.lastMeaningfulAction = { elementId: 'gameUnknown', recordedAt: now - 1000 }; },
        batch => { batch.events[0].eventName = 'gameRunComplete'; },
        batch => { batch.events[0].properties = { elementId: 'gameStart', sectionId: 'menu' }; }
    ];
    for (const change of changes) {
        const batch = makeBatch(now);
        batch.events[0].eventName = 'interaction';
        batch.events[0].properties = { elementId: 'gameStart', sectionId: 'menu', inputType: 'pointer' };
        change(batch);
        assert.throws(() => validateBatch(batch, now));
    }
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
async function createBrowserHarness({ search = '', port = '5050', blockStorage = false,
    responses = [], savedSession = null } = {}) {
    let elapsed = 0;
    const wallStart = Date.now();
    const handlers = {};
    const requests = [];
    const timers = [];
    const storage = new Map();
    if (savedSession) storage.set('websiteAnalyticsDebugSession', JSON.stringify(savedSession));
    const lifecycleTarget = new EventTarget();
    const window = {
        CustomEvent,
        dispatchEvent: event => lifecycleTarget.dispatchEvent(event),
        location: { search, pathname: '/', hostname: '127.0.0.1', port },
        innerWidth: 1000, innerHeight: 500, scrollX: 0, scrollY: 0,
        addEventListener(name, handler) {
            handlers[name] = handler;
            lifecycleTarget.addEventListener(name, handler);
        },
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
        IntersectionObserver: class {
            // Expose section changes so tests can model HUD/menu visibility transitions.
            constructor(handler) { handlers.sections = handler; }
            // No real layout is needed to feed deterministic section entries.
            observe() {}
        },
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
            return loadModule(path.resolve(path.dirname(referencing.identifier), specifier.split('?')[0]));
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
        snapshot() { return JSON.parse(JSON.stringify(window.websiteAnalytics.getSnapshot())); }
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

test('v3 game interactions, canvas clicks, and section exposure produce server-valid batches', async () => {
    const harness = await createBrowserHarness({ search: '?analyticsCollect=1' });
    for (const [index, elementId] of gameElementIds.entries()) {
        const sectionId = gameSectionIds[index % gameSectionIds.length];
        const target = new harness.Element();
        target.dataset = { analyticsId: elementId, analyticsSection: sectionId };
        target.closest = () => target;
        target.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 100 });
        harness.handlers.click({ target, detail: index % 2, clientX: 30, clientY: 40 });
    }
    const canvas = new harness.Element();
    canvas.closest = () => null;
    harness.handlers.click({ target: canvas, detail: 1, clientX: 250, clientY: 100 });
    const entries = [...gameSectionIds, 'unplanned'].map(sectionId => ({
        target: { dataset: { analyticsSection: sectionId } }, intersectionRatio: 1
    }));
    harness.handlers.sections(entries);
    harness.advance(1000);
    harness.handlers.sections(entries.map(entry => ({ ...entry, intersectionRatio: 0 })));
    harness.timers[0]();
    await harness.settle();
    const snapshot = harness.snapshot();
    assert.equal(snapshot.config.layoutVersion, 'homepage-v3');
    const interactions = snapshot.events.filter(event => event.eventName === 'interaction');
    assert.deepEqual(interactions.map(event => event.properties.elementId), gameElementIds);
    assert.equal(snapshot.events.filter(event => event.eventName === 'click').length, Math.floor(gameElementIds.length / 2) + 1);
    assert.ok(snapshot.events.some(event => event.eventName === 'click' && event.properties.elementId === null));
    for (const sectionId of gameSectionIds) assert.equal(snapshot.session.sectionVisibleMs[sectionId], 1000);
    assert.equal('unplanned' in snapshot.session.sectionVisibleMs, false);
    for (const request of harness.requests) assert.doesNotThrow(() => validateBatch(JSON.parse(request.body), harness.now()));
    assert.ok(harness.requests.length >= 2);
});

test('split cockpit sections remain visible while either instrument or control panel is exposed', async () => {
    const harness = await createBrowserHarness({ search: '?analyticsDebug=1' });
    const instruments = { dataset: { analyticsSection: 'cockpit' } };
    const controls = { dataset: { analyticsSection: 'cockpit' } };
    harness.handlers.sections([{ target: instruments, intersectionRatio: 1 }, { target: controls, intersectionRatio: 0 }]);
    harness.advance(1000);
    harness.handlers.sections([{ target: instruments, intersectionRatio: 0 }, { target: controls, intersectionRatio: 1 }]);
    harness.advance(1000);
    harness.handlers.sections([{ target: controls, intersectionRatio: 0 }]);
    harness.advance(1000);
    assert.equal(harness.snapshot().session.sectionVisibleMs.cockpit, 2000);
    assert.equal(harness.snapshot().events.filter(event => event.eventName === 'sectionView' && event.properties.sectionId === 'cockpit').length, 1);
});

test('held controls record a press without a click and do not duplicate a later pointer click', async () => {
    const heldControlIds = [
        'gameBurn', 'gameThrottle', 'gameThrottleUp', 'gameThrottleDown',
        'gameRotateLeft', 'gameRotateRight', 'gameRcsUp', 'gameRcsDown', 'gameRcsLeft', 'gameRcsRight'
    ];
    for (const elementId of heldControlIds) {
        const harness = await createBrowserHarness({ search: '?analyticsCollect=1' });
        const target = new harness.Element();
        target.dataset = { analyticsId: elementId, analyticsSection: 'cockpit' };
        target.value = '75';
        target.closest = () => target;
        target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
        harness.handlers.pointerdown({ target, button: 0, clientX: 25, clientY: 25 });
        const pressed = harness.snapshot();
        assert.equal(pressed.events.filter(event => event.eventName === 'interaction').length, 1, elementId);
        assert.equal(pressed.session.lastMeaningfulAction.elementId, elementId);
        harness.timers[0]();
        await harness.settle();
        for (const request of harness.requests) assert.doesNotThrow(() => validateBatch(JSON.parse(request.body), harness.now()));
        harness.handlers.click({ target, detail: 1, clientX: 25, clientY: 25 });
        assert.equal(harness.snapshot().events.filter(event => event.eventName === 'interaction').length, 1);
        assert.equal(harness.snapshot().events.filter(event => event.eventName === 'click').length, 1);
        harness.handlers.click({ target, detail: 0 });
        assert.equal(harness.snapshot().events.filter(event => event.eventName === 'interaction').length, 2);
        assert.equal(harness.snapshot().events.filter(event => event.eventName === 'click').length, 1);
        harness.handlers.pointerdown({ target, button: 2, clientX: 25, clientY: 25 });
        assert.equal(harness.snapshot().events.filter(event => event.eventName === 'interaction').length, 2);
        // Only the named press is collected, including when the target is the range input.
        assert.deepEqual(harness.snapshot().events.find(event => event.eventName === 'interaction').properties,
            { elementId, sectionId: 'cockpit', inputType: 'pointer' });
    }
});

test('unknown DOM metadata cannot poison a batch or its restored session summary', async () => {
    const harness = await createBrowserHarness({ search: '?analyticsCollect=1' });
    const target = new harness.Element();
    target.dataset = { analyticsId: 'privateIdentifier', analyticsSection: 'privateSection' };
    target.closest = () => target;
    target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
    harness.handlers.click({ target, detail: 1, clientX: 10, clientY: 20 });
    harness.timers[0]();
    await harness.settle();
    const snapshot = harness.snapshot();
    assert.equal(snapshot.session.lastMeaningfulAction, null);
    const click = snapshot.events.find(event => event.eventName === 'click');
    assert.equal(click.properties.elementId, null);
    assert.equal(click.properties.sectionId, null);
    for (const request of harness.requests) assert.doesNotThrow(() => validateBatch(JSON.parse(request.body), harness.now()));
    const savedSession = { ...snapshot.session, sectionVisibleMs: { privateSection: 1 } };
    const restored = await createBrowserHarness({ search: '?analyticsDebug=1', savedSession });
    assert.notEqual(restored.snapshot().session.sessionId, savedSession.sessionId);
    assert.deepEqual(restored.snapshot().session.sectionVisibleMs, {});
});

test('legacy site analytics preserves visit counts without the old DOM or a working Google Analytics SDK', async () => {
    const source = await readFile(path.resolve(__dirname, '../public/scripts/siteAnalytics.js'), 'utf8');
    for (const scenario of [
        { emulator: true, blockStorage: false, hasCounter: false, failAnalytics: false },
        { emulator: false, blockStorage: true, hasCounter: true, failAnalytics: true },
        { emulator: false, blockStorage: false, hasCounter: true, failAnalytics: false }
    ]) {
        const stored = new Map([['pageViewsCount', '2']]);
        const writes = [];
        const emulatorConnections = [];
        const counter = { textContent: '' };
        let initializedConfig;
        let analyticsImports = 0;
        let analyticsStarts = 0;
        const context = vm.createContext({
            window: { location: { hostname: 'example.com' }, addEventListener() {} },
            document: { getElementById: () => scenario.hasCounter ? counter : null },
            console: { warn() {} },
            localStorage: {
                // Simulate privacy settings without preventing the shared visit transaction.
                getItem(key) { if (scenario.blockStorage) throw Error('blocked'); return stored.get(key); },
                // Retain the legacy key to ensure existing local counts survive the migration.
                setItem(key, value) { stored.set(key, value); }
            }
        });
        const appExports = {
            getApps: () => [], getApp: () => { throw Error('No app exists.'); },
            initializeApp: config => { initializedConfig = config; return config; }
        };
        const firestoreExports = {
            getFirestore: app => app,
            connectFirestoreEmulator: (...args) => emulatorConnections.push(args),
            doc: (db, collection, id) => ({ collection, id }),
            runTransaction: async (db, update) => update({
                get: async () => ({ exists: () => true, data: () => ({ count: 12 }) }),
                set: (reference, data, options) => writes.push({ reference, data, options })
            })
        };
        const configExports = {
            firebaseConfig: { projectId: 'production-project' }, useFirebaseEmulators: scenario.emulator
        };
        const analyticsExports = { isSupported: async () => true, getAnalytics: () => { analyticsStarts++; } };
        const modules = new Map();
        for (const [name, exports] of [
            ['firebase-app.js', appExports], ['firebase-firestore.js', firestoreExports],
            ['./firebaseConfig.js', configExports], ['firebase-analytics.js', analyticsExports]
        ]) {
            const module = new vm.SyntheticModule(Object.keys(exports), function () {
                for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
            }, { context });
            await module.link(() => { throw Error('Unexpected SDK dependency.'); });
            await module.evaluate();
            modules.set(name, module);
        }
        const tracker = new vm.SourceTextModule(source, {
            context,
            // Keep optional Google Analytics failures isolated from both visit counters.
            importModuleDynamically: async specifier => {
                assert.ok(specifier.endsWith('/firebase-analytics.js'));
                analyticsImports++;
                if (scenario.failAnalytics) throw Error('SDK unavailable');
                return modules.get('firebase-analytics.js');
            }
        });
        await tracker.link(specifier => modules.get(specifier.split('?')[0]) || modules.get(specifier.split('?')[0].split('/').at(-1)));
        await tracker.evaluate();
        for (let index = 0; index < 20; index++) await Promise.resolve();
        assert.equal(initializedConfig.projectId, scenario.emulator ? 'demo-website-analytics' : 'production-project');
        assert.equal(emulatorConnections.length, scenario.emulator ? 1 : 0);
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].reference, { collection: 'siteStats', id: 'visits' });
        assert.equal(writes[0].data.count, 13);
        assert.equal(writes[0].options.merge, true);
        assert.equal(stored.get('pageViewsCount'), scenario.blockStorage ? '2' : '3');
        assert.equal(counter.textContent, scenario.hasCounter ? 'Website visits: 13' : '');
        assert.equal(analyticsImports, scenario.emulator ? 0 : 1);
        assert.equal(analyticsStarts, !scenario.emulator && !scenario.failAnalytics ? 1 : 0);
    }
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


test('game lifecycle validation accepts each action and rejects extra data and unbounded numbers', () => {
    const properties = { action: 'started', runId: randomUUID(), routeIndex: 0,
        deliveries: 0, fuel: 100, gameplaySeconds: 0 };
    for (const action of ['started', 'continued', 'left', 'suspended', 'landed', 'delivered', 'won', 'lost', 'abandoned']) {
        const batch = makeBatch();
        Object.assign(batch.events[0], { eventName: 'gameLifecycle', properties: { ...properties, action } });
        assert.doesNotThrow(() => validateBatch(batch));
    }
    const invalid = [
        { action: 'unknown' }, { runId: 'player@example.com' }, { routeIndex: -1 }, { routeIndex: 10 },
        { routeIndex: 0.5 }, { deliveries: -1 }, { deliveries: 11 }, { deliveries: 0.5 },
        { fuel: -1 }, { fuel: 101 }, { fuel: NaN }, { fuel: Infinity },
        { gameplaySeconds: -1 }, { gameplaySeconds: 31536001 }, { gameplaySeconds: Infinity },
        { gameplaySeconds: NaN }, { documentX: 100 }, { playerName: 'private' }
    ];
    for (const change of invalid) {
        const batch = makeBatch();
        Object.assign(batch.events[0], { eventName: 'gameLifecycle', properties: { ...properties, ...change } });
        assert.throws(() => validateBatch(batch));
    }
    for (const field of Object.keys(properties)) {
        const batch = makeBatch();
        const incomplete = { ...properties };
        delete incomplete[field];
        Object.assign(batch.events[0], { eventName: 'gameLifecycle', properties: incomplete });
        assert.throws(() => validateBatch(batch));
    }
    const batch = makeBatch();
    Object.assign(batch.events[0], { eventName: 'gameLifecycle', properties: {
        ...properties, routeIndex: 9, deliveries: 10, fuel: 0, gameplaySeconds: 31536000
    } });
    assert.doesNotThrow(() => validateBatch(batch));
});

test('native gameplay events pass through the tracker without backfilling or leaking extra fields', async () => {
    const harness = await createBrowserHarness({ search: '?analyticsCollect=1' });
    const { FlightApp } = await import('../public/scripts/rocketApp.mjs');
    const { createRun } = await import('../public/scripts/rocketPhysics.mjs');
    const app = Object.create(FlightApp.prototype);
    app.browserWindow = harness.window;
    app.run = createRun();
    assert.equal(harness.snapshot().events.some(event => event.eventName === 'gameLifecycle'), false);
    for (const action of ['started', 'continued', 'left', 'suspended', 'landed', 'delivered', 'won', 'lost', 'abandoned']) {
        app.emitGameLifecycle(action);
    }
    const valid = harness.snapshot().events.filter(event => event.eventName === 'gameLifecycle');
    assert.equal(valid.length, 9);
    const properties = valid[0].properties;
    for (const change of [{ playerName: 'private' }, { fuel: Infinity }, { routeIndex: 10 }, { action: 'unknown' }]) {
        harness.window.dispatchEvent(new CustomEvent('rocket:gameLifecycle', { detail: { ...properties, ...change } }));
    }
    assert.equal(harness.snapshot().events.filter(event => event.eventName === 'gameLifecycle').length, 9);
    await harness.settle();
    for (const request of harness.requests) assert.doesNotThrow(() => validateBatch(JSON.parse(request.body)));
    app.browserWindow = {};
    assert.doesNotThrow(() => app.emitGameLifecycle('started'));
});

test('successful app transitions emit lifecycle actions once and rejected actions emit none', async () => {
    const harness = await createBrowserHarness({ search: '?analyticsDebug=1' });
    const { FlightApp } = await import('../public/scripts/rocketApp.mjs');
    const { createRun, dockingPoint, routeBody, tuning } = await import('../public/scripts/rocketPhysics.mjs');
    const app = Object.create(FlightApp.prototype);
    let active = null;
    let allowSave = true;
    let archives = 0;
    Object.assign(app, {
        browserWindow: harness.window, page: { visibilityState: 'visible' }, busy: false,
        store: {
            // Model ownership and successful persistence independently from analytics.
            transaction(action) { return action(); },
            getActive() { return active; },
            saveActive(run) { if (allowSave) active = run; return allowSave; },
            archive() { archives += 1; active = null; return true; },
            ownsActive(id) { return active?.id === id; }
        },
        // Keep this test focused on semantic transitions rather than rendering.
        showScreen(mode) { this.mode = mode; }, updateHud() {}, message() {}, clearInput() {},
        updateMenu() {}, renderResults() { this.mode = 'results'; }, ownershipLost() { this.mode = 'menu'; }
    });
    app.newRun();
    app.suspend('left');
    app.suspend('left');
    app.continueRun();
    app.suspend('suspended');
    app.continueRun();
    app.attach(); // An out-of-range attach must not report a delivery.
    app.newRun(); // Only the replaced run emits abandoned.
    const point = dockingPoint(routeBody(0));
    Object.assign(app.run, { x: point.x, y: point.y, vx: 0, vy: 0, angle: 0 });
    app.attach();
    app.run.status = 'lost';
    app.showResults();
    app.showResults();
    assert.equal(archives, 2);
    const actions = harness.snapshot().events.filter(event => event.eventName === 'gameLifecycle').map(event => event.properties.action);
    assert.deepEqual(actions, ['started', 'left', 'continued', 'suspended', 'continued', 'abandoned', 'started', 'delivered', 'lost']);
    active = null;
    allowSave = false;
    app.newRun();
    assert.equal(harness.snapshot().events.filter(event => event.eventName === 'gameLifecycle').length, actions.length);
    app.run = createRun();
    active = app.run;
    allowSave = true;
    const moon = routeBody(1);
    Object.assign(app.run, { phase: 'planet', delivered: 1, payload: false, fuel: 40,
        x: moon.x, y: moon.y - moon.radius - tuning.shipRadius + 0.01,
        vx: 0, vy: 1, angle: 0, landedOn: null });
    Object.assign(app, { mode: 'flight', lastFrame: 0, accumulator: 0, saveElapsed: 0,
        hudElapsed: 0, failureElapsed: 0, messageUntil: 1000, animating: false,
        renderer: { draw() {} }, currentInput() { return {}; }, text() {} });
    app.frame(20);
    app.frame(40);
    assert.equal(app.run.routeIndex, 1);
    assert.equal(harness.snapshot().events.filter(event => event.properties.action === 'landed').length, 1);
    app.run.fuel = 0;
    for (let now = 60; now < 200; now += 20) app.frame(now);
    assert.equal(harness.snapshot().events.filter(event => event.properties.action === 'lost').length, 2);
    app.run = createRun();
    active = app.run;
    Object.assign(app, { mode: 'flight', failedRunId: null });
    Object.assign(app.run, { routeIndex: 9, delivered: 9, ...dockingPoint(routeBody(9)),
        vx: 0, vy: 0, angle: 0, landedOn: null });
    app.attach();
    app.attach();
    const finalActions = harness.snapshot().events.filter(event => event.eventName === 'gameLifecycle').map(event => event.properties.action);
    assert.deepEqual(finalActions.slice(-2), ['delivered', 'won']);
    assert.equal(finalActions.filter(action => action === 'won').length, 1);
});

// Exercise the production GA bridge with native events and an independently delayed SDK.
async function createGameAnalyticsHarness({ hostname = 'example.com', supported = true, failImport = false, failLog = false } = {}) {
    const source = await readFile(path.resolve(__dirname, '../public/scripts/siteAnalytics.js'), 'utf8');
    const target = new EventTarget();
    const events = [];
    let imports = 0;
    let visits = 0;
    let startSdk;
    const sdkReady = new Promise(resolve => { startSdk = resolve; });
    const context = vm.createContext({
        window: { location: { hostname }, addEventListener: target.addEventListener.bind(target) },
        document: { getElementById: () => null }, console: { warn() {} },
        localStorage: { getItem: () => '0', setItem() {} }
    });
    const exportsByName = {
        'firebase-app.js': { getApps: () => [], getApp: () => ({}), initializeApp: () => ({}) },
        'firebase-firestore.js': {
            getFirestore: () => ({}), connectFirestoreEmulator() {}, doc: () => ({}),
            runTransaction: async (db, update) => update({
                get: async () => ({ exists: () => true, data: () => ({ count: 0 }) }),
                set() { visits++; }
            })
        },
        'firebaseConfig.js': { firebaseConfig: {}, useFirebaseEmulators: false },
        'firebase-analytics.js': {
            isSupported: async () => { await sdkReady; return supported; },
            getAnalytics: () => ({ initialized: true }),
            logEvent(analytics, name, parameters) {
                if (failLog) throw new Error('GA blocked');
                events.push({ name, parameters: JSON.parse(JSON.stringify(parameters)) });
            }
        }
    };
    const modules = new Map();
    for (const [name, values] of Object.entries(exportsByName)) {
        const module = new vm.SyntheticModule(Object.keys(values), function () {
            for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        }, { context });
        await module.link(() => { throw new Error('Unexpected dependency'); });
        await module.evaluate();
        modules.set(name, module);
    }
    const tracker = new vm.SourceTextModule(source, { context,
        importModuleDynamically: async () => {
            imports++;
            if (failImport) throw new Error('SDK blocked');
            return modules.get('firebase-analytics.js');
        }
    });
    await tracker.link(specifier => modules.get(specifier.split('?')[0].split('/').at(-1)));
    await tracker.evaluate();
    return {
        events, startSdk, imports: () => imports, visits: () => visits,
        // Native CustomEvent delivery exercises the exact listener used by the game.
        emit(detail) { target.dispatchEvent(new CustomEvent('rocket:gameLifecycle', { detail })); },
        // Settle SDK and transaction continuations without network or timer sleeps.
        async settle() { for (let index = 0; index < 30; index++) await Promise.resolve(); }
    };
}

test('GA gameplay uses exact allowlisted names and parameters, with bounded pre-init buffering', async () => {
    const harness = await createGameAnalyticsHarness();
    const detail = { action: 'started', routeIndex: 0, deliveries: 0, fuel: 100, gameplaySeconds: 0,
        runId: randomUUID(), email: 'private@example.com', text: 'private', query: '?secret=1' };
    assert.equal(harness.events.length, 0); // No old runs or synthetic starts are imported.
    for (let index = 0; index < 40; index++) harness.emit({ ...detail, gameplaySeconds: index });
    assert.equal(harness.events.length, 0);
    harness.startSdk();
    await harness.settle();
    assert.equal(harness.events.length, 32);
    assert.equal(harness.events[0].parameters.gameplay_seconds, 8);
    harness.events.length = 0;
    for (const action of ['started', 'continued', 'left', 'suspended', 'landed', 'delivered', 'won', 'lost', 'abandoned']) {
        harness.emit({ ...detail, action });
    }
    assert.deepEqual(harness.events.map(event => event.name), [
        'game_started', 'game_continued', 'game_left', 'game_suspended', 'game_landed',
        'game_delivered', 'game_won', 'game_lost', 'game_abandoned'
    ]);
    assert.deepEqual(harness.events[0].parameters, {
        action: 'started', route_index: 0, deliveries: 0, fuel_remaining: 100, gameplay_seconds: 0
    });
    for (const change of [
        { action: 'unknown' }, { routeIndex: -1 }, { routeIndex: 10 }, { routeIndex: 1.5 },
        { deliveries: -1 }, { deliveries: 11 }, { deliveries: 1.5 }, { fuel: -1 }, { fuel: 101 },
        { fuel: NaN }, { fuel: Infinity }, { fuel: '50' }, { gameplaySeconds: -1 },
        { gameplaySeconds: Infinity }, { gameplaySeconds: NaN }, { gameplaySeconds: 31536001 }
    ]) harness.emit({ ...detail, ...change });
    harness.emit(null);
    harness.emit({ action: 'started' });
    assert.equal(harness.events.length, 9);
    assert.equal(harness.visits(), 1);
});

test('GA excludes localhost on every port and loopback hosts while preserving visit counts', async () => {
    for (const hostname of ['localhost', 'app.localhost', '127.0.0.1', '127.0.0.2', '[::1]', '::1', '0.0.0.0']) {
        const harness = await createGameAnalyticsHarness({ hostname });
        harness.startSdk();
        harness.emit({ action: 'started', routeIndex: 0, deliveries: 0, fuel: 100, gameplaySeconds: 0 });
        await harness.settle();
        assert.equal(harness.imports(), 0, hostname);
        assert.equal(harness.events.length, 0, hostname);
        assert.equal(harness.visits(), 1, hostname);
    }
});

test('blocked, unsupported, or throwing GA leaves native gameplay and visit counts working', async () => {
    for (const options of [{ failImport: true }, { supported: false }, { failLog: true }]) {
        const harness = await createGameAnalyticsHarness(options);
        const detail = { action: 'started', routeIndex: 0, deliveries: 0, fuel: 100, gameplaySeconds: 0 };
        harness.emit(detail);
        harness.startSdk();
        await harness.settle();
        assert.doesNotThrow(() => harness.emit(detail));
        assert.equal(harness.events.length, 0);
        assert.equal(harness.visits(), 1);
    }
});
