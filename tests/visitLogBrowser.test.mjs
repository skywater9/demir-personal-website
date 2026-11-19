import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Wait for mocked network microtasks without sleeping or reaching any real service.
async function settle() {
    for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve));
}

// Model only the text and event APIs needed by the real shipped modules.
class Element {
    constructor() { this.handlers = {}; this.dataset = {}; this.children = []; this.hidden = false; }
    // Keep callbacks available for simulated user actions.
    addEventListener(name, callback) { this.handlers[name] = callback; }
    // Append DOM nodes without treating text as HTML.
    append(...children) { this.children.push(...children); }
    // Clear private content exactly as a real dashboard does on sign-out.
    replaceChildren(...children) { this.children = children; }
    // Identify fixed product metadata without using visible text as analytics data.
    closest() { return null; }
}

// Link production modules to explicit Firebase doubles, keeping all tests offline.
async function moduleHarness(file, globals, modules) {
    const context = vm.createContext({ console, URL, Date, Map, Set, Math, JSON, Number, Object,
        crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' }, ...globals });
    const cache = new Map();
    // Supply a synthetic SDK module or load the real small local core.
    async function dependency(specifier) {
        const key = specifier.split('?')[0];
        if (cache.has(key)) return cache.get(key);
        let module;
        if (key.endsWith('visitLogCore.mjs')) {
            module = new vm.SourceTextModule(await readFile(new URL('../public/scripts/visitLogCore.mjs', import.meta.url), 'utf8'), { context });
            await module.link(dependency);
        } else {
            const exports = modules[key] || (key.includes('firebaseConfig') ? { firebaseConfig: { projectId: 'test', apiKey: 'test' } } : null);
            assert.ok(exports, `unexpected import ${key}`);
            module = new vm.SyntheticModule(Object.keys(exports), function () {
                for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
            }, { context });
            await module.link(() => assert.fail('synthetic imports'));
        }
        cache.set(key, module);
        await module.evaluate();
        return module;
    }
    const module = new vm.SourceTextModule(await readFile(new URL(`../public/scripts/${file}`, import.meta.url), 'utf8'), {
        context, importModuleDynamically: dependency
    });
    await module.link(dependency);
    await module.evaluate();
    return context;
}

test('real visitor module logs first action, keyboard semantics, lifecycle and departure; retries same rows after failure', async () => {
    const window = new Element();
    const document = new Element();
    const status = new Element();
    document.visibilityState = 'visible';
    document.getElementById = id => id === 'gameShell' ? { dataset: { screen: 'menu' } } : status;
    const values = new Map();
    const intervals = [];
    const commits = [];
    let rootExists = false;
    let failCommit = false;
    const auth = { currentUser: { uid: 'random-guest', getIdToken: async () => 'guest-token' }, authStateReady: async () => {} };
    const common = 'https://www.gstatic.com/firebasejs/11.0.2/';
    await moduleHarness('visitLog.mjs', { window, document, location: { hostname: 'example.test' },
        sessionStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
        setInterval: callback => intervals.push(callback), setTimeout: () => {},
        fetch: async (url, options) => {
            assert.equal(options.keepalive, true);
            assert.equal(options.headers.Authorization, 'Bearer guest-token');
            if (!options.method) return { ok: rootExists, status: rootExists ? 200 : 404, json: async () => ({}) };
            const body = JSON.parse(options.body);
            if (body.writes[0].update?.fields.writerId) rootExists = true;
            else {
                commits.push(body);
                if (failCommit) { failCommit = false; return { ok: false, status: 503 }; }
            }
            return { ok: true, status: 200, json: async () => ({}) };
        }
    }, {
        [`${common}firebase-app.js`]: { initializeApp: () => ({}) },
        [`${common}firebase-auth.js`]: { initializeAuth: () => auth, browserSessionPersistence: {},
            onIdTokenChanged: () => {}, signInAnonymously: () => assert.fail('already authenticated') }
    });
    await settle();
    assert.equal(commits[0].writes[0].update.fields.eventName.stringValue, 'pageView');
    document.handlers.click({ target: { tagName: 'H1', closest: () => null, textContent: 'private text' } });
    window.handlers['rocket:log']({ detail: { name: 'controlPress', target: 'burn' } });
    window.handlers['rocket:gameLifecycle']({ detail: { action: 'lost', runId: 'do-not-log', fuel: 0, gameplaySeconds: 25 } });
    failCommit = true;
    intervals[0]();
    await settle();
    assert.match(status.textContent, /PENDING/);
    window.handlers.online();
    await settle();
    assert.deepEqual(commits[1], commits[2]);
    window.handlers.pagehide();
    await settle();
    const rows = commits.flatMap(commit => commit.writes.filter(write => write.update).map(write => write.update.fields));
    assert.ok(rows.some(row => row.eventName.stringValue === 'firstAction'));
    assert.ok(rows.some(row => row.eventName.stringValue === 'controlPress' && row.target.stringValue === 'burn'));
    assert.ok(rows.some(row => row.eventName.stringValue === 'pageLeave'));
    assert.equal(JSON.stringify(commits).includes('private text'), false);
    assert.equal(JSON.stringify(commits).includes('do-not-log'), false);
});

test('conquest listeners keep bounded anonymous outcomes offline and resolve replaced menu status nodes', async () => {
    const window = new Element();
    const document = new Element();
    let status = new Element();
    const oldFooterStatus = status;
    const intervals = [];
    const values = new Map();
    document.visibilityState = 'visible';
    document.getElementById = id => id === 'eventLogStatus' ? status : null;
    const common = 'https://www.gstatic.com/firebasejs/11.0.2/';
    const user = { uid: 'random-writer', getIdToken: async () => 'anonymous-token' };
    await moduleHarness('visitLog.mjs', { window, document, location: { hostname: 'example.test' },
        sessionStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
        setInterval: callback => intervals.push(callback), setTimeout: () => {},
        fetch: async () => { throw Error('offline'); }
    }, {
        [`${common}firebase-app.js`]: { initializeApp: () => ({}) },
        [`${common}firebase-auth.js`]: { initializeAuth: () => ({ currentUser: user, authStateReady: async () => {} }),
            browserSessionPersistence: {}, onIdTokenChanged: () => {} }
    });
    await settle();
    assert.match(oldFooterStatus.textContent, /CONNECTION FAILED/);
    status = new Element();
    intervals[0]();
    assert.match(status.textContent, /CONNECTION FAILED/);
    const snapshot = { fuel: 70, cargo: 100, owned: 2, planetLevel: 1, gameplaySeconds: 20 };
    window.handlers['rocket:conquest']({ detail: { action: 'joined', ...snapshot,
        playerId: 'private-player', roomId: 'private-room', digit: 7, x: 345 } });
    for (let index = 0; index < 100; index++) {
        window.handlers['rocket:conquest']({ detail: { action: 'shotStarted', ...snapshot } });
        window.handlers['rocket:log']({ detail: { name: 'controlPress', target: 'fire' } });
    }
    window.handlers['rocket:conquest']({ detail: { action: 'shotEnded', amount: 100, ...snapshot } });
    window.handlers['rocket:log']({ detail: { name: 'controlRelease', target: 'fire' } });
    window.handlers['rocket:conquest']({ detail: { action: 'hackStarted', target: 'relay', ...snapshot } });
    for (let amount = 0; amount < 1000; amount++) {
        window.handlers['rocket:conquest']({ detail: { action: 'hackProgress', target: 'relay', amount, ...snapshot } });
    }
    window.handlers['rocket:conquest']({ detail: { action: 'captured', target: 'planet', ...snapshot } });
    for (const target of ['servers', 'records']) window.handlers['rocket:log']({ detail: { name: 'screenView', target } });
    for (const analyticsId of ['gameStart', 'gameContinue', 'gameMenu', 'gameFire', 'conquestReset', 'conquestUpgrade',
        'conquestInteract', 'conquestSelfDestruct', 'conquestSelfDestructCancel', 'conquestMap', 'conquestDigit', 'conquestBriefing',
        'conquestFire', 'conquestJoin', 'conquestGalaxies']) {
        document.handlers.click({ target: { tagName: 'BUTTON', textContent: 'private-digit-7',
            closest: () => ({ dataset: { analyticsId } }) } });
    }
    const saved = JSON.parse(values.values().next().value);
    const rows = saved.pending;
    assert.equal(rows.filter(row => row.eventName === 'firstAction').length, 1);
    assert.equal(rows.filter(row => row.eventName === 'conquest' && row.details.action === 'shotStarted').length, 1);
    assert.equal(rows.filter(row => row.eventName === 'conquest' && row.details.action === 'shotEnded').length, 1);
    assert.equal(rows.filter(row => row.eventName === 'controlPress' && row.target === 'fire').length, 1);
    assert.equal(rows.filter(row => row.eventName === 'conquest' && row.details.action === 'hackProgress').length, 20);
    assert.equal(rows.filter(row => row.eventName === 'click' && row.target !== 'other').length, 15);
    assert.equal(JSON.stringify(rows).includes('private-'), false);
    for (const detail of [null, { action: 'unknown' }, { action: 'joined', fuel: Infinity }, { action: 'joined', target: 'planet-7' }]) {
        window.handlers['rocket:conquest']({ detail });
    }
    window.handlers['rocket:log']({ detail: { name: 'dash', target: 'private-direction' } });
    assert.equal(JSON.parse(values.values().next().value).sequence, saved.sequence);
    assert.match(status.textContent, /SAVING/);
    assert.match(oldFooterStatus.textContent, /CONNECTION FAILED/);
    window.handlers['rocket:log']({ detail: { name: 'controlPress', target: 'fire' } });
    window.handlers.blur();
    window.handlers['rocket:log']({ detail: { name: 'controlRelease', target: 'fire' } });
    const suspendedRows = JSON.parse(values.values().next().value).pending;
    assert.equal(suspendedRows.filter(row => row.eventName === 'controlRelease' && row.target === 'fire').length, 2,
        'The logger runs before the app blur listener and must retain its final release.');
});

test('local status follows a late-mounted menu without connecting to Firebase', async () => {
    let status = null;
    const intervals = [];
    await moduleHarness('visitLog.mjs', { location: { hostname: 'localhost' },
        document: { getElementById: () => status }, setInterval: callback => intervals.push(callback)
    }, {});
    status = new Element();
    intervals[0]();
    assert.match(status.textContent, /LOCAL PLAY — NOT UPLOADED/);
});

test('real dashboard requires owner claim, paginates queries, safely renders rows and clears them on sign-out', async () => {
    const html = await readFile(new URL('../public/analytics.html', import.meta.url), 'utf8');
    const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], Object.assign(new Element(), { id: match[1] })]));
    const document = { querySelectorAll: () => [...nodes.values()], createElement: () => new Element() };
    const sdk = 'https://www.gstatic.com/firebasejs/11.0.2/';
    let authListener;
    let reads = 0;
    let signedOut = false;
    const queryCalls = [];
    const visit = { sessionId: 'session-safe', startedAt: 1000, lastEventAt: 4000, lastSequence: 5 };
    const modules = {
        [`${sdk}firebase-app.js`]: { initializeApp: () => ({}) },
        [`${sdk}firebase-auth.js`]: { getAuth: () => ({}), onAuthStateChanged: (_, callback) => { authListener = callback; },
            GoogleAuthProvider: class {}, signInWithPopup: async () => {}, signOut: async () => { signedOut = true; } },
        [`${sdk}firebase-firestore.js`]: { getFirestore: () => ({}), collection: (_, ...parts) => parts.join('/'),
            orderBy: (...args) => ['orderBy', ...args], limit: value => ['limit', value], startAfter: value => ['startAfter', value],
            query: (...args) => { queryCalls.push(args); return args; }, getDocs: async constraints => {
                reads++;
                const events = [
                    { eventName: 'click', target: '<img onerror=bad>', details: {} },
                    { eventName: 'gameLifecycle', target: 'flight', details: { action: 'delivered', routeIndex: 1, deliveries: 1 } },
                    { eventName: 'conquest', target: 'planet', details: { action: 'captured', gameplaySeconds: 120,
                        fuel: 60, cargo: 200, owned: 3, planetLevel: 2 } },
                    { eventName: 'conquest', target: 'relay', details: { action: 'hackProgress', amount: 25 } },
                    { eventName: 'conquest', target: 'conquest', details: { action: 'shotEnded', amount: 120 } }
                ];
                const docs = constraints[0] === 'visitLogs' ? [{ id: 'session-safe', data: () => visit }]
                    : events.map((event, index) => ({ id: String(index + 1),
                        data: () => ({ sequence: index + 1, recordedAt: 1000 + index, elapsedMs: index, ...event }) }));
                return { size: docs.length, docs };
            } }
    };
    await moduleHarness('visitLogDashboard.mjs', { document }, modules);
    await authListener({ getIdTokenResult: async () => ({ claims: {} }) });
    assert.equal(reads, 0);
    assert.equal(nodes.get('dashboard').hidden, true);
    await authListener({ getIdTokenResult: async () => ({ claims: { analyticsOwner: true } }) });
    assert.equal(nodes.get('dashboard').hidden, false);
    assert.equal(reads, 1);
    await nodes.get('sessionRows').children[0].children[0].children[0].handlers.click();
    await settle();
    const cells = nodes.get('timelineRows').children[0].children;
    assert.equal(cells[3].textContent, '<img onerror=bad>');
    const rows = nodes.get('timelineRows').children;
    assert.match(rows[1].children[4].textContent, /destination: Moon/);
    assert.equal(rows[2].children[2].textContent, 'conquest');
    assert.equal(rows[2].children[4].textContent,
        'action: captured · gameplay: 120 s · fuel: 60% · cargo: 200 · owned planets: 3 · planet level: 2');
    assert.match(rows[3].children[4].textContent, /hack milestone: 25 successful presses/);
    assert.match(rows[4].children[4].textContent, /shots during hold: 120/);
    assert.deepEqual(queryCalls.map(call => call.at(-1)), [['limit', 25], ['limit', 100]]);
    nodes.get('signOutButton').handlers.click();
    assert.equal(signedOut, true);
    assert.equal(nodes.get('timelineRows').children.length, 0);
    assert.equal(nodes.get('sessionRows').children.length, 0);
    assert.equal(nodes.get('dashboard').hidden, true);
});
