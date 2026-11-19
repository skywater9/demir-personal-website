import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld, tuning } from '../public/scripts/conquestPhysics.mjs';
import { ConquestApp } from '../public/scripts/conquestApp.mjs';
import { ConquestRenderer } from '../public/scripts/conquestRenderer.mjs';

// Isolate attitude control from gravity, contacts, and pad service.
function flyingWorld() {
    const world = createWorld();
    Object.assign(world.player, { x: 0, y: -40000, landedOn: null });
    return world;
}

// Exercise actual cursor transforms and draw commands without browser dependencies.
function rendererFixture(world) {
    const calls = [];
    const context = new Proxy({}, {
        get(target, name) {
            if (name in target) return target[name];
            return (...args) => calls.push([name, ...args]);
        },
        set(target, name, value) { target[name] = value; return true; }
    });
    const canvas = { width: 400, height: 200, getContext: () => context,
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 400 }) };
    canvas.parentElement = { getBoundingClientRect: canvas.getBoundingClientRect };
    const renderer = new ConquestRenderer(canvas, canvas);
    renderer.camera = { x: world.player.x, y: world.player.y, zoom: 1 };
    return { renderer, canvas, calls };
}

// Build only the controller state needed to verify real pointer and held-input handling.
function aimingApp(world, renderer, canvas) {
    const app = Object.create(ConquestApp.prototype);
    Object.assign(app, { world, renderer, mode: 'flight', ui: { flightCanvas: canvas, controlsHint: { style: {} } }, page: {},
        pointers: new Map(), keys: new Set(), loggedActions: new Set(), heldButtons: [],
        aimSet: false, aimCursor: null, firing: false, log() {}, emit() {} });
    return app;
}

test('cursor steering accelerates from rest and catches up without snapping or oscillating', () => {
    const world = flyingWorld();
    stepWorld(world, { aimAngle: 0 });
    const initialRate = world.player.rotationVelocity;
    assert.ok(initialRate > 0 && initialRate <= tuning.aimRotationAcceleration * tuning.fixedStep + 1e-10);
    assert.ok(world.player.angle > 0 && world.player.angle <= tuning.aimRotationAcceleration * tuning.fixedStep ** 2 + 1e-10);
    for (let frame = 0; frame < 480; frame++) {
        const previousRate = world.player.rotationVelocity;
        stepWorld(world, { aimAngle: 0 });
        assert.ok(Math.abs(world.player.rotationVelocity) <= tuning.maxAimRotationRate + 1e-10);
        assert.ok(Math.abs(world.player.rotationVelocity - previousRate) <= tuning.aimRotationAcceleration * tuning.fixedStep + 1e-8);
        assert.ok(world.player.angle <= Math.PI / 2 + 1e-8);
    }
    assert.ok(Math.abs(world.player.angle - Math.PI / 2) < 0.001);
});

test('fast aim reversal brakes existing angular motion before turning back', () => {
    const world = flyingWorld();
    for (let frame = 0; frame < 30; frame++) stepWorld(world, { aimAngle: 0 });
    const previousRate = world.player.rotationVelocity;
    stepWorld(world, { aimAngle: Math.PI });
    assert.ok(world.player.rotationVelocity > 0, 'A fast cursor reversal must preserve brief turning momentum.');
    assert.ok(world.player.rotationVelocity < previousRate);
    for (let frame = 0; frame < 60; frame++) stepWorld(world, { aimAngle: Math.PI });
    assert.ok(world.player.rotationVelocity < 0);
});

test('mouse steering uses the shortest arc across the angle boundary', () => {
    const world = flyingWorld();
    world.player.angle = Math.PI - 0.02;
    const aimAngle = -Math.PI + 0.02 - Math.PI / 2;
    stepWorld(world, { aimAngle });
    assert.ok(world.player.rotationVelocity > 0);
    for (let frame = 0; frame < 240; frame++) stepWorld(world, { aimAngle });
    assert.ok(Math.abs(world.player.angle - (-Math.PI + 0.02)) < 0.001);
});

test('mouse steering consumes attitude fuel, respects empty tanks and keeps thrust along the actual nose', () => {
    const world = flyingWorld();
    const coasting = structuredClone(world);
    stepWorld(coasting, { aimAngle: 0 });
    stepWorld(world, { aimAngle: 0, burn: true });
    const thrustDelta = tuning.mainAcceleration * tuning.fixedStep;
    assert.ok(Math.abs(world.player.vx - coasting.player.vx - Math.sin(world.player.angle) * thrustDelta) < 1e-9);
    assert.ok(Math.abs(world.player.vy - coasting.player.vy + Math.cos(world.player.angle) * thrustDelta) < 1e-9);
    assert.ok(world.player.fuel < 100);
    world.player.fuel = 0;
    const angle = world.player.angle;
    stepWorld(world, { aimAngle: Math.PI });
    assert.ok(Math.abs(world.player.angle - angle) <= Number.EPSILON,
        'An empty tank must preserve heading within floating-point normalization precision.');
    assert.equal(world.player.rotationVelocity, 0);
});

test('normalized cursor remains under the pointer while the camera moves and A/D do not steer', () => {
    const world = flyingWorld();
    const { renderer, canvas } = rendererFixture(world);
    const app = aimingApp(world, renderer, canvas);
    app.aimAt({ clientX: 700, clientY: 250 });
    assert.deepEqual(app.aimCursor, { x: 0.75, y: 0.5 });
    assert.equal(app.currentInput().aimAngle, 0);
    renderer.camera.y += 100;
    const input = app.currentInput();
    assert.ok(input.aimAngle > 0, 'Stationary mouse aim must be recalculated after camera movement.');
    for (const key of ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight']) app.keys.add(key);
    assert.equal(app.currentInput().rotate, 0);
    assert.deepEqual(input.aimCursor, { x: 0.75, y: 0.5 });
});

test('renderer draws a dashed rocket-to-cursor guide and a small cursor at CSS-scaled coordinates', () => {
    const world = flyingWorld();
    const { renderer, calls } = rendererFixture(world);
    renderer.drawAimGuide(world.player, { x: 0.75, y: 0.25 });
    assert.ok(calls.some(call => call[0] === 'setLineDash' && call[1][0] === 3));
    assert.ok(calls.some(call => call[0] === 'moveTo' && call[1] === 200 && call[2] === 100));
    assert.ok(calls.some(call => call[0] === 'lineTo' && call[1] === 300 && call[2] === 50));
    assert.equal(calls.filter(call => call[0] === 'stroke').length, 2);
    assert.equal(renderer.aimAt(500, 250, world.player), world.player.angle - Math.PI / 2,
        'Placing the cursor on the rocket must not produce an arbitrary rightward turn.');
});


test('faster mouse following aligns a right-angle turn within 0.8 seconds without snapping', () => {
    const world = flyingWorld();
    stepWorld(world, { aimAngle: 0 });
    assert.ok(world.player.angle > 0 && world.player.angle <= tuning.aimRotationAcceleration * tuning.fixedStep ** 2 + 1e-10);
    for (let frame = 1; frame < 96; frame++) stepWorld(world, { aimAngle: 0 });
    assert.ok(Math.abs(world.player.angle - Math.PI / 2) < Math.PI / 180,
        'The nose should be within one degree of the cursor within 0.8 seconds.');
    assert.equal(tuning.mainAcceleration, 240);
    assert.equal(tuning.aimRotationAcceleration, 150);
});
