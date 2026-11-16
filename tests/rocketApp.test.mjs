import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FlightApp, formatTime } from '../public/scripts/rocketApp.mjs';
import { RocketRenderer } from '../public/scripts/rocketRenderer.mjs';
import { saveKey } from '../public/scripts/rocketStorage.mjs';
import { createRun, routeBody, bodies, dockingPoint, tuning } from '../public/scripts/rocketPhysics.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

// Implement just the event and element interfaces the app uses, with IDs parsed from the actual homepage.
function makePage() {
    const page = { visibilityState: 'visible', activeElement: null, handlers: new Map() };
    class Element {
        // Keep element state independent so tests detect hidden-panel and input-state leaks.
        constructor(tag = 'div', attributes = {}) {
            this.tagName = tag.toUpperCase();
            this.id = attributes.id || '';
            this.dataset = {};
            this.hidden = false;
            this.disabled = false;
            this.inert = false;
            this.style = {};
            this.textContent = '';
            this.children = [];
            this.handlers = new Map();
            this.attributes = attributes;
            this.value = attributes.value || '';
            const classes = new Set((attributes.class || '').split(' '));
            this.classList = {
                // Mirror class toggling without requiring a browser dependency.
                toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
                // Remove stale held-input styles when gameplay suspends.
                remove(name) { classes.delete(name); },
                // Expose state for accessibility and feedback assertions.
                contains(name) { return classes.has(name); }
            };
            for (const [key, value] of Object.entries(attributes)) {
                if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
            }
        }
        // Retain all callbacks so tests exercise real button and lifecycle handlers.
        addEventListener(name, callback) {
            if (!this.handlers.has(name)) this.handlers.set(name, []);
            this.handlers.get(name).push(callback);
        }
        // Dispatch a user event with ordinary pointer and key defaults.
        fire(name, properties = {}) {
            const event = { target: this, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, ...properties };
            for (const callback of this.handlers.get(name) || []) callback(event);
        }
        // Record pointer ownership so release tests can model captured input.
        setPointerCapture(pointerId) { this.pointerId = pointerId; }
        // Focus updates the document's active control for keyboard-held buttons.
        focus() { page.activeElement = this; }
        // Support the fuel panel ancestor used to display low-fuel feedback.
        closest() { return fuelPanel; }
        // Keep ARIA values inspectable in HUD assertions.
        setAttribute(name, value) { this.attributes[name] = value; }
        // Append safe text-built history rows and event lists.
        append(...children) { this.children.push(...children); }
        // Reset history without retaining elements from older renders.
        replaceChildren(...children) { this.children = children; }
        // Return focusable controls from each actual modal's source range.
        querySelectorAll() {
            const start = html.indexOf(`id="${this.id}"`);
            const end = html.indexOf('</section>', start);
            const content = html.slice(start, end);
            const buttons = [...nodes.values()].filter(node => node.tagName === 'BUTTON' && !node.hidden && !node.disabled && content.includes(`id="${node.id}"`));
            if (content.includes('<summary>')) {
                this.summaryElement ||= new Element('summary');
                buttons.push(this.summaryElement);
            }
            return buttons;
        }
    }
    const fuelPanel = new Element();
    const nodes = new Map();
    for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="[^"]+"[^>]*)>/gi)) {
        const attributes = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]]));
        assert.equal(nodes.has(attributes.id), false, `duplicate id: ${attributes.id}`);
        const element = new Element(match[1], attributes);
        element.hidden = /(?:^|\s)hidden(?:\s|$)/.test(match[2]);
        nodes.set(element.id, element);
    }
    const controls = [...html.matchAll(/<button\b([^>]*data-control="[^"]+"[^>]*)>/g)].map(match => {
        const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]]));
        return attributes.id ? nodes.get(attributes.id) : new Element('button', attributes);
    });
    const wordmark = new Element('a');
    page.querySelectorAll = selector => selector === '[id]' ? [...nodes.values()] : controls;
    page.querySelector = () => wordmark;
    page.createElement = tag => new Element(tag);
    page.getElementById = id => nodes.get(id);
    page.addEventListener = Element.prototype.addEventListener;
    page.fire = Element.prototype.fire;
    return { page, nodes, controls };
}

// Share browser-like persistence between fresh app instances to test real refresh recovery.
function makeStorage() {
    const data = new Map();
    return { getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { data.set(key, value); } };
}

// Build the live application against the homepage fixture with a renderer that cannot start background work.
function makeApp(storage = makeStorage(), lockManager = { request(name, action) { return action(); } }) {
    const { page, nodes, controls } = makePage();
    const browserWindow = {
        localStorage: storage, handlers: new Map(), addEventListener: page.addEventListener, fire: page.fire,
        navigator: { locks: lockManager }
    };
    const renderer = { draw() {} };
    const app = new FlightApp({ page, browserWindow, renderer, autoStart: false });
    return { app, page, nodes, controls, browserWindow, storage };
}

