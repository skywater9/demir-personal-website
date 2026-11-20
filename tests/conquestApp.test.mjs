import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConquestApp } from '../public/scripts/conquestApp.mjs';
import { safeConquestDetails } from '../public/scripts/visitLogCore.mjs';
import { ConquestStore, validWorld } from '../public/scripts/conquestStorage.mjs';
import { createWorld, bodies, dockingPoint, stepWorld, tuning, killPlayer } from '../public/scripts/conquestPhysics.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

// Model only browser methods used by the actual page controller, retaining event/ARIA observations.
function harness(storage = memoryStorage(), initialNow = 100000, extraOptions = {}) {
    const page = { visibilityState: 'visible', handlers: new Map(), activeElement: null };
    const logs = [];
    let clock = initialNow;
    class Element {
        constructor(tag = 'div', attributes = {}) {
            this.tagName = tag.toUpperCase(); this.attributes = attributes; this.id = attributes.id || '';
            this.dataset = {}; this.style = {}; this.handlers = new Map(); this.children = [];
            this.width = 800; this.height = 600; this.offsetWidth = 800; this.clientHeight = 600;
            this.hidden = false; this.disabled = false; this.inert = false; this.value = ''; this.textContent = '';
            for (const [key, value] of Object.entries(attributes)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
            const classes = new Set((attributes.class || '').split(' '));
            this.classList = { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } };
        }
        // Supply browser geometry for cargo animation and pointer placement.
        getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
        // Copy the cargo icon so the controller can animate an independent marker.
        cloneNode() { return new Element(this.tagName, { ...this.attributes }); }
        // Allow animation clones to discard the original icon ID.
        removeAttribute(name) { delete this.attributes[name]; }
        addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(fn); }
        fire(name, properties = {}) { const event = { target: this, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, ...properties }; for (const fn of this.handlers.get(name) || []) fn(event); }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        append(...nodes) { this.children.push(...nodes); }
        replaceChildren(...nodes) { this.children = nodes; }
        focus() { page.activeElement = this; }
        closest() { return propulsion; }
        setPointerCapture() {}
        animate() { return { finished: Promise.resolve() }; }
        remove() {}
        querySelector() { return null; }
        querySelectorAll() { return [...nodes.values()].filter(node => node.tagName === 'BUTTON' && !node.hidden && !node.disabled); }
    }
    const nodes = new Map();
    const controls = [];
    const propulsion = new Element();
    for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]+)>/gi)) {
        const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(value => [value[1], value[2]]));
        if (!attrs.id && !attrs['data-control']) continue;
        const node = new Element(match[1], attrs);
        node.hidden = /\shidden(?:\s|$)/.test(match[2]);
        if (attrs.id) { assert.ok(!nodes.has(attrs.id), `Duplicate ID ${attrs.id}`); nodes.set(attrs.id, node); }
        if (attrs['data-control']) controls.push(node);
    }
    nodes.get('flightCanvas').parentElement = new Element('section');
    page.querySelectorAll = selector => selector === '[id]' ? [...nodes.values()] : controls;
    page.createElement = tag => new Element(tag);
    page.addEventListener = Element.prototype.addEventListener;
    page.fire = Element.prototype.fire;
    const browserWindow = { sessionStorage: storage, localStorage: memoryStorage(), handlers: new Map(), addEventListener: Element.prototype.addEventListener,
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        dispatchEvent(event) { logs.push(event); } };
    const store = new ConquestStore(storage, () => {}, () => clock);
    const renderer = { draw() {}, screen() { return { x: 400, y: 300 }; }, aimAt() { return .5; }, mapTarget() { return { bodyId: bodies[1].id, type: 'relay' }; } };
    const app = new ConquestApp({ page, browserWindow, store, renderer, autoStart: false, now: () => clock, serverUrl: '', ...extraOptions });
    return { app, page, nodes, controls, logs, storage, setClock(value) { clock = value; } };
}

// Keep persistence tests isolated from a real user's browser data.
function memoryStorage() {
    const data = new Map();
    return { getItem(key) { return data.get(key) || null; }, setItem(key, value) { data.set(key, value); } };
}

// Place the ship at an exact relay to isolate interaction/UI semantics from navigation tuning.
function placeAtRelay(app, index = 1) {
    Object.assign(app.world.player, dockingPoint(bodies[index]), { vx: 0, vy: 0, angle: 0, landedOn: null });
    app.updateHud({});
}

