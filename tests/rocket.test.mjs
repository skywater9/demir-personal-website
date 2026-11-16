import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bodies, route, tuning, createRun, routeBody, gravityAt, stepRun, targetFor,
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
            x: moon.x + offset, y: moon.y - moon.radius - 17, vx: 0, vy: 1, angle, landedOn: null });
        stepRun(run);
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