// Advance animation timestamps at 60 Hz rather than bypassing the application's fixed-step loop.
function flyFor(app, seconds, start = 0) {
    app.frame(start);
    for (let frame = 1; frame <= seconds * 60; frame += 1) app.frame(start + frame * 1000 / 60);
}

test('homepage starts in menu and its real Start button launches with held engine controls', () => {
    const { app, nodes } = makeApp();
    assert.equal(app.mode, 'menu');
    assert.equal(nodes.get('instrumentPanel').inert, true);
    nodes.get('startButton').fire('click');
    assert.equal(app.mode, 'flight');
    assert.equal(nodes.get('menuOverlay').hidden, true);
    assert.ok(app.store.getActive());
    const initialY = app.run.y;
    nodes.get('burnButton').fire('pointerdown');
    flyFor(app, 2);
    assert.ok(app.run.y < initialY - 20);
    assert.ok(app.run.fuel < 100);
    nodes.get('burnButton').fire('lostpointercapture');
    assert.equal(app.currentInput().burn, false);
    assert.ok(Number(nodes.get('fuelGauge').attributes['aria-valuenow']) < 100);
});

test('menu and refresh preserve velocity and fuel, record leave/return, and exclude offline time', () => {
    const { app, page, nodes, storage } = makeApp();
    nodes.get('startButton').fire('click');
    nodes.get('burnButton').fire('pointerdown');
    flyFor(app, 2);
    page.fire('keydown', { code: 'Escape' });
    const saved = structuredClone(app.run);
    assert.equal(app.mode, 'menu');
    assert.equal(saved.events.at(-1).type, 'left');
    flyFor(app, 10, 20000);
    assert.equal(app.run.elapsed, saved.elapsed);
    const reloaded = makeApp(storage);
    assert.equal(reloaded.app.mode, 'menu');
    assert.equal(reloaded.nodes.get('continueButton').hidden, false);
    reloaded.nodes.get('continueButton').fire('click');
    assert.equal(reloaded.app.run.vy, saved.vy);
    assert.equal(reloaded.app.run.fuel, saved.fuel);
    assert.equal(reloaded.app.run.elapsed, saved.elapsed);
    assert.equal(reloaded.app.run.events.at(-1).type, 'returned');
    assert.equal(reloaded.app.currentInput().burn, false);
});

test('switching away suspends only once and clears all held keyboard and touch inputs', () => {
    const { app, nodes, page, browserWindow } = makeApp();
    nodes.get('startButton').fire('click');
    page.fire('keydown', { code: 'Space' });
    const rcs = app.heldButtons.find(button => button.dataset.control === 'rcsRight');
    rcs.fire('pointerdown', { pointerId: 2 });
    assert.deepEqual(app.currentInput(), { burn: true, rotate: 0, rcsX: 1, rcsY: 0 });
    nodes.get('burnButton').fire('pointercancel', { pointerId: 1 });
    assert.equal(app.currentInput().rcsX, 1);
    page.visibilityState = 'hidden';
    page.fire('visibilitychange');
    browserWindow.fire('pagehide');
    browserWindow.fire('blur');
    assert.equal(app.mode, 'menu');
    assert.equal(app.run.events.filter(event => event.type === 'suspended').length, 1);
    assert.deepEqual(app.currentInput(), { burn: false, rotate: 0, rcsX: 0, rcsY: 0 });
});

test('new flight confirmation preserves saved progress on cancel and archives it on replacement', () => {
    const { app, nodes } = makeApp();
    nodes.get('startButton').fire('click');
    app.openMenu();
    const firstId = app.run.id;
    nodes.get('startButton').fire('click');
    assert.equal(app.mode, 'confirm');
    assert.equal(app.store.getActive().id, firstId);
    nodes.get('cancelNewButton').fire('click');
    assert.equal(app.mode, 'menu');
    assert.equal(app.store.getActive().id, firstId);
    nodes.get('startButton').fire('click');
    nodes.get('confirmNewButton').fire('click');
    assert.equal(app.mode, 'flight');
    assert.notEqual(app.run.id, firstId);
    assert.equal(app.store.getHistory()[0].status, 'abandoned');
    assert.equal(app.store.getHistory()[0].id, firstId);
});

test('fuel failure shows persisted results and retry starts a fresh Earth run', () => {
    const { app, nodes } = makeApp();
    nodes.get('startButton').fire('click');
    app.run.fuel = 0.001;
    nodes.get('burnButton').fire('pointerdown');
    flyFor(app, 0.1);
    assert.equal(app.mode, 'results');
    assert.equal(app.store.getActive(), null);
    assert.equal(app.store.getHistory()[0].status, 'lost');
    assert.equal(nodes.get('resultFuel').textContent, '0.0%');
    assert.equal(nodes.get('resultTime').textContent, formatTime(app.run.elapsed));
    nodes.get('retryButton').fire('click');
    assert.equal(app.mode, 'flight');
    assert.equal(app.run.fuel, 100);
    assert.equal(app.run.routeIndex, 0);
    assert.equal(app.run.delivered, 0);
});