test('actual homepage starts one local galaxy and maps W/S/Space without Space thrust or legacy RCS keys', () => {
    const { app, nodes, controls, page } = harness();
    assert.equal(app.hasSession, false);
    nodes.get('playButton').fire('click');
    assert.equal(app.mode, 'flight');
    assert.equal(app.ownedCount(), 1);
    assert.equal(bodies.length, 24);
    assert.ok(validWorld(app.world));
    page.fire('keydown', { code: 'KeyW' });
    page.fire('keydown', { code: 'KeyS' });
    page.fire('keydown', { code: 'Space', target: controls.find(node => node.dataset.control === 'burn') });
    const input = app.currentInput();
    assert.equal(input.burn, true);
    assert.equal(input.fire, true);
    assert.equal(input.rcsY, 1);
    app.clearInput();
    page.fire('keydown', { code: 'Space' });
    assert.equal(app.currentInput().burn, false);
    assert.equal(app.currentInput().fire, true);
    app.clearInput();
    for (const code of ['KeyI', 'KeyJ', 'KeyK', 'KeyL']) page.fire('keydown', { code });
    assert.equal(app.currentInput().rcsX, 0);
    assert.equal(app.currentInput().rcsY, 0);
    assert.deepEqual(controls.map(node => node.dataset.control), []);
});

test('relay UI supports changing digit capture, cannot fire docked, and upgrades only its planet', () => {
    const { app, nodes } = harness();
    app.newSession();
    placeAtRelay(app);
    assert.equal(nodes.get('dockDialog').hidden, false);
    nodes.get('interactButton').fire('click');
    assert.equal(app.world.player.docked, bodies[1].id);
    assert.equal(nodes.get('hackPanel').hidden, false);
    app.keys.add('Space');
    assert.equal(app.currentInput().fire, false);
    const before = app.world.hack.progress;
    app.enterDigit((app.world.hack.digit + 6) % 10);
    assert.equal(app.world.hack.progress, before);
    for (let attempt = 0; app.world.hack && attempt < 30; attempt++) {
        stepWorld(app.world, {}, .15);
        nodes.get('digitButton').fire('click');
    }
    assert.equal(app.world.hack, null);
    assert.equal(app.world.planets[bodies[1].id].owner, 'pilot');
    assert.equal(nodes.get('hackPanel').hidden, true);
    assert.equal(nodes.get('upgradePanel').hidden, false);
    app.world.player.cargo = 60;
    app.upgrade();
    assert.equal(app.world.planets[bodies[1].id].level, 1);
    assert.equal(app.world.planets[bodies[2].id].level, 0);
    assert.equal(app.world.player.cargo, 60 - tuning.upgradeCosts[0]);
});

test('menu keeps the world alive and reset requires confirmation', () => {
    const { app, nodes, controls } = harness();
    app.newSession();
    assert.equal(app.keys.size, 0);
    app.showScreen('menu');
    app.frame(1000); app.frame(1100);
    assert.ok(app.world.elapsed > .09);
    const id = app.world.id;
    app.requestNew();
    assert.equal(app.mode, 'confirm');
    nodes.get('cancelButton').fire('click');
    assert.equal(app.world.id, id);
    app.requestNew(); nodes.get('confirmButton').fire('click');
    assert.notEqual(app.world.id, id);
    assert.equal(app.store.records().length, 1);
});

test('fresh Space on the fuel warning self-destructs without firing or accepting held repeats', () => {
    const { app, nodes, page } = harness();
    app.newSession();
    Object.assign(app.world.player, { fuel: 0, cargo: 12, landedOn: null, x: 5000, y: -5000 });
    app.updateHud({});
    assert.equal(nodes.get('fuelPrompt').hidden, false);
    page.fire('keydown', { code: 'Space', repeat: true });
    assert.equal(app.world.stats.deaths, 0);
    app.keys.add('Space');
    page.fire('keydown', { code: 'Space', repeat: false });
    assert.equal(app.world.stats.deaths, 0);
    app.keys.delete('Space');
    page.fire('keydown', { code: 'Space', repeat: false, target: nodes.get('chatInput') });
    assert.equal(app.world.stats.deaths, 0);
    page.fire('keydown', { code: 'Space', repeat: false });
    assert.equal(app.world.stats.deaths, 1);
    assert.equal(app.world.projectiles.length, 0);
    assert.equal(app.world.pickups.length, 1);
    page.fire('keydown', { code: 'Space', repeat: true });
    assert.equal(app.world.stats.deaths, 1);
    stepWorld(app.world, {}, 1);
    assert.equal(app.world.player.deadUntil, 0);
    assert.equal(app.world.player.fuel, 100);
    assert.equal(app.ownedCount(), 1);
});

