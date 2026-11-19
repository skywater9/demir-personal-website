const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { getOwnerSettings, parseDashboardQuery, summarizeSession, extractHeatmapClicks } = require('./analyticsDashboard');

test('owner configuration fails closed and the demo UID requires the complete local emulator environment', () => {
    assert.throws(() => getOwnerSettings({}), { status: 503 });
    assert.deepEqual(getOwnerSettings({ ANALYTICS_OWNER_UID: 'productionOwner' }), { uid: 'productionOwner', local: false });
    const local = {
        FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-website-analytics',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'
    };
    assert.deepEqual(getOwnerSettings(local), { uid: 'analyticsLocalOwner', local: true });
    assert.throws(() => getOwnerSettings({ ...local, GCLOUD_PROJECT: 'production-project' }), { status: 503 });
    assert.throws(() => getOwnerSettings({ ...local, FUNCTIONS_EMULATOR: 'false' }), { status: 503 });
    assert.throws(() => getOwnerSettings({ ...local, FIREBASE_AUTH_EMULATOR_HOST: 'remote.example:9099' }), { status: 503 });
});

test('queries reject arbitrary paths, repeated parameters, oversized pages, and cross-view parameters', () => {
    assert.equal(parseDashboardQuery({}).limit, 25);
    assert.equal(parseDashboardQuery({ view: 'timeline', sessionId: randomUUID(), limit: '2' }).limit, 2);
    for (const query of [
        { view: 'users' }, { limit: '26' }, { limit: '0' }, { limit: 'NaN' },
        { cursor: '../../other' }, { view: ['sessions', 'timeline'] }, { extra: 'value' },
        { view: 'timeline' }, { view: 'sessions', sessionId: randomUUID() }
    ]) {
        assert.throws(() => parseDashboardQuery(query), { status: 400 });
    }
});

test('session summaries report observed time and exclude ingestion-only metadata', () => {
    const summary = summarizeSession({ id: randomUUID(), data: () => ({
        startedAt: 1000, lastActivityAt: 3000, lastEventAt: 5000,
        visibleMs: 3500, engagedMs: 2000, eventCount: 4,
        rateWindowCount: 10, batchCount: 2, expiresAt: 'internal'
    }) });
    assert.equal(summary.durationMs, 4000);
    assert.equal(summary.visibleMs, 3500);
    assert.equal('rateWindowCount' in summary, false);
    assert.equal('expiresAt' in summary, false);
});

test('heatmap queries require valid upload dates, a bounded range, and a layout filter', () => {
    const base = { view: 'heatmap', from: '2020-01-01', to: '2020-01-31', layoutVersion: 'homepage-v1' };
    const query = parseDashboardQuery(base);
    assert.equal(query.endMs - query.startMs, 31 * 86400000);
    assert.equal(parseDashboardQuery({ ...base, layoutVersion: 'homepage-v3' }).layoutVersion, 'homepage-v3');
    for (const changes of [
        { from: '2020-02-30' }, { to: '2020-02-01' }, { from: '2020-02-01' },
        { layoutVersion: '' }, { layoutVersion: '../../index' }, { sessionId: randomUUID() },
        { to: '2999-01-01' }, { from: '2020-1-1' }
    ]) assert.throws(() => parseDashboardQuery({ ...base, ...changes }), { status: 400 });
    assert.throws(() => parseDashboardQuery({ view: 'sessions', from: '2020-01-01' }), { status: 400 });
});

test('heatmap extraction excludes keyboard actions, other pages, and other layout versions', () => {
    const click = {
        eventName: 'click', sequence: 1, pagePath: '/', layoutVersion: 'homepage-v1',
        properties: { documentX: 20, documentY: 600, viewportWidth: 1000, viewportHeight: 500,
            pageWidth: 1000, pageHeight: 2000, elementId: 'counterReset', sectionId: 'clickCounter' }
    };
    const documents = [{ id: 'batch', data: () => ({ events: [
        click, { ...click, sequence: 2, eventName: 'interaction' },
        { ...click, sequence: 3, pagePath: '/animal.html' },
        { ...click, sequence: 4, layoutVersion: 'homepage-v3' }
    ] }) }];
    const result = extractHeatmapClicks(documents, 'homepage-v1');
    assert.equal(result.length, 1);
    assert.equal(result[0].documentY, 600);
    assert.equal(result[0].eventId, 'batch:1');
    assert.equal('session' in result[0], false);
    const current = extractHeatmapClicks(documents, 'homepage-v3');
    assert.equal(current.length, 1);
    assert.equal(current[0].eventId, 'batch:4');
});