test('last relay attachment shows the win screen and history safely exposes lifecycle records', () => {
    const { app, nodes } = makeApp();
    nodes.get('startButton').fire('click');
    Object.assign(app.run, { routeIndex: 9, delivered: 9, landedOn: null, serviced: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], ...dockingPoint(routeBody(9)) });
    nodes.get('dockButton').fire('click');
    assert.equal(app.mode, 'results');
    assert.equal(nodes.get('resultTitle').textContent, 'Journey complete.');
    assert.equal(nodes.get('retryButton').hidden, true);
    assert.equal(app.store.getHistory()[0].delivered, 10);
    nodes.get('resultMenuButton').fire('click');
    nodes.get('historyButton').fire('click');
    assert.equal(app.mode, 'history');
    assert.equal(nodes.get('historyRows').children.length, 1);
    const detail = nodes.get('historyRows').children[0].children[1];
    assert.ok(detail.children[1].children.some(item => item.textContent.includes('Journey completed')));
});

test('dialogs contain Tab navigation and focused engine buttons support keyboard holds', () => {
    const { app, page, nodes } = makeApp();
    let prevented = false;
    page.fire('keydown', { code: 'Tab', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(page.activeElement, nodes.get('startButton'));
    page.fire('keydown', { code: 'Tab', shiftKey: true });
    assert.equal(page.activeElement.tagName, 'SUMMARY');
    page.fire('keydown', { code: 'Tab' });
    assert.equal(page.activeElement, nodes.get('startButton'));
    nodes.get('startButton').fire('click');
    nodes.get('burnButton').focus();
    nodes.get('burnButton').fire('keydown', { code: 'Enter' });
    assert.equal(app.currentInput().burn, true);
    page.fire('keyup', { code: 'Enter' });
    assert.equal(app.currentInput().burn, false);
    app.openMenu();
    nodes.get('startButton').fire('click');
    page.fire('keydown', { code: 'Escape' });
    assert.equal(app.mode, 'menu');
});

test('continuing a flight in another tab suspends the old tab without overwriting progress', () => {
    const first = makeApp();
    first.nodes.get('startButton').fire('click');
    const second = makeApp(first.storage);
    second.nodes.get('continueButton').fire('click');
    const saved = second.app.store.getActive();
    first.browserWindow.fire('storage', { key: saveKey });
    assert.equal(first.app.mode, 'menu');
    assert.equal(first.app.store.getActive().id, saved.id);
    assert.equal(first.app.store.getActive().events.at(-1).type, 'returned');
    assert.match(first.nodes.get('savedRunNote').textContent, /another tab/);
});

test('asynchronous persistence completes transitions and never starts a flight while the page is hidden', async () => {
    const locks = { request(name, action) { return Promise.resolve().then(action); } };
    const { app, page, nodes } = makeApp(makeStorage(), locks);
    const starting = app.newRun();
    page.visibilityState = 'hidden';
    await starting;
    assert.equal(app.mode, 'menu');
    assert.equal(app.store.getActive().events.at(-1).type, 'suspended');
    page.visibilityState = 'visible';
    await app.continueRun();
    assert.equal(app.mode, 'flight');
    app.run.fuel = 0.001;
    nodes.get('burnButton').fire('pointerdown');
    flyFor(app, 0.1);
    assert.equal(app.resultsPending, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.mode, 'results');
    assert.equal(app.store.getHistory()[0].status, 'lost');
});

test('renderer exercises all planet and atmosphere paths with finite canvas coordinates', () => {
    let drawCalls = 0;
    const context = new Proxy({}, {
        // Treat each canvas operation as a contract check, including labels and clipped planet textures.
        get(target, name) {
            if (name in target) return target[name];
            return (...args) => {
                for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `${String(name)} received ${arg}`);
                drawCalls += 1;
            };
        },
        // Retain drawing state fields such as colors and font settings.
        set(target, name, value) { target[name] = value; return true; }
    });
    const canvas = { clientWidth: 1000, clientHeight: 600, width: 500, height: 300, getContext() { return context; } };
    const map = { width: 268, height: 55, getContext() { return context; } };
    const renderer = new RocketRenderer(canvas, map);
    for (const body of bodies) {
        const run = createRun();
        Object.assign(run, { x: body.x, y: body.y - body.radius - tuning.shipRadius, landedOn: body.id });
        renderer.camera = { x: run.x, y: run.y - 90, zoom: 0.9 };
        renderer.draw(run, { burn: true, rcsX: -1, rcsY: 1 });
    }
    renderer.draw({ ...createRun(), x: 0, y: -4000 }, {}, true);
    assert.ok(drawCalls > 1000);
});