// The same action remains available without a keyboard and never runs while refueling at home.
test('self-destruct button accepts a visible empty-fuel warning only', () => {
    const { app, nodes } = harness();
    app.newSession();
    app.requestSelfDestruct();
    assert.equal(app.world.stats.deaths, 0);
    Object.assign(app.world.player, { fuel: 0, landedOn: null, x: 5000, y: -5000 });
    app.updateHud({});
    nodes.get('selfDestructButton').fire('click');
    assert.equal(app.world.stats.deaths, 1);
});

test('refresh can resume within thirty seconds but expires after the reconnect allowance', () => {
    const storage = memoryStorage();
    const first = harness(storage); first.app.newSession();
    first.app.world.player.cargo = 9; first.app.checkpoint();
    const resumed = harness(storage, 110000);
    assert.equal(resumed.app.hasSession, true);
    assert.equal(resumed.app.world.id, first.app.world.id);
    assert.ok(resumed.app.world.player.cargo >= 9);
    const expired = harness(storage, 141001);
    assert.equal(expired.app.hasSession, false);
    assert.equal(expired.app.store.records().length, 1);
    assert.match(expired.nodes.get('saveNote').textContent, /expired/);
});

test('fuel overlay reports idle, braking, and combined draws and map changes do not change ownership', () => {
    const { app, nodes } = harness(); app.newSession();
    app.updateHud({}); assert.equal(nodes.get('fuelUsageFill').style.clipPath, 'inset(0 0 0 100%)');
    app.updateHud({ rcsY: 1 }); const brake = 100 - Number(nodes.get('fuelUsageFill').style.clipPath.match(/([\d.]+)%/)[1]);
    assert.ok(brake > 0 && brake < 30);
    app.updateHud({ burn: true, rcsY: 1, rotate: 1 });
    assert.ok(100 - Number(nodes.get('fuelUsageFill').style.clipPath.match(/([\d.]+)%/)[1]) > brake);
    nodes.get('mapCanvas').fire('click', { clientX: 50, clientY: 50 });
    assert.equal(app.world.target.bodyId, bodies[1].id);
    assert.equal(app.ownedCount(), 1);
});

test('invalid saves and denied storage do not prevent starting a fresh local game', () => {
    const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
    const { app } = harness(denied);
    app.newSession(); assert.equal(app.hasSession, true);
    assert.equal(validWorld(app.world), true);
    const corrupt = createWorld(); corrupt.player.fuel = NaN;
    assert.equal(validWorld(corrupt), false);
});


test('cargo pickup and held fire produce valid anonymous outcome snapshots', () => {
    const { app, logs } = harness(); app.newSession();
    app.world.pickups.push({ id: 'test-cargo', x: app.world.player.x, y: app.world.player.y,
        vx: 0, vy: 0, amount: 1, expiresAt: 10 });
    stepWorld(app.world, {}, 1);
    stepWorld(app.world, {}, .1);
    app.drainEvents();
    app.keys.add('Space'); app.currentInput();
    stepWorld(app.world, { fire: true, aimAngle: -Math.PI / 2 }, .5);
    app.clearInput();
    const outcomes = logs.filter(event => event.type === 'rocket:conquest');
    assert.ok(outcomes.some(event => event.detail.action === 'cargoPickedUp'));
    assert.ok(outcomes.some(event => event.detail.action === 'shotEnded' && event.detail.amount > 0));
    for (const event of outcomes) assert.ok(safeConquestDetails(event.detail), `Rejected ${event.detail.action}`);
    assert.ok(!JSON.stringify(outcomes).includes('aimAngle'));
});


test('W/S retain thrust controls and removed dash keys do not fire thrusters', () => {
    const { app, page } = harness(); app.newSession();
    for (const code of ['ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyA', 'KeyD']) {
        page.fire('keydown', { code });
        const input = app.currentInput();
        assert.equal(input.burn, false);
        assert.equal(input.rcsY, 0);
        page.fire('keyup', { code });
    }
    page.fire('keydown', { code: 'KeyW' }); assert.equal(app.currentInput().burn, true);
    app.clearInput();
    page.fire('keydown', { code: 'KeyS' }); assert.equal(app.currentInput().rcsY, 1);
});