// Load pure geometry helpers from the actual browser module without a browser dependency.
async function loadHeatmapHelpers(contextValues = {}) {
    const source = await readFile(path.resolve(__dirname, '../public/scripts/analyticsHeatmap.js'), 'utf8');
    const module = new vm.SourceTextModule(source, { context: vm.createContext(contextValues) });
    await module.link(() => { throw new Error('Heatmap geometry must not require external imports.'); });
    await module.evaluate();
    return module.namespace;
}

test('heatmap groups exact geometry, bins scrolled document coordinates, and guards alignment', async () => {
    const helpers = await loadHeatmapHelpers();
    const first = {
        layoutVersion: 'homepage-v3', viewportWidth: 1000, viewportHeight: 500,
        pageWidth: 1000, pageHeight: 2000, documentX: 25, documentY: 625, elementId: 'counterReset'
    };
    const groups = helpers.groupHeatmapClicks([
        first, { ...first, documentX: 30, documentY: 630 },
        { ...first, viewportHeight: 600 }, { ...first, pageHeight: 2100 },
        { ...first, layoutVersion: 'homepage-v1' }, { ...first, documentX: -1 }
    ]);
    assert.equal(groups.length, 4);
    assert.equal(groups[0].clicks.length, 2);
    const summary = helpers.summarizeHeatmap(groups[0]);
    assert.equal(summary.cells[0].x, 24);
    assert.equal(summary.cells[0].y, 624);
    assert.equal(summary.peakCount, 2);
    assert.equal(summary.elementCounts[0][1], 2);
    assert.equal(helpers.checkPreviewGeometry(groups[0], 1000, 2000), null);
    assert.match(helpers.checkPreviewGeometry(groups[0], 1000, 1990), /Overlay withheld/);
    assert.match(helpers.checkPreviewGeometry({ ...groups[0], layoutVersion: 'homepage-v1' }), /No page preview/);
    assert.match(helpers.checkPreviewGeometry({ ...groups[0], pageWidth: 100000 }), /size limit/);
});

test('overlay uses static SVG cells that do not require canvas scripting inside the preview', async () => {
    const helpers = await loadHeatmapHelpers();
    const preview = {
        createElement() { throw new Error('The script-free preview must not use canvas.'); },
        createElementNS(namespace, tag) {
            return {
                namespace, tag, attributes: {}, style: {}, children: [],
                // Retain attributes to verify document coordinates, clipping, and density colors.
                setAttribute(name, value) { this.attributes[name] = value; },
                // Preserve static child cells without running any script inside the preview.
                append(child) { this.children.push(child); }
            };
        }
    };
    const group = { pageWidth: 50, pageHeight: 650 };
    const summary = { peakCount: 4, cells: [
        { x: 24, y: 624, count: 4 }, { x: 48, y: 648, count: 1 }
    ] };
    const overlay = helpers.createHeatmapOverlay(preview, group, summary);
    assert.equal(overlay.tag, 'svg');
    assert.equal(overlay.namespace, 'http://www.w3.org/2000/svg');
    assert.equal(overlay.attributes.viewBox, '0 0 50 650');
    assert.match(overlay.style.cssText, /position:absolute/);
    assert.match(overlay.style.cssText, /pointer-events:none/);
    assert.equal(overlay.children.length, 2);
    assert.equal(overlay.children[0].tag, 'rect');
    assert.equal(overlay.children[0].attributes.y, '624');
    assert.equal(overlay.children[0].attributes.fill, 'hsl(0, 100%, 50%)');
    assert.equal(overlay.children[0].attributes['fill-opacity'], '0.65');
    assert.equal(overlay.children[1].attributes.width, '2');
    assert.equal(overlay.children[1].attributes.height, '2');
    assert.notEqual(overlay.children[1].attributes.fill, overlay.children[0].attributes.fill);
});

