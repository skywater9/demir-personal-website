import test from 'node:test';
import assert from 'node:assert/strict';
import { RocketRenderer } from '../public/scripts/rocketRenderer.mjs';
import { createRun, dockingPoint, routeBody, targetFor } from '../public/scripts/rocketPhysics.mjs';

// Record canvas labels and enforce finite geometry without requiring a live browser.
function makeRenderer() {
    const labels = [];
    const context = new Proxy({}, {
        // Return ordinary canvas operations while retaining label text for guidance assertions.
        get(target, name) {
            if (name in target) return target[name];
            return (...args) => {
                for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value));
                if (name === 'fillText') labels.push(args[0]);
            };
        },
        // Permit style and alpha updates just as a normal 2D canvas context does.
        set(target, name, value) { target[name] = value; return true; }
    });
    const canvas = { width: 400, height: 260, clientWidth: 800, clientHeight: 520, getContext: () => context };
    const map = { width: 268, height: 55, getContext: () => context };
    return { renderer: new RocketRenderer(canvas, map), labels };
}

test('rotation fires opposing attitude jets and reverses the pair for the opposite turn', () => {
    const { renderer } = makeRenderer();
    const run = createRun();
    for (const turn of [-1, 1]) {
        const jets = renderer.exhaustJets(run, { rotate: turn });
        assert.equal(jets.length, 2);
        assert.ok(jets.every(jet => jet.kind === 'attitude'));
        assert.equal(jets[0].dx, -jets[1].dx);
        assert.equal(Math.sign(-jets[0].y * -jets[0].dx), turn);
        renderer.drawRocket(run, { rotate: turn });
        renderer.updateExhaust(run, { rotate: turn }, 0.05);
        assert.ok(renderer.particles.some(particle => particle.kind === 'attitude'));
    }
    run.fuel = 0;
    assert.deepEqual(renderer.exhaustJets(run, { burn: true, rotate: 1, rcsX: 1 }), []);
});

test('forward and brake exhaust oppose their rocket-relative thrust when tilted', () => {
    const { renderer } = makeRenderer();
    const run = createRun();
    run.angle = Math.PI / 2;
    for (const direction of [-1, 1]) {
        const jets = renderer.exhaustJets(run, { rcsY: direction });
        assert.equal(jets.length, 1);
        const jet = jets[0];
        assert.equal(jet.y, -direction * 10);
        const worldX = jet.dx * Math.cos(run.angle) - jet.dy * Math.sin(run.angle);
        const worldY = jet.dx * Math.sin(run.angle) + jet.dy * Math.cos(run.angle);
        assert.ok(Math.abs(worldX - direction) < 1e-10);
        assert.ok(Math.abs(worldY) < 1e-10);
    }
});

test('world-space particles inherit rocket motion then trail behind rather than staying attached', () => {
    const { renderer } = makeRenderer();
    const run = createRun();
    Object.assign(run, { x: 0, y: -2000, vx: 200, vy: 0, throttle: 1, landedOn: null });
    renderer.updateExhaust(run, { burn: true }, 0.05);
    assert.ok(renderer.particles.length > 0);
    const first = renderer.particles[0];
    assert.ok(first.vx > 180 && first.vx < 220, 'Exhaust must inherit sideways rocket velocity.');
    assert.ok(first.vy > 200, 'Upright main exhaust starts below the rocket.');
    const initial = { ...first };
    for (let frame = 0; frame < 5; frame++) {
        run.x += run.vx * 0.05;
        renderer.updateExhaust(run, {}, 0.05);
    }
    assert.ok(first.x < run.x - 5, 'Older exhaust should visibly lag behind a fast rocket.');
    assert.ok(first.y > initial.y);
    assert.ok(first.life < initial.life);
    assert.equal(run.fuel, 100, 'Visual particles must not change physics or fuel.');
    renderer.drawExhaust();
    for (let frame = 0; frame < 30; frame++) renderer.updateExhaust(run, {}, 0.05);
    assert.equal(renderer.particles.length, 0);
});