test('fuel-use overlay extends backward within remaining fuel and hides when consumption stops', () => {
    const { app, nodes } = harness();
    app.newSession();
    assert.equal(nodes.has('usageGauge'), false);
    assert.equal(nodes.has('usageValue'), false);
    assert.match(html, /id="fuelFill"><span id="fuelUsageFill"/);
    const maximum = tuning.mainFuelRate + tuning.rcsFuelRate * 2 + tuning.rotationFuelRate;
    const usage = Math.round(tuning.mainFuelRate / maximum * 100);
    for (const fuel of [100, 50.5, 5, 0.2, 0]) {
        app.world.player.fuel = fuel;
        app.updateHud({ burn: true });
        const leftInset = Number(nodes.get('fuelUsageFill').style.clipPath.match(/([\d.]+)%/)[1]);
        const overlayWidth = fuel * (100 - leftInset) / 100;
        assert.ok(Math.abs(overlayWidth - Math.min(fuel, usage * 0.25)) < 1e-9);
        assert.equal(nodes.get('fuelFill').style.width, `${fuel}%`);
        assert.equal(nodes.get('fuelGauge').attributes['aria-valuenow'], fuel.toFixed(1));
        assert.match(nodes.get('fuelGauge').attributes['aria-valuetext'], /current fuel use/);
        app.updateHud({});
        assert.equal(nodes.get('fuelUsageFill').style.clipPath, 'inset(0 0 0 100%)');
    }
    app.world.player.fuel = 100;
    for (const state of [{ deadUntil: 1, docked: null }, { deadUntil: 0, docked: bodies[1].id }]) {
        Object.assign(app.world.player, state);
        app.updateHud({ burn: true, rcsY: 1 });
        assert.equal(nodes.get('fuelUsageFill').style.clipPath, 'inset(0 0 0 100%)');
    }
});


test('damage updates fuel and emits one white-leak cue and one private-safe outcome per hit', () => {
    const { app, nodes, logs } = harness();
    app.newSession();
    Object.assign(app.world.player, { x: 50000, y: 50000, landedOn: null });
    const bursts = [];
    app.renderer.damageBurst = (world, event) => bursts.push(event);
    app.world.projectiles.push({ id: 'damage-test', owner: 'hostile', source: 'player',
        x: 49900, y: 50000, vx: 30000, vy: 0, radius: 3, expiresAt: 10 });
    stepWorld(app.world);
    app.drainEvents();
    app.drainEvents();
    app.updateHud({});
    assert.equal(nodes.get('fuelValue').textContent, '95.0%');
    assert.equal(bursts.length, 1);
    const outcomes = logs.filter(event => event.type === 'rocket:conquest' && event.detail.action === 'damaged');
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].detail.amount, 5);
    assert.equal(outcomes[0].detail.fuel, 95);
    const projected = safeConquestDetails(outcomes[0].detail);
    assert.ok(projected);
    assert.equal(Object.hasOwn(projected, 'x'), false);
    assert.equal(Object.hasOwn(projected, 'reason'), false);
});


test('damage animates its own overlay once, coexists with usage, and expires without changing actual fuel', () => {
    const { app, nodes, setClock } = harness();
    app.newSession();
    Object.assign(app.world.player, { x: 50000, y: 50000, landedOn: null });
    app.world.projectiles.push({ id: 'overlay-hit', owner: 'hostile', source: 'player',
        x: 49900, y: 50000, vx: 30000, vy: 0, radius: 3, expiresAt: 10 });
    stepWorld(app.world);
    app.drainEvents();
    app.drainEvents();
    assert.equal(app.fuelDamageAmount, 5, 'Repeated event drains must not replay the damage sweep.');
    app.updateHud({});
    let inset = Number(nodes.get('fuelDamageFill').style.clipPath.match(/([\d.]+)%/)[1]);
    assert.ok(Math.abs(95 * (100 - inset) / 100 - 5) < 1e-9);
    assert.equal(nodes.get('fuelUsageFill').style.clipPath, 'inset(0 0 0 100%)');
    app.updateHud({ burn: true });
    const usage = Math.round(tuning.mainFuelRate / (tuning.mainFuelRate + tuning.rcsFuelRate * 2 + tuning.rotationFuelRate) * 100);
    inset = Number(nodes.get('fuelUsageFill').style.clipPath.match(/([\d.]+)%/)[1]);
    assert.ok(Math.abs(95 * (100 - inset) / 100 - usage * 0.25) < 1e-9);
    const damageInset = Number(nodes.get('fuelDamageFill').style.clipPath.match(/([\d.]+)%/)[1]);
    assert.ok(Math.abs(95 * (100 - damageInset) / 100 - 5) < 1e-9);
    assert.equal(nodes.get('fuelValue').textContent, '95.0%');
    assert.equal(nodes.get('fuelGauge').attributes['aria-valuenow'], '95.0');
    setClock(100500);
    app.updateHud({});
    assert.equal(nodes.get('fuelUsageFill').style.clipPath, 'inset(0 0 0 100%)');
    assert.equal(nodes.get('fuelDamageFill').style.clipPath, 'inset(0 0 0 100%)');
    assert.equal(app.world.player.fuel, 95);
    app.fuelDamageAmount = 90;
    app.fuelDamageUntil = 200000;
    app.newSession();
    assert.equal(app.fuelDamageAmount, 0);
    assert.equal(nodes.get('fuelUsageFill').style.clipPath, 'inset(0 0 0 100%)');
});