test('preview sanitization removes active resources and handlers and adds a restrictive policy', async () => {
    // A detached DOM fixture tests sanitizer operations; real browser rendering remains manual QA.
    function makeElement(tag, attributes = {}) {
        return {
            tag, attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })), removed: false,
            remove() { this.removed = true; },
            removeAttribute(name) { this.attributes = this.attributes.filter(attribute => attribute.name !== name); },
            setAttribute(name, value) { this.attributes.push({ name, value }); },
            matches() { return ['a', 'button', 'input', 'select', 'textarea'].includes(this.tag); }
        };
    }
    const resources = ['script', 'iframe', 'link', 'meta', 'img'].map(tag => makeElement(tag));
    const button = makeElement('button', { onclick: 'sendData()', autofocus: '', class: 'control' });
    const anchor = makeElement('a', { href: 'javascript:sendData()', target: '_top', onfocus: 'sendData()' });
    const form = makeElement('form', { action: 'https://external.example' });
    const canvas = makeElement('canvas', { id: 'gameCanvas', width: '1000', height: '500' });
    const menu = makeElement('section', { 'data-analytics-section': 'menu', class: 'menu' });
    const throttle = makeElement('input', { type: 'range', 'data-analytics-id': 'gameThrottle' });
    const head = [];
    const body = makeElement('body');
    const fixture = {
        querySelectorAll(selector) {
            if (selector === '*') return [button, anchor, form, canvas, menu, throttle];
            return resources.filter(element => selector.split(',').map(value => value.trim()).includes(element.tag));
        },
        createElement: tag => makeElement(tag),
        head: { prepend(element) { head.unshift(element); }, append(element) { head.push(element); } },
        body,
        documentElement: { outerHTML: '<html>sanitized fixture</html>' }
    };
    const helpers = await loadHeatmapHelpers({ DOMParser: class {
        parseFromString() { return fixture; }
    } });
    const markup = helpers.createInertPreview('public page markup', 'body { margin: 0; }');
    assert.ok(resources.every(element => element.removed));
    assert.deepEqual(button.attributes.map(attribute => attribute.name).sort(), ['class', 'tabindex']);
    assert.deepEqual(anchor.attributes.map(attribute => attribute.name), ['tabindex']);
    assert.equal(form.attributes.length, 0);
    assert.equal(canvas.removed, false);
    assert.equal(menu.removed, false);
    assert.ok(throttle.attributes.some(attribute => attribute.name === 'data-analytics-id'));
    assert.equal(head[0].httpEquiv, 'Content-Security-Policy');
    assert.match(head[0].content, /default-src 'none'/);
    assert.match(head[0].content, /script-src 'none'/);
    assert.equal(head[1].textContent, 'body { margin: 0; }\nbody { pointer-events: none; }');
    assert.ok(markup.startsWith('<!DOCTYPE html>\n<html>'));
    assert.ok(body.attributes.some(attribute => attribute.name === 'inert'));
});

// Exercise the real dashboard script with a minimal DOM and mocked authentication boundary.
async function createDashboardHarness({ DOMParser, useEmulators = true, customAnalytics = 'enabled' } = {}) {
    const html = await readFile(path.resolve(__dirname, '../tests/fixtures/legacyAnalytics.html'), 'utf8');
    const nodes = new Map();

    // Model only the DOM operations used by the dashboard, retaining text safely for assertions.
    class Element {
        constructor(tag = 'div') {
            this.tagName = tag;
            this.children = [];
            this.handlers = {};
            this.attributes = {};
            this.textContent = '';
            this.hidden = false;
            this.disabled = false;
            this.checked = false;
            this.value = '';
            this.style = {};
        }
        // Preserve children for rendering and sign-out-clearing checks.
        append(...children) { this.children.push(...children); }
        // Clear prior render results rather than accumulating stale rows.
        replaceChildren(...children) { this.children = [...children]; }
        // Retain accessibility attributes for the keyboard navigation assertions.
        setAttribute(name, value) { this.attributes[name] = value; }
        // Expose the actual event handlers for interaction-based tests.
        addEventListener(name, handler) { this.handlers[name] = handler; }
    }
    for (const match of html.matchAll(/id="([^"]+)"/g)) {
        const element = new Element();
        element.id = match[1];
        nodes.set(match[1], element);
    }
    const auth = { currentUser: null };
    let authListener;
    const requests = [];
    const responses = [];
    const context = vm.createContext({
        URLSearchParams, AbortSignal, AbortController, DOMException, DOMParser, console,
        document: { body: { dataset: { customAnalytics } }, querySelectorAll: () => [...nodes.values()], createElement: tag => new Element(tag) },
        async fetch(url, options) {
            requests.push({ url, ...options });
            const response = responses.shift() || { status: 200, body: { sessions: [], nextCursor: null } };
            if (response.wait) await response.wait;
            return { ok: response.status === 200, status: response.status,
                json: async () => {
                    if (response.text?.startsWith('<')) throw new SyntaxError('Unexpected token <');
                    return response.body;
                }, text: async () => response.text };
        }
    });
    const appModule = new vm.SyntheticModule(['initializeApp'], function () {
        this.setExport('initializeApp', config => config);
    }, { context });
    const configModule = new vm.SyntheticModule(['firebaseConfig', 'useFirebaseEmulators'], function () {
        this.setExport('firebaseConfig', {});
        this.setExport('useFirebaseEmulators', useEmulators);
    }, { context });
    const authExports = {
        getAuth: () => auth,
        connectAuthEmulator: () => {},
        setPersistence: async () => {},
        browserSessionPersistence: {},
        GoogleAuthProvider: class {},
        signInWithPopup: async () => {},
        signInWithEmailAndPassword: async () => {},
        onAuthStateChanged: (value, listener) => { authListener = listener; listener(null); },
        signOut: async () => { auth.currentUser = null; authListener(null); }
    };
    const authModule = new vm.SyntheticModule(Object.keys(authExports), function () {
        for (const [name, value] of Object.entries(authExports)) this.setExport(name, value);
    }, { context });
    const source = await readFile(path.resolve(__dirname, '../public/scripts/analyticsDashboard.js'), 'utf8');
    const heatmapSource = await readFile(path.resolve(__dirname, '../public/scripts/analyticsHeatmap.js'), 'utf8');
    const heatmapModule = new vm.SourceTextModule(heatmapSource, { context });
    const dashboard = new vm.SourceTextModule(source, { context });
    await dashboard.link(importPath => {
        const specifier = importPath.split('?')[0];
        if (specifier === './firebaseConfig.js') return configModule;
        if (specifier === './analyticsHeatmap.js') return heatmapModule;
        if (specifier.endsWith('/firebase-app.js')) return appModule;
        if (specifier.endsWith('/firebase-auth.js')) return authModule;
        throw new Error(`Unexpected dashboard import: ${specifier}`);
    });
    await dashboard.evaluate();

    // Settle rendering promises without waiting on a real browser or network.
    async function settle() {
        for (let index = 0; index < 30; index++) await Promise.resolve();
    }

    // Simulate an auth-state change while leaving owner authorization to the mocked API response.
    async function signIn() {
        auth.currentUser = { email: 'owner@example.test', getIdToken: async () => 'test-token' };
        authListener(auth.currentUser);
        await settle();
    }
    return { nodes, requests, responses, signIn, settle };
}

