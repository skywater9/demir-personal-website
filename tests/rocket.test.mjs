import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bodies, route, tuning, createRun, routeBody, gravityAt, stepRun, targetFor, stationFor,
    dockingPoint, tryDock, dockingStatus, recordRunEvent
} from '../public/scripts/rocketPhysics.mjs';
import { RunStore, isValidRun, saveKey } from '../public/scripts/rocketStorage.mjs';

// Create isolated synchronous storage so persistence behavior is tested without a browser.
function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
}

// Move a run into a valid bay approach to test actual payload and route transitions.
function placeAtStation(run) {
    Object.assign(run, dockingPoint(routeBody(run.routeIndex)), { vx: 0, vy: 0, landedOn: null, docked: false });
}

test('route includes Moon, return to Earth, and all outer planets in the agreed order', () => {
    assert.deepEqual(route, ['earth', 'moon', 'venus', 'mercury', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
    assert.equal(routeBody(0), routeBody(4));
    const run = createRun('test-run', 1000);
    assert.equal(run.fuel, 100);
    assert.equal(run.landedOn, 'earth');
    assert.equal(run.payload, true);
    assert.equal(isValidRun(run), true);
});

test('destination gravity changes and falls to zero outside the local influence zone', () => {
    for (const body of bodies) {
        const surface = gravityAt(body.x, body.y - body.radius);
        assert.ok(Math.abs(surface.magnitude - body.gravity) < 0.001, body.name);
        const parked = gravityAt(body.x, body.y - body.radius - tuning.shipRadius);
        assert.ok(Math.abs(parked.magnitude - body.gravity) < 0.001, `${body.name} pad`);
        assert.ok(gravityAt(body.x, body.y - body.radius - 600).magnitude < surface.magnitude);
    }
    assert.equal(gravityAt(0, -5000).magnitude, 0);
});

test('main engine launches on Earth and Jupiter; translation thrusters consume less fuel', () => {
    for (const id of ['earth', 'jupiter']) {
        const body = bodies.find(item => item.id === id);
        const run = createRun();
        Object.assign(run, { x: body.x, y: body.y - body.radius - tuning.shipRadius, throttle: 1, landedOn: id });
        stepRun(run, { burn: true });
        assert.ok(run.vy < 0, id);
    }
    const main = createRun();
    const rcs = createRun();
    stepRun(main, { burn: true });
    stepRun(rcs, { rcsY: -1 });
    assert.ok(main.fuel < rcs.fuel);
});

test('empty fuel loses instantly even when landed; excessive impact speed also loses', () => {
    const empty = createRun();
    empty.fuel = 0;
    stepRun(empty);
    assert.equal(empty.status, 'lost');
    assert.equal(empty.reason, 'Fuel depleted.');
    const impact = createRun();
    impact.landedOn = null;
    impact.y -= 0.01;
    impact.vy = 20;
    stepRun(impact);
    assert.equal(impact.status, 'lost');
    assert.match(impact.reason, /Impact on Earth/);
});

test('docking rejects excess speed, wrong rotation and missing player action', () => {
    const run = createRun();
    placeAtStation(run);
    run.vx = 6;
    assert.equal(tryDock(run), false);
    run.vx = 0;
    run.angle = 0.5;
    assert.equal(tryDock(run), false);
    run.angle = 0;
    assert.equal(dockingStatus(run).ready, true);
    stepRun(run);
    assert.equal(run.delivered, 0);
    assert.equal(tryDock(run), true);
    assert.equal(run.delivered, 1);
    assert.equal(run.payload, false);
    assert.equal(targetFor(run).body.id, 'moon');
    assert.equal(tryDock(run), false);
});

test('safe upright next-pad landing refuels once; off-pad and misaligned contacts do not service', () => {
    const moon = routeBody(1);
    for (const [offset, angle] of [[70, 0], [0, 0.5], [0, 0]]) {
        const run = createRun();
        Object.assign(run, { phase: 'planet', delivered: 1, payload: false, fuel: 40,
            x: moon.x + offset, y: moon.y - Math.sqrt((moon.radius + tuning.shipRadius - 0.01) ** 2 - offset ** 2), vx: 0, vy: 1, angle, landedOn: null });
        stepRun(run);
        assert.equal(run.landedOn, 'moon');
        if (offset === 0 && angle === 0) {
            assert.equal(run.routeIndex, 1);
            assert.equal(run.payload, true);
            assert.equal(run.fuel, 74);
            stepRun(run);
            assert.equal(run.fuel, 74);
        } else {
            assert.equal(run.routeIndex, 0);
            assert.equal(run.fuel, 40);
        }
    }
});

test('station hull, solar panels, and antenna cause excessive-speed collisions', () => {
    const station = stationFor(routeBody(0));
    for (const [x, y] of [[-80, 0], [-80, -50], [90, 0]]) {
        const run = createRun();
        Object.assign(run, { x: station.x + x, y: station.y + y,
            vx: x < 0 ? 80 : -80, vy: 0, landedOn: null });
        for (let frame = 0; frame < 100 && run.status === 'active'; frame += 1) stepRun(run);
        assert.equal(run.status, 'lost', `${x},${y}`);
        assert.match(run.reason, /Station collision/);
    }
});

test('swept collisions catch fast station crossings and glancing planetary contacts', () => {
    const station = stationFor(routeBody(0));
    const crossing = createRun();
    Object.assign(crossing, { x: station.x - 100, y: station.y - 50, vx: 24000, vy: 0, landedOn: null });
    stepRun(crossing);
    assert.equal(crossing.status, 'lost');
    assert.match(crossing.reason, /Station collision/);
    const moon = routeBody(1);
    const grazing = createRun();
    Object.assign(grazing, { x: moon.x - 10, y: moon.y - moon.radius - tuning.shipRadius + 0.01,
        vx: 2400, vy: 0, landedOn: null });
    stepRun(grazing);
    assert.equal(grazing.status, 'lost');
    assert.match(grazing.reason, /Impact on Moon/);
});

test('main thrust and left translation can release safely from each non-final relay', () => {
    for (let index = 0; index < route.length - 1; index += 1) {
        for (const input of [{ burn: true }, { rcsX: -1 }]) {
            const run = createRun();
            Object.assign(run, { routeIndex: index, delivered: index, serviced: Array.from({ length: index + 1 }, (_, position) => position) });
            placeAtStation(run);
            assert.equal(tryDock(run), true);
            for (let frame = 0; frame < 120; frame += 1) stepRun(run, input);
            assert.equal(run.status, 'active', `${route[index]}: ${run.reason}`);
            assert.equal(run.docked, false);
        }
    }
});

test('stale tabs cannot erase terminal records or resurrect completed progress', () => {
    const storage = memoryStorage();
    const firstTab = new RunStore(storage);
    const run = createRun();
    firstTab.saveActive(run);
    const staleTab = new RunStore(storage);
    const stale = staleTab.getActive();
    run.status = 'lost';
    run.reason = 'Fuel depleted.';
    run.fuel = 0;
    firstTab.archive(run);
    assert.equal(staleTab.saveActive(stale), false);
    assert.equal(staleTab.saveActive(stale, { claim: true }), false);
    const reloaded = new RunStore(storage);
    assert.equal(reloaded.getActive(), null);
    assert.equal(reloaded.getHistory()[0].status, 'lost');
});

test('only the latest explicitly continued tab can checkpoint an unfinished flight', () => {
    const storage = memoryStorage();
    const firstTab = new RunStore(storage);
    const run = createRun();
    firstTab.saveActive(run);
    const secondTab = new RunStore(storage);
    const continued = secondTab.getActive();
    assert.equal(secondTab.saveActive(continued), false);
    assert.equal(secondTab.saveActive(continued, { claim: true }), true);
    assert.equal(firstTab.ownsActive(run.id), false);
    assert.equal(firstTab.saveActive(run), false);
    assert.equal(secondTab.ownsActive(run.id), true);
    continued.elapsed = 20;
    secondTab.saveActive(continued);
    assert.equal(firstTab.getActive().elapsed, 20);
});

test('shared lock serializes an interleaved checkpoint, takeover, and archive without erasing results', async () => {
    let pending = Promise.resolve();
    const lockManager = {
        // Queue whole critical sections rather than allowing read/check/write actions to interleave.
        request(name, action) {
            const result = pending.then(action);
            pending = result.catch(() => {});
            return result;
        }
    };
    const base = memoryStorage();
    let onRead = null;
    const storage = {
        // Inject another tab's request after a read but before the first tab can write.
        getItem(key) {
            const result = base.getItem(key);
            const callback = onRead;
            onRead = null;
            callback?.();
            return result;
        },
        // Keep writes synchronous, just as browser local storage does.
        setItem(key, value) { base.setItem(key, value); }
    };
    const first = new RunStore(storage, () => {}, { lockManager });
    const run = createRun();
    await first.transaction(() => first.saveActive(run));
    const second = new RunStore(storage, () => {}, { lockManager });
    let takeover;
    onRead = () => {
        takeover = second.transaction(() => {
            const saved = second.getActive();
            second.saveActive(saved, { claim: true });
            saved.status = 'lost';
            saved.fuel = 0;
            saved.reason = 'Fuel depleted.';
            return second.archive(saved);
        });
    };
    await first.transaction(() => first.saveActive(run));
    await takeover;
    assert.equal(first.saveActive(run), false);
    assert.equal(first.getActive(), null);
    assert.equal(first.getHistory()[0].status, 'lost');
});

test('browsers without safe cross-tab locking use visible memory-only persistence', () => {
    const warnings = [];
    const store = new RunStore(memoryStorage(), message => warnings.push(message), { requireLocks: true });
    assert.equal(store.available, false);
    store.transaction(() => store.saveActive(createRun()));
    assert.ok(store.getActive());
    assert.equal(warnings.length, 1);
});

test('save validation rejects contradictory route, payload, delivery, and service states', () => {
    for (const changes of [
        { routeIndex: 9, phase: 'planet', delivered: 9 },
        { payload: false }, { delivered: 8 }, { serviced: [] },
        { serviced: [0, 0] }, { docked: true }, { id: '' }
    ]) assert.equal(isValidRun({ ...createRun(), ...changes }), false);
});

test('complete all ten deliveries through actual docking and landing transitions', () => {
    const run = createRun();
    for (let index = 0; index < route.length; index += 1) {
        assert.equal(run.routeIndex, index);
        placeAtStation(run);
        assert.equal(tryDock(run), true);
        assert.equal(run.delivered, index + 1);
        if (index < route.length - 1) {
            const next = routeBody(index + 1);
            Object.assign(run, { x: next.x, y: next.y - next.radius - 17.99, vx: 0, vy: 1,
                angle: 0, docked: false, landedOn: null, fuel: 50 });
            stepRun(run);
            assert.equal(run.phase, 'station');
            assert.ok(run.fuel > 50);
        }
    }
    assert.equal(run.status, 'won');
    assert.equal(isValidRun(run), true);
});

test('a stationary rocket can align on the next pad and receive service without burning again', () => {
    const run = createRun();
    const moon = routeBody(1);
    Object.assign(run, { phase: 'planet', payload: false, delivered: 1, fuel: 40,
        x: moon.x, y: moon.y - moon.radius - tuning.shipRadius,
        landedOn: 'moon', angle: 0.3 });
    for (let index = 0; index < 10; index += 1) stepRun(run, { rotate: -1 });
    assert.equal(run.routeIndex, 1);
    assert.equal(run.payload, true);
    assert.ok(run.fuel > 73);
});

test('saved progress resumes all physics state without adding time away and results survive reload', () => {
    const storage = memoryStorage();
    const store = new RunStore(storage);
    const run = createRun();
    stepRun(run, { burn: true });
    recordRunEvent(run, 'left', 5000);
    store.saveActive(run);
    const restoredStore = new RunStore(storage);
    const restored = restoredStore.getActive();
    assert.deepEqual(restored, run);
    assert.equal(restored.elapsed, tuning.fixedStep);
    restoredStore.saveActive(restored, { claim: true });
    restored.status = 'lost';
    restored.reason = 'Fuel depleted.';
    restored.fuel = 0;
    assert.equal(restoredStore.archive(restored), true);
    restoredStore.archive(restored);
    const reloaded = new RunStore(storage);
    assert.equal(reloaded.getActive(), null);
    assert.equal(reloaded.getHistory().length, 1);
    assert.equal(reloaded.getHistory()[0].fuel, 0);
});

test('malformed saves are rejected and blocked storage falls back without stopping gameplay', () => {
    const warnings = [];
    const storage = memoryStorage({ [saveKey]: '{invalid' });
    const store = new RunStore(storage, message => warnings.push(message));
    assert.equal(store.getActive(), null);
    assert.equal(warnings.length, 1);
    for (const changes of [{ fuel: NaN }, { routeIndex: 40 }, { throttle: 3 }, { events: [{}] }, { x: Infinity }]) {
        assert.equal(isValidRun({ ...createRun(), ...changes }), false);
    }
    const blocked = new RunStore({ getItem() { return null; }, setItem() { throw new Error('Quota'); } }, message => warnings.push(message));
    assert.equal(blocked.saveActive(createRun()), true);
    assert.equal(blocked.available, false);
    assert.ok(blocked.getActive());
});