test('unavailable docking shows an actionable red-dialog reason and clears after success', () => {
    const { app, nodes } = harness(); app.newSession();
    placeAtRelay(app);
    app.world.player.vx = 21;
    app.interact();
    assert.equal(app.world.player.docked, null);
    assert.equal(nodes.get('dockError').hidden, false);
    assert.match(nodes.get('dockError').textContent, /^SLOW DOWN$/);
    app.world.player.angle = Math.PI; app.world.player.vx = 18;
    let animations = 0;
    app.renderer.beginDocking = () => animations++;
    app.interact();
    assert.equal(app.world.player.docked, bodies[1].id);
    assert.equal(nodes.get('dockError').hidden, true);
    assert.equal(animations, 1);
    app.world.player.docked = null;
    app.world.player.x = 1000000;
    app.interact();
    assert.equal(nodes.get('dockError').textContent, 'NOT IN RANGE');
});

// Exercise the real keyboard path and station dialog rather than invoking the engine directly.
test('station docking prompt replaces checks, ignores cursor movement, and E attaches once', () => {
    const { app, page, nodes } = harness();
    app.newSession();
    placeAtRelay(app);
    app.aimCursor = { x: .1, y: .2 };
    app.updateDocking();
    assert.equal(nodes.get('dockDialog').classList.contains('station-dock'), true);
    assert.equal(nodes.get('dockChecks').hidden, true);
    assert.equal(nodes.get('interactLabel').textContent, 'to dock');
    assert.equal(nodes.get('dockDialog').style.top, '275px');
    const position = { ...nodes.get('dockDialog').style };
    app.aimCursor = { x: .9, y: .8 };
    app.updateDocking();
    assert.equal(nodes.get('dockDialog').style.left, position.left);
    assert.equal(nodes.get('dockDialog').style.top, position.top);
    app.world.player.vx = 21;
    page.fire('keydown', { code: 'KeyE' });
    assert.equal(app.world.player.docked, null);
    assert.equal(nodes.get('dockError').hidden, false);
    assert.match(nodes.get('dockError').textContent, /^SLOW DOWN$/);
    app.world.player.vx = 0;
    let animations = 0;
    app.renderer.beginDocking = () => animations++;
    page.fire('keydown', { code: 'KeyE', repeat: true });
    assert.equal(app.world.player.docked, null);
    page.fire('keydown', { code: 'KeyE' });
    assert.equal(app.world.player.docked, bodies[1].id);
    assert.equal(animations, 1);
    assert.equal(nodes.get('dockDialog').classList.contains('station-dock'), false);
    assert.equal(nodes.get('interactLabel').textContent, 'to Detach');
    assert.equal(nodes.get('dockError').hidden, true);
});

// During an active capture, leave E exclusively for progress; out-of-range movement remains the cancel path.
test('capture hides the cancel-capable interaction button while E advances capture', async () => {
    const { app, page, nodes } = harness();
    app.newSession(); placeAtRelay(app);
    app.interactionBody = () => bodies[1].id;
    app.world.planets[bodies[1].id].owner = null;
    delete app.world.planets[bodies[1].id].turrets;
    await app.interact();
    app.updateDocking();
    assert.ok(app.world.hack);
    assert.equal(nodes.get('interactButton').hidden, true);
    assert.equal(nodes.get('hackPanel').hidden, false);
    page.fire('keydown', { code: 'KeyE' });
    assert.equal(app.world.hack.progress, 1);
});