test('legacy Spark overview fixture shows available analytics without requesting the inactive backend', async () => {
    const harness = await createDashboardHarness({ useEmulators: false, customAnalytics: 'disabled' });
    assert.equal(harness.nodes.get('sparkOverview').hidden, false);
    assert.equal(harness.nodes.get('signInPanel').hidden, true);
    assert.equal(harness.nodes.get('dashboard').hidden, true);
    assert.equal(harness.nodes.get('heatmapPanel').hidden, true);
    assert.equal(harness.requests.length, 0);
    assert.match(harness.nodes.get('status').textContent, /inactive/);
});

test('dashboard renders owner data as text and clears all records immediately on sign-out', async () => {
    const harness = await createDashboardHarness();
    const sessionId = randomUUID();
    const session = {
        sessionId, startedAt: 1000, durationMs: 5000, visibleMs: 4000, engagedMs: 3000,
        eventCount: 2, sectionVisibleMs: { header: 4000 }, lastMeaningfulAction: null
    };
    harness.responses.push({ status: 200, body: { sessions: [session], nextCursor: null } });
    await harness.signIn();
    assert.equal(harness.nodes.get('dashboard').hidden, false);
    assert.equal(harness.requests[0].headers.Authorization, 'Bearer test-token');
    assert.equal(harness.requests[0].cache, 'no-store');
    const sessionButton = harness.nodes.get('sessionRows').children[0].children[0].children[0];
    assert.ok(sessionButton.attributes['aria-label']);
    harness.responses.push({ status: 200, body: { session, nextCursor: null, events: [
        { eventId: 'first', pageInstanceId: 'one', sequence: 1, eventName: 'interaction',
            recordedAt: 1000, elapsedMs: 0, pagePath: '/', properties: { elementId: '<img src=x onerror=alert(1)>', inputType: 'pointer' } },
        { eventId: 'second', pageInstanceId: 'one', sequence: 2, eventName: 'sessionCheckpoint',
            recordedAt: 2000, elapsedMs: 1000, pagePath: '/', properties: { visibleMs: 1000, engagedMs: 1000 } }
    ] } });
    sessionButton.handlers.click();
    await harness.settle();
    assert.equal(harness.nodes.get('timelineRows').children.length, 1);
    assert.equal(harness.nodes.get('timelineRows').children[0].children[1].textContent, '<img src=x onerror=alert(1)>');
    harness.nodes.get('includeSystemEvents').checked = true;
    harness.nodes.get('includeSystemEvents').handlers.change();
    assert.equal(harness.nodes.get('timelineRows').children.length, 2);
    await harness.nodes.get('signOutButton').handlers.click();
    assert.equal(harness.nodes.get('dashboard').hidden, true);
    assert.equal(harness.nodes.get('sessionRows').children.length, 0);
    assert.equal(harness.nodes.get('timelineRows').children.length, 0);
    assert.equal(harness.nodes.get('selectedSessionId').textContent, '');
});