test('exhaust is bounded, resets between runs and menus, and respects reduced motion', () => {
    const { renderer } = makeRenderer();
    const run = createRun();
    for (let frame = 0; frame < 200; frame++) renderer.updateExhaust(run, { burn: true, rotate: 1, rcsX: 1, rcsY: -1 }, 0.05);
    assert.ok(renderer.particles.length > 0 && renderer.particles.length <= 360);
    renderer.updateExhaust(createRun(), {}, 0);
    assert.equal(renderer.particles.length, 0);
    renderer.updateExhaust(run, { burn: true }, 0.05);
    renderer.updateExhaust(run, {}, 0.05, true);
    assert.equal(renderer.particles.length, 0);
    renderer.reducedMotion = true;
    renderer.updateExhaust(run, { burn: true, rotate: 1 }, 0.05);
    assert.equal(renderer.particles.length, 0);
});

test('distance is drawn with both the visible target marker and offscreen flashing arrow', () => {
    const { renderer, labels } = makeRenderer();
    const run = createRun();
    const bay = dockingPoint(routeBody(0));
    renderer.camera = { x: bay.x, y: bay.y, zoom: 1 };
    renderer.drawGuidance(run);
    const distance = Math.hypot(run.x - bay.x, run.y - bay.y).toFixed(0);
    assert.ok(labels.some(label => label.includes(`RELAY · ${distance} m`)));
    labels.length = 0;
    renderer.camera = { x: run.x, y: run.y, zoom: 1 };
    renderer.drawGuidance(run);
    assert.ok(labels.some(label => label.includes(`RELAY · ${distance} m`)));
    labels.length = 0;
    run.phase = 'planet';
    run.delivered = 1;
    renderer.drawGuidance(run);
    assert.ok(labels.some(label => label.includes('MOON ·') && label.includes('km')));
    assert.equal(targetFor(run).type, 'planet');
});


test('dash effects emit a short bounded exhaust burst opposite each rocket-relative direction', () => {
    for (const angle of [0, Math.PI / 2, -Math.PI / 2]) {
        for (const [direction, localX, localY] of [
            ['forward', 0, 1], ['left', 1, 0], ['backward', 0, -1], ['right', -1, 0]
        ]) {
            const { renderer } = makeRenderer();
            const run = createRun();
            Object.assign(run, { x: 0, y: -5000, angle, vx: 100, vy: -30 });
            const before = structuredClone(run);
            renderer.dashBurst(run, direction);
            assert.equal(renderer.particles.length, 18);
            const dx = localX * Math.cos(angle) - localY * Math.sin(angle);
            const dy = localX * Math.sin(angle) + localY * Math.cos(angle);
            for (const particle of renderer.particles) {
                assert.equal(particle.kind, 'dash');
                assert.ok(particle.lifetime >= 0.18 && particle.lifetime <= 0.3);
                assert.ok((particle.vx - run.vx) * dx + (particle.vy - run.vy) * dy > 0);
                assert.ok((particle.x - run.x) * dx + (particle.y - run.y) * dy > 0);
            }
            renderer.drawExhaust();
            assert.deepEqual(run, before, 'Visual effects must not change fuel or physics.');
            for (let frame = 0; frame < 7; frame++) renderer.updateExhaust(run, {}, 0.05);
            assert.equal(renderer.particles.length, 0);
        }
    }
    const { renderer } = makeRenderer();
    const run = createRun();
    for (let index = 0; index < 30; index++) renderer.dashBurst(run, 'left');
    assert.equal(renderer.particles.length, 360);
    renderer.updateExhaust(run, {}, 0, true);
    assert.equal(renderer.particles.length, 0);
    renderer.reducedMotion = true;
    renderer.dashBurst(run, 'forward');
    assert.equal(renderer.particles.length, 0);
});


test('dash cue stays visible at low zoom and with reduced motion in the legacy game renderer', () => {
    for (const zoom of [0.08, 0.95]) {
        const { renderer } = makeRenderer();
        renderer.camera.zoom = zoom;
        renderer.reducedMotion = true;
        const player = createRun();
        Object.assign(player, { x: 0, y: -5000, deadUntil: 0, docked: false });
        renderer.dashBurst(player, 'right');
        assert.ok(renderer.dashFlash, 'Reduced motion must retain a static directional dash cue.');
        assert.equal(renderer.particles.length, 0);
        let strokes = 0;
        renderer.context.stroke = () => { strokes++; };
        renderer.drawDashFlash(player, 0.1);
        assert.equal(strokes, 3, 'Three fixed-size chevrons must remain visible at either zoom.');
        assert.ok(renderer.dashFlash.remaining >= 0.3);
        renderer.drawDashFlash(player, 0.4);
        assert.equal(renderer.dashFlash, null);
    }
});