// Shop shortcuts use the same guarded purchase action as clicking and reserve rocket upgrades safely.
test('owned relay shop supports independent T and R purchases without repeated spending', () => {
    const { app, page, nodes } = harness();
    app.newSession();
    app.world.player.cargo = 60;
    page.fire('keydown', { code: 'KeyT' });
    assert.equal(app.world.player.cargo, 60);
    const planet = bodies[1];
    app.world.planets[planet.id].owner = app.world.player.id;
    placeAtRelay(app);
    page.fire('keydown', { code: 'KeyE' });
    assert.equal(nodes.get('upgradePanel').hidden, false);
    assert.equal(nodes.get('rocketUpgradeButton').disabled, false);
    page.fire('keydown', { code: 'KeyR' });
    assert.equal(app.world.player.cargo, 60 - tuning.rocketUpgradeCosts[0]);
    assert.equal(app.world.player.rocketTier, 1);
    page.fire('keydown', { code: 'KeyT' });
    assert.equal(app.world.planets[planet.id].level, 1);
    assert.equal(app.world.player.cargo, 60 - tuning.rocketUpgradeCosts[0] - tuning.upgradeCosts[0]);
    const cargo = app.world.player.cargo;
    page.fire('keydown', { code: 'KeyT', repeat: true });
    assert.equal(app.world.player.cargo, cargo);
    assert.equal(app.world.planets[planet.id].level, 1);
    assert.equal(nodes.get('planetUpgradeLabel').textContent, 'PLANET');
    assert.equal(nodes.get('planetUpgradeCostValue').textContent, String(tuning.upgradeCosts[1]));
    assert.equal(nodes.get('planetUpgradeCost').hidden, false);
    app.world.player.cargo = 0;
    page.fire('keydown', { code: 'KeyT' });
    assert.equal(app.world.planets[planet.id].level, 1);
    assert.equal(app.world.player.cargo, 0);
    assert.equal(app.world.planets[bodies[2].id].level, 0);
});

// Local chat isolates typing from flight and analytics while keeping capture announcements visible.
test('slash chat is local, safe text, bounded, and never leaks messages into game events', () => {
    const { app, page, nodes, logs } = harness();
    app.newSession();
    assert.deepEqual(app.world.target, { bodyId: 'moon', type: 'relay' });
    assert.match(nodes.get('flightMessage').textContent, /flashing arrow.*MOON RELAY/);
    page.fire('keydown', { code: 'KeyW' });
    page.fire('keydown', { code: 'Slash' });
    assert.equal(nodes.get('chatForm').hidden, false);
    assert.equal(page.activeElement, nodes.get('chatInput'));
    assert.equal(app.keys.size, 0);
    const message = '<img src=x onerror=alert(1)> private message';
    nodes.get('chatInput').value = message;
    page.fire('keydown', { code: 'KeyW', target: nodes.get('chatInput') });
    assert.equal(app.keys.size, 0);
    nodes.get('chatForm').fire('submit');
    assert.equal(nodes.get('chatMessages').children.at(-1).textContent, `Pilot: ${message}`);
    assert.equal(nodes.get('chatForm').hidden, true);
    assert.equal(JSON.stringify(logs).includes(message), false);
    assert.equal(JSON.stringify(app.world).includes(message), false);
    for (let index = 0; index < 50; index++) app.appendChat(String(index));
    assert.equal(nodes.get('chatMessages').children.length, 40);
    let animation;
    app.renderer.beginCapture = (...args) => { animation = args; };
    app.world.events.push({ type: 'captured', bodyId: 'moon', seq: app.world.eventCounter + 1 });
    app.drainEvents();
    assert.equal(nodes.get('chatMessages').children.at(-1).textContent, 'Pilot conquered Moon');
    assert.equal(nodes.get('chatMessages').children.at(-1).style.color, app.world.player.color);
    assert.deepEqual(animation, ['moon', app.world.player.color]);
});

// Feedback identifies the typed digit without replacing the next challenge or adding panel clutter.
test('capture panel shows a square key cue and green/red feedback with progress only', () => {
    const { app, page, nodes } = harness();
    app.newSession(); placeAtRelay(app); app.interact();
    assert.equal(nodes.get('dockTitle').textContent, 'CAPTURE PLANET');
    assert.equal(nodes.get('dockDialog').classList.contains('is-hacking'), true);
    assert.equal(nodes.has('hackCount'), false);
    const flashes = [];
    nodes.get('digitButton').animate = frames => { flashes.push(frames); };
    const digit = app.world.hack.digit;
    page.fire('keydown', { code: `Digit${(digit + 1) % 10}` });
    assert.equal(flashes.at(-1)[0].backgroundColor, '#ff6666');
    assert.equal(app.world.hack.progress, 0);
    page.fire('keydown', { code: `Digit${digit}` });
    assert.equal(flashes.at(-1)[0].backgroundColor, '#8cdeb0');
    assert.equal(app.world.hack.progress, 1);
    assert.equal(nodes.get('hackGauge').attributes['aria-valuenow'], '25');
});