test('dashboard never reveals records after access denial or a late response following sign-out', async () => {
    const denied = await createDashboardHarness();
    denied.responses.push({ status: 403, body: { error: 'This account does not have access.' } });
    await denied.signIn();
    assert.equal(denied.nodes.get('dashboard').hidden, true);
    assert.equal(denied.nodes.get('error').hidden, false);

    const late = await createDashboardHarness();
    let finish;
    const wait = new Promise(resolve => { finish = resolve; });
    late.responses.push({ status: 200, wait, body: { sessions: [{ sessionId: randomUUID() }], nextCursor: null } });
    await late.signIn();
    await late.nodes.get('signOutButton').handlers.click();
    finish();
    await late.settle();
    assert.equal(late.nodes.get('dashboard').hidden, true);
    assert.equal(late.nodes.get('sessionRows').children.length, 0);
});

test('heatmap labels partial pages, preserves filters, and clears coordinates after sign-out', async () => {
    const harness = await createDashboardHarness();
    await harness.signIn();
    const nodes = harness.nodes;
    nodes.get('heatmapFrom').value = '2020-01-01';
    nodes.get('heatmapTo').value = '2020-01-02';
    nodes.get('heatmapLayout').value = 'homepage-v1';
    const point = {
        eventId: 'one', layoutVersion: 'homepage-v1', viewportWidth: 1000, viewportHeight: 500,
        pageWidth: 1000, pageHeight: 2000, documentX: 20, documentY: 600, elementId: 'counterReset'
    };
    const cursor = randomUUID();
    harness.responses.push({ status: 200, body: { clicks: [point], scannedBatches: 25, nextCursor: cursor } });
    nodes.get('heatmapForm').handlers.submit({ preventDefault() {} });
    await harness.settle();
    assert.match(nodes.get('heatmapStatus').textContent, /Partial data/);
    assert.match(nodes.get('heatmapPreviewNote').textContent, /No page preview/);
    assert.equal(nodes.get('heatmapElementRows').children.length, 1);
    assert.equal(nodes.get('heatmapMoreButton').hidden, false);
    harness.responses.push({ status: 200, body: { clicks: [point, { ...point, eventId: 'two' }], scannedBatches: 1, nextCursor: null } });
    nodes.get('heatmapMoreButton').handlers.click();
    await harness.settle();
    assert.match(harness.requests.at(-1).url, new RegExp(`cursor=${cursor}`));
    assert.match(harness.requests.at(-1).url, /from=2020-01-01/);
    assert.match(nodes.get('heatmapStatus').textContent, /2 clicks loaded/);
    assert.match(nodes.get('heatmapStatus').textContent, /All batches/);
    assert.equal(nodes.get('heatmapElementRows').children[0].children[1].textContent, '2');
    assert.ok(harness.requests.every(request => request.url.startsWith('/api/analytics?')));
    await nodes.get('signOutButton').handlers.click();
    assert.equal(nodes.get('heatmapPanel').hidden, true);
    assert.equal(nodes.get('heatmapPreview').children.length, 0);
    assert.equal(nodes.get('heatmapElementRows').children.length, 0);
    assert.equal(nodes.get('heatmapStatus').textContent, '');
});

test('v3 loads the main stylesheet into a sandboxed inert preview and withholds misaligned overlays', async () => {
    const html = '<html><body><canvas id="gameCanvas"></canvas><button data-analytics-id="gameBurn">Burn</button></body></html>';
    const css = 'body { margin: 0; background: #111; color: white; }';
    let preview;
    const harness = await createDashboardHarness({ DOMParser: class {
        // Model parsed static markup while the dedicated sanitizer test checks resource stripping.
        parseFromString(source) { assert.equal(source, html); return preview; }
    } });
    const { nodes } = harness;
    const Element = nodes.get('heatmapPreview').constructor;
    const styles = [];
    preview = {
        querySelectorAll: () => [],
        createElement: tag => new Element(tag),
        createElementNS: (namespace, tag) => new Element(tag),
        head: { prepend() {}, append(style) { styles.push(style); } },
        body: new Element('body'),
        documentElement: { outerHTML: html, scrollWidth: 1000, scrollHeight: 500 }
    };
    await harness.signIn();
    nodes.get('heatmapLayout').value = 'homepage-v3';
    const point = {
        eventId: 'burn', layoutVersion: 'homepage-v3', viewportWidth: 1000, viewportHeight: 500,
        pageWidth: 1000, pageHeight: 500, documentX: 20, documentY: 30, elementId: 'gameBurn'
    };
    harness.responses.push(
        { status: 200, body: { clicks: [point], scannedBatches: 1, nextCursor: null } },
        { status: 200, text: html }, { status: 200, text: css }
    );
    nodes.get('heatmapForm').handlers.submit({ preventDefault() {} });
    await harness.settle();
    assert.deepEqual(harness.requests.slice(-2).map(request => request.url), ['/index.html', '/style.css']);
    assert.equal(harness.requests.at(-1).headers, undefined);
    const frame = nodes.get('heatmapPreview').children[0];
    assert.equal(frame.attributes.sandbox, 'allow-same-origin');
    assert.equal(frame.attributes.referrerpolicy, 'no-referrer');
    assert.equal(frame.style.width, '1000px');
    assert.equal(frame.style.height, '500px');
    assert.ok(styles[0].textContent.startsWith(css));
    assert.equal(preview.body.attributes.inert, '');
    assert.match(frame.srcdoc, /gameCanvas/);
    assert.match(frame.srcdoc, /gameBurn/);
    frame.contentDocument = preview;
    frame.handlers.load();
    assert.equal(preview.body.children[0].tagName, 'svg');
    assert.match(nodes.get('heatmapPreviewNote').textContent, /canvas is blank/);
    assert.equal(nodes.get('heatmapElementRows').children[0].children[1].textContent, '1');
    preview.body.replaceChildren();
    preview.documentElement.scrollHeight = 600;
    frame.handlers.load();
    assert.match(nodes.get('heatmapPreviewNote').textContent, /Overlay withheld/);
    assert.equal(preview.body.children.length, 0);
    await nodes.get('signOutButton').handlers.click();
    frame.handlers.load();
    assert.equal(nodes.get('heatmapPreview').children.length, 0);
    assert.equal(preview.body.children.length, 0);
});

test('dashboard labels all planned game actions and section durations', async () => {
    const harness = await createDashboardHarness();
    const actions = {
        gameStart: 'Game start requested', gameContinue: 'Continue requested',
        gameNewRun: 'New run requested', gameConfirmNewRun: 'New run confirmed',
        gameCancelNewRun: 'New run canceled', gameMenu: 'Game menu requested',
        gameRetry: 'Retry requested', gameHistory: 'Run history requested',
        gameHistoryBack: 'Run history back requested', gameDock: 'Dock requested',
        gameThrottleUp: 'Throttle increased', gameThrottleDown: 'Throttle decreased',
        gameRotateLeft: 'Rotate left pressed', gameRotateRight: 'Rotate right pressed',
        gameRcsUp: 'RCS up pressed', gameRcsDown: 'RCS down pressed',
        gameRcsLeft: 'RCS left pressed', gameRcsRight: 'RCS right pressed',
        gameResume: 'Resume requested', gameBurn: 'Main engine pressed', gameThrottle: 'Throttle control pressed'
    };
    const session = {
        sessionId: randomUUID(), startedAt: 1000, durationMs: 5000, visibleMs: 4000, engagedMs: 3000,
        eventCount: Object.keys(actions).length, sectionVisibleMs: { menu: 1000, cockpit: 2000, history: 1000, results: 1000 },
        lastMeaningfulAction: { elementId: 'gameBurn', recordedAt: 2000 }
    };
    harness.responses.push({ status: 200, body: { sessions: [session], nextCursor: null } });
    await harness.signIn();
    harness.responses.push({ status: 200, body: {
        session, nextCursor: null,
        events: Object.keys(actions).map((elementId, index) => ({
            eventId: String(index), pageInstanceId: 'one', sequence: index + 1, eventName: 'interaction',
            recordedAt: 1000 + index, elapsedMs: index, pagePath: '/',
            properties: { elementId, sectionId: 'cockpit', inputType: 'pointer' }
        }))
    } });
    harness.nodes.get('sessionRows').children[0].children[0].children[0].handlers.click();
    await harness.settle();
    assert.deepEqual(harness.nodes.get('timelineRows').children.map(row => row.children[1].textContent), Object.values(actions));
    assert.match(harness.nodes.get('sessionMetrics').children.at(-1).children[1].textContent, /Main engine pressed/);
    assert.deepEqual(harness.nodes.get('sectionDurations').children.map(row => row.textContent),
        ['Menu: 1.0s', 'Cockpit: 2.0s', 'Run history: 1.0s', 'Results: 1.0s']);
});