// Online presentation must never run a second local simulation or deduct resources on its own.
test('online app sends commands while authoritative snapshots own movement and purchases', async () => {
    const commands = [], inputs = [];
    let callbacks;
    const fake = { token: '', connected: false,
        async connect() {
            this.connected = true;
            const world = createWorld(); world.others = []; world.online = 2;
            callbacks.onWorld(world, { joined: true });
        },
        input(value) { inputs.push(value); },
        async action(action, details) { commands.push({ action, details }); return { ok: true }; }
    };
    const { app, nodes } = harness(memoryStorage(), 100000, { serverUrl: 'wss://service.example/game',
        connectionFactory: options => { callbacks = options; return fake; } });
    await app.joinMultiplayer();
    assert.match(nodes.get('gameModeLabel').textContent, /MULTIPLAYER/);
    const before = structuredClone(app.world.player);
    app.frame(1000); app.frame(1100);
    assert.ok(inputs.length > 0);
    assert.equal(app.world.elapsed, 0);
    assert.equal(app.world.player.x, before.x);
    assert.equal(app.world.player.fuel, before.fuel);
    app.world.player.cargo = 60;
    await app.rocketUpgrade();
    assert.equal(commands.at(-1).action, 'rocketUpgrade');
    assert.equal(app.world.player.cargo, 60);
    assert.equal(app.world.player.rocketTier, undefined);
    callbacks.onWorld({ ...app.world, player: { ...app.world.player, rocketTier: 1, cargo: 52 } });
    assert.equal(app.world.player.rocketTier, 1);
    assert.equal(app.world.player.cargo, 52);
});

// The death overlay must explain the persistent tier change before the normal automatic respawn.
test('death notice identifies the lost rocket tier and never reports a tier below zero', () => {
    const { app, nodes } = harness(); app.newSession();
    app.world.player.rocketTier = 3;
    killPlayer(app.world, 'Star contact.'); app.drainEvents(); app.updateHud({});
    assert.equal(app.world.player.rocketTier, 2);
    assert.equal(nodes.get('respawnNotice').hidden, false);
    assert.match(nodes.get('respawnNotice').textContent, /TIER 3 → TIER 2/);
    stepWorld(app.world, {}, 1); app.updateHud({});
    assert.equal(nodes.get('respawnNotice').hidden, true);
    app.world.player.rocketTier = 0;
    killPlayer(app.world); app.drainEvents(); app.updateHud({});
    assert.equal(app.world.player.rocketTier, 0);
    assert.equal(nodes.get('respawnNotice').textContent.includes('TIER'), false);
});

// System activity shares the bounded chat feed without adding a fake speaker prefix or logging text.
test('room announcements display literal safe text in the generated pilot color', () => {
    const { app, nodes, logs } = harness();
    const count = logs.length;
    app.appendChat('Pilot 2 rejoined the galaxy.', false, { system: true, color: '#ff9fb8' });
    const row = nodes.get('chatMessages').children.at(-1);
    assert.equal(row.textContent, 'Pilot 2 rejoined the galaxy.');
    assert.equal(row.style.color, '#ff9fb8');
    assert.equal(logs.length, count);
});

// Exercise the new E-only capture control through the actual page's keyboard handlers.
test('E advances capture without cancelling; held keys and number keys do not advance it', () => {
    const { app, page, nodes } = harness(); app.newSession();
    const body = bodies.find(body => body.id === 'moon');
    Object.assign(app.world.player, { x: body.x, y: body.y - body.radius - 150, landedOn: null, docked: null });
    app.captureBody = () => body.id;
    page.fire('keydown', { code: 'KeyE' }); page.fire('keyup', { code: 'KeyE' });
    assert.ok(app.world.hack); assert.equal(nodes.get('digitButton').textContent, 'E');
    app.world.elapsed += .11;
    page.fire('keydown', { code: 'KeyE' });
    assert.equal(app.world.hack.progress, 1);
    page.fire('keydown', { code: 'KeyE', repeat: true });
    page.fire('keydown', { code: 'Digit1' });
    assert.equal(app.world.hack.progress, 1);
    page.fire('keyup', { code: 'KeyE' });
    app.world.elapsed += .11; app.captureBody = () => null;
    page.fire('keydown', { code: 'KeyE' });
    assert.equal(app.world.hack.progress, 2);
});