test('emulators: owner reads, non-owner denial, disabled account denial, and cursor pagination', {
    skip: !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST
}, async context => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
    assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const { getFirestore, Timestamp } = require('firebase-admin/firestore');
    const projectId = 'demo-website-analytics';
    const app = initializeApp({ projectId }, 'dashboardTests');
    context.after(() => deleteApp(app));
    const auth = getAuth(app);
    const db = getFirestore(app);
    const password = 'localOwnerOnly123!';

    // Leave known local-only accounts available for the user's manual verification.
    async function prepareLocalUser(uid, email) {
        try {
            await auth.getUser(uid);
        } catch (error) {
            if (error.code !== 'auth/user-not-found') throw error;
            await auth.createUser({ uid, email, password, emailVerified: true });
        }
        const result = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-test-key`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        const data = await result.json();
        assert.equal(result.status, 200, JSON.stringify(data));
        return data.idToken;
    }
    const ownerToken = await prepareLocalUser('analyticsLocalOwner', 'owner@example.test');
    const otherToken = await prepareLocalUser('analyticsLocalOther', 'other@example.test');
    const endpoint = 'http://127.0.0.1:5050/api/analytics';
    const headers = { Authorization: `Bearer ${ownerToken}` };
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal((await fetch(endpoint, { headers: { Authorization: 'Bearer invalid-token' } })).status, 401);
    assert.equal((await fetch(endpoint, { headers: { Authorization: `Bearer ${otherToken}` } })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers })).status, 405);

    const now = Date.now();
    const sessionIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, sessionId] of sessionIds.entries()) {
        await db.collection('analyticsSessions').doc(sessionId).set({
            sessionId, startedAt: now - 10000 - index, lastActivityAt: now - 1000,
            lastEventAt: now - 500, visibleMs: 9000, engagedMs: 8000,
            eventCount: 3, sectionVisibleMs: { header: 9000 }, lastMeaningfulAction: null,
            lastPagePath: '/', batchCount: 3, rateWindowCount: 3
        });
    }
    const selectedSessionId = sessionIds[0];
    const batchIds = [];
    for (let index = 0; index < 3; index++) {
        const batchId = randomUUID();
        batchIds.push(batchId);
        await db.collection('analyticsBatches').doc(batchId).set({
            sessionId: selectedSessionId, pageInstanceId: randomUUID(), receivedAt: Timestamp.fromMillis(now + index),
            events: [{
                eventName: 'interaction', sequence: index + 1, sessionId: selectedSessionId,
                recordedAt: now - 9000 + (2 - index) * 1000, elapsedMs: 1000 + (2 - index) * 1000,
                pagePath: '/', layoutVersion: 'homepage-v1', properties: { elementId: 'counterReset', sectionId: 'clickCounter', inputType: 'pointer' }
            }]
        });
    }
    const firstResponse = await fetch(`${endpoint}?view=sessions&limit=1`, { headers });
    assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
    assert.match(firstResponse.headers.get('Cache-Control'), /no-store/);
    const firstPage = await firstResponse.json();
    assert.equal(firstPage.sessions.length, 1);
    assert.ok(firstPage.nextCursor);
    assert.equal('rateWindowCount' in firstPage.sessions[0], false);
    const secondPage = await (await fetch(`${endpoint}?view=sessions&limit=1&cursor=${firstPage.nextCursor}`, { headers })).json();
    assert.notEqual(secondPage.sessions[0].sessionId, firstPage.sessions[0].sessionId);
    const timeline = await (await fetch(`${endpoint}?view=timeline&sessionId=${selectedSessionId}&limit=2`, { headers })).json();
    assert.equal(timeline.events.length, 2);
    assert.ok(timeline.events[0].recordedAt <= timeline.events[1].recordedAt);
    assert.ok(timeline.nextCursor);
    const rest = await (await fetch(`${endpoint}?view=timeline&sessionId=${selectedSessionId}&limit=2&cursor=${timeline.nextCursor}`, { headers })).json();
    assert.equal(rest.events.length, 1);
    assert.equal(rest.nextCursor, null);
    assert.notEqual(rest.events[0].eventId, timeline.events[0].eventId);
    assert.equal((await fetch(`${endpoint}?view=sessions&limit=1000`, { headers })).status, 400);
    assert.equal((await fetch(`${endpoint}?view=timeline&sessionId=${sessionIds[1]}&cursor=${batchIds[0]}`, { headers })).status, 400);
    const directUrl = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/analyticsSessions/${selectedSessionId}`;
    assert.equal((await fetch(directUrl, { headers })).status, 403);

    const heatmapDate = '2020-01-30';
    const heatmapTime = Date.parse(`${heatmapDate}T12:00:00.000Z`);
    const clickEvent = {
        eventName: 'click', sequence: 1, sessionId: selectedSessionId,
        recordedAt: heatmapTime, elapsedMs: 0, pagePath: '/', layoutVersion: 'homepage-v1',
        properties: { documentX: 20, documentY: 600, viewportWidth: 1000, viewportHeight: 500,
            pageWidth: 1000, pageHeight: 2000, elementId: 'counterReset', sectionId: 'clickCounter' }
    };
    const historicalIds = [];
    for (let index = 0; index < 4; index++) {
        const batchId = `00000000-0000-4000-8000-00000000040${index}`;
        historicalIds.push(batchId);
        const events = index === 1
            ? [{ ...clickEvent, layoutVersion: 'homepage-v3' }, { ...clickEvent, eventName: 'interaction', sequence: 2 }]
            : [{ ...clickEvent, properties: { ...clickEvent.properties, viewportWidth: index === 2 ? 800 : 1000 } }];
        await db.collection('analyticsBatches').doc(batchId).set({
            sessionId: selectedSessionId, pageInstanceId: randomUUID(), events,
            receivedAt: Timestamp.fromMillis(index === 3 ? heatmapTime + 2 * 86400000 : heatmapTime + index)
        });
    }
    const heatmapUrl = `${endpoint}?view=heatmap&from=${heatmapDate}&to=${heatmapDate}&layoutVersion=homepage-v1&limit=1`;
    assert.equal((await fetch(heatmapUrl)).status, 401);
    assert.equal((await fetch(heatmapUrl, { headers: { Authorization: `Bearer ${otherToken}` } })).status, 403);
    let heatmapCursor = null;
    let scannedBatches = 0;
    const loadedClicks = [];
    for (let page = 0; page < 3; page++) {
        const response = await fetch(`${heatmapUrl}${heatmapCursor ? `&cursor=${heatmapCursor}` : ''}`, { headers });
        assert.equal(response.status, 200, await response.clone().text());
        const result = await response.json();
        scannedBatches += result.scannedBatches;
        loadedClicks.push(...result.clicks);
        heatmapCursor = result.nextCursor;
    }
    assert.equal(heatmapCursor, null);
    assert.equal(scannedBatches, 3);
    assert.equal(loadedClicks.length, 2);
    assert.equal(loadedClicks[0].documentY, 600);
    assert.ok(loadedClicks.every(click => click.layoutVersion === 'homepage-v1'));
    assert.equal((await fetch(`${heatmapUrl}&cursor=${historicalIds[3]}`, { headers })).status, 400);
    await auth.updateUser('analyticsLocalOwner', { disabled: true });
    try {
        assert.equal((await fetch(endpoint, { headers })).status, 401);
    } finally {
        await auth.updateUser('analyticsLocalOwner', { disabled: false });
    }
});


test('dashboard explains an undeployed HTML API and preserves sign-in controls', async () => {
    const harness = await createDashboardHarness();
    harness.responses.push({ status: 404, text: '<html>Not found</html>' });
    await harness.signIn();
    assert.match(harness.nodes.get('error').textContent, /backend is not deployed/);
    assert.match(harness.nodes.get('error').textContent, /billing and Functions setup/);
    assert.equal(harness.nodes.get('signOutButton').hidden, false);
    assert.equal(harness.requests[0].headers.Authorization, 'Bearer test-token');
    const html = await readFile(path.resolve(__dirname, '../tests/fixtures/legacyAnalytics.html'), 'utf8');
    assert.match(html, /click heatmap are inactive on Spark/);
});

test('dashboard includes readable gameplay metadata in the default timeline', async () => {
    const harness = await createDashboardHarness();
    const session = { sessionId: randomUUID(), startedAt: 1000, durationMs: 5000,
        visibleMs: 4000, engagedMs: 3000, eventCount: 9, sectionVisibleMs: {}, lastMeaningfulAction: null };
    harness.responses.push({ status: 200, body: { sessions: [session], nextCursor: null } });
    await harness.signIn();
    const labels = { started: 'Flight started', continued: 'Flight continued', left: 'Flight left for menu',
        suspended: 'Flight suspended', landed: 'Landed and refueled', delivered: 'Payload delivered',
        won: 'Journey won', lost: 'Flight lost', abandoned: 'Flight abandoned' };
    const runId = randomUUID();
    harness.responses.push({ status: 200, body: { session, nextCursor: null,
        events: Object.keys(labels).map((action, index) => ({ eventId: String(index),
            sequence: index + 1, recordedAt: 1000 + index, elapsedMs: index,
            eventName: 'gameLifecycle', pagePath: '/', properties: {
                action, runId, routeIndex: 2, deliveries: 3, fuel: 72.5, gameplaySeconds: 93
            } })) } });
    harness.nodes.get('sessionRows').children[0].children[0].children[0].handlers.click();
    await harness.settle();
    const rows = harness.nodes.get('timelineRows').children;
    assert.equal(rows.length, 9);
    assert.deepEqual(rows.map(row => row.children[1].textContent), Object.values(labels));
    assert.equal(rows[0].children[2].textContent,
        `Run ${runId} · stop 3/10 · deliveries 3/10 · fuel 72.5% · gameplay 1m 33s`);
});