// Keep the main shop action simple and expose both independent rocket tracks on planets.
test('planet shop shows BOOSTER and WEAPON and replaces its upgrade action with REPAIR TURRETS', () => {
    const { app, nodes } = harness(); app.newSession();
    const body = bodies.find(body => body.id === 'moon');
    Object.assign(app.world.player, { x: body.x, y: body.y - body.radius - 150, landedOn: null, docked: null, cargo: 100 });
    app.world.planets[body.id].owner = app.world.player.id;
    app.captureBody = () => body.id; app.interact();
    assert.equal(nodes.get('rocketUpgradeLabel').textContent, 'BOOSTER 0/10');
    assert.equal(nodes.get('weaponUpgradeLabel').textContent, 'WEAPON 0/10');
    app.rocketUpgrade(); app.weaponUpgrade();
    assert.equal(app.world.player.rocketTier, 1); assert.equal(app.world.player.weaponTier, 1);
    app.upgrade();
    const planet = app.world.planets[body.id];
    Object.assign(planet.turrets[0], { health: 0, repairAt: app.world.elapsed + 5 });
    app.updateHud({});
    assert.equal(nodes.get('planetUpgradeLabel').textContent, 'REPAIR TURRETS');
    assert.equal(nodes.get('upgradeButton').disabled, true);
    app.world.elapsed += 5; app.updateHud({});
    const cargo = app.world.player.cargo;
    app.upgrade();
    assert.equal(planet.turrets[0].health, 1); assert.equal(planet.level, 1);
    assert.equal(app.world.player.cargo, cargo - 2);
    assert.equal(nodes.get('planetUpgradeLabel').textContent, 'PLANET');
});

// Both independent track losses must remain visible during the respawn period.
test('death notice names BOOSTER and WEAPON level loss together', () => {
    const { app, nodes } = harness(); app.newSession();
    Object.assign(app.world.player, { rocketTier: 6, weaponTier: 10 });
    killPlayer(app.world, 'Test'); app.drainEvents(); app.updateHud({});
    assert.match(nodes.get('respawnNotice').textContent, /BOOSTER 6 → 5/);
    assert.match(nodes.get('respawnNotice').textContent, /WEAPON 10 → 9/);
});

// Check that choosing a rival in the live board sends only the requested escrow amount.
test('leaderboard row opens the bounty form and posts an amount to the server', async () => {
    let callbacks;
    const commands = [];
    const fake = { token: '', async action(action, details) {
        commands.push({ action, details }); return { ok: true };
    } };
    const { app, nodes } = harness(memoryStorage(), 100000, { serverUrl: 'wss://service.example/game',
        connectionFactory: options => { callbacks = options; return fake; } });
    const world = createWorld();
    world.player.cargo = 12;
    // Intro banners use browser timers, which do not need to run for this test.
    app.browserWindow.clearTimeout = () => {};
    app.browserWindow.setTimeout = () => 1;
    world.leaderboard = [
        { id: 'rival', label: 'Pilot 2', color: '#ff9fb8', held: 3, bounty: 4 },
        { id: world.player.id, label: 'Pilot 1', color: '#8cdeb0', held: 0, bounty: 0 }
    ];
    callbacks.onWorld(world, { joined: true });
    assert.equal(nodes.get('territoryBoard').hidden, false);
    nodes.get('territoryBoard').open = true;
    nodes.get('territoryBoard').fire('toggle');
    const [rival, own] = nodes.get('territoryRows').children;
    assert.equal(rival.children[1].textContent, 3);
    assert.equal(own.children[0].tagName, 'SPAN');
    rival.children[0].fire('click');
    assert.equal(nodes.get('bountyForm').hidden, false);
    assert.equal(nodes.get('bountyAmount').max, '12');
    nodes.get('bountyAmount').value = '5';
    await app.postBounty();
    assert.deepEqual(commands, [{ action: 'placeBounty', details: { targetId: 'rival', amount: 5 } }]);
    assert.equal(app.world.player.cargo, 12);
    assert.equal(nodes.get('bountyForm').hidden, true);
    assert.match(nodes.get('bountyStatus').textContent, /5 cargo/);
});
