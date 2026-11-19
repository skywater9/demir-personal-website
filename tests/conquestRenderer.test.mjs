import test from 'node:test';
import assert from 'node:assert/strict';
import { ConquestRenderer } from '../public/scripts/conquestRenderer.mjs';
import { createWorld, bodies, systems, stepWorld, dockingPoint, killPlayer } from '../public/scripts/conquestPhysics.mjs';

// Observe real drawing operations and fail on invalid coordinates without requiring an installed browser.
function makeRenderer() {
    const calls = [];
    const context = new Proxy({}, {
        get(target, name) {
            if (name in target) return target[name];
            if (name === 'measureText') return text => ({ width: String(text).length * 4 });
            return (...args) => {
                for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${String(name)} received invalid geometry`);
                calls.push([name, ...args]);
            };
        },
        set(target, name, value) { target[name] = value; return true; }
    });
    const canvas = { width: 500, height: 300, clientWidth: 1000, clientHeight: 600, getContext: () => context,
        getBoundingClientRect: () => ({ left: 20, top: 40, width: 1000, height: 600 }) };
    const map = { width: 300, height: 180, clientWidth: 300, clientHeight: 180, getContext: () => context,
        getBoundingClientRect: () => ({ left: 50, top: 80, width: 600, height: 360 }) };
    return { renderer: new ConquestRenderer(canvas, map), calls, canvas, map };
}

test('world frames draw scattered systems, shield tiers and death effects without mutating the simulation', () => {
    const { renderer, calls } = makeRenderer();
    const world = createWorld();
    for (let index = 0; index < bodies.length; index++) {
        world.planets[bodies[index].id].owner = index % 2 ? 'rival-test' : world.player.id;
        world.planets[bodies[index].id].level = index % 4;
        Object.assign(world.player, { x: bodies[index].x - 60, y: bodies[index].y - bodies[index].radius - 80, landedOn: null });
        const before = JSON.stringify(world);
        renderer.draw(world, { burn: true, rcsY: 1, aimCursor: { x: .8, y: .3 } }, false, .016);
        assert.equal(JSON.stringify(world), before);
    }
    for (const star of systems) {
        Object.assign(world.player, { x: star.x + star.radius + 300, y: star.y - 100 });
        renderer.draw(world, {}, false, .016);
    }
    killPlayer(world, 'Test crash.'); renderer.draw(world, {}, false, .05);
    stepWorld(world, {}, 1); renderer.draw(world, {}, false, .05);
    assert.ok(calls.some(call => call[0] === 'arc'));
    assert.ok(calls.some(call => call[0] === 'fillText' && String(call[1]).includes('RELAY')));
    assert.ok(renderer.particles.length <= 500);
});

test('CSS-scaled map hit testing selects the same planet that is drawn and rejects outside clicks', () => {
    const { renderer, map } = makeRenderer(); const world = createWorld(); renderer.draw(world);
    const layout = renderer.mapLayout();
    const point = renderer.mapPoint(bodies[0].x, bodies[0].y, layout);
    const rect = map.getBoundingClientRect();
    const target = renderer.mapTarget(rect.left + point.x / map.width * rect.width, rect.top + point.y / map.height * rect.height);
    assert.equal(target.bodyId, bodies[0].id);
    assert.equal(renderer.mapTarget(-999, -999), null);
});

test('new exhaust starts on the centered rocket nozzle at both close and distant camera zoom', () => {
    const { renderer } = makeRenderer(); const world = createWorld();
    Object.assign(world.player, { landedOn: null, x: 6000, y: -5000, vx: 0, vy: 0, angle: 0 });
    for (const zoom of [.16, .95]) {
        renderer.camera = { x: world.player.x, y: world.player.y, zoom };
        renderer.particles = []; renderer.exhaustCarry.clear();
        renderer.updateExhaust(world, { burn: true }, .05, false, false);
        const particles = renderer.particles.filter(particle => particle.kind === 'main');
        assert.ok(particles.length > 0);
        for (const particle of particles) assert.ok(Math.abs(particle.x - world.player.x) < 1e-8);
        const nozzle = renderer.screen(particles[0].x, particles[0].y);
        const ship = renderer.screen(world.player.x, world.player.y);
        const expectedOffset = 10 * Math.max(.65, zoom);
        assert.ok(Math.abs(nozzle.y - ship.y - expectedOffset) <= 1.1);
    }
});


test('steering emits no jets while main and moving brake effects remain active', () => {
    const { renderer } = makeRenderer();
    const world = createWorld();
    const player = world.player;
    Object.assign(player, { landedOn: null, angle: 0, rotationVelocity: 1, vy: -100 });
    const input = { aimAngle: -Math.PI / 2 + Math.PI / 360, burn: true, rcsY: 1 };
    let jets = renderer.exhaustJets(player, input, false);
    assert.ok(jets.some(jet => jet.kind === 'main'));
    assert.equal(jets.filter(jet => jet.kind === 'attitude').length, 2, 'Braking keeps both front jets active even with tiny heading error.');
    input.rcsY = 0;
    assert.equal(renderer.exhaustJets(player, input, false).filter(jet => jet.kind === 'attitude').length, 0);
    input.aimAngle = 0;
    player.rotationVelocity = 0.3;
    assert.equal(renderer.exhaustJets(player, input, false).filter(jet => jet.kind === 'attitude').length, 0);
    for (const direction of [-1, 1]) {
        player.rotationVelocity = direction;
        jets = renderer.exhaustJets(player, input, false).filter(jet => jet.kind === 'attitude');
        assert.equal(jets.length, 0);
    }
    // Crossing the signed-angle boundary must still count as a tiny correction.
    player.angle = Math.PI - 0.001;
    input.aimAngle = -Math.PI + 0.001 - Math.PI / 2;
    assert.equal(renderer.exhaustJets(player, input, false).filter(jet => jet.kind === 'attitude').length, 0);
});


test('camera zoom varies continuously with speed at surface and travel altitudes', () => {
    const world = createWorld();
    const player = { ...world.player, landedOn: null, docked: null };
    for (const altitude of [0, 180, 1000, 1880, 5000]) {
        let previousZoom = Infinity;
        for (const speed of [0, 1, 79, 80, 81, 499, 500, 501, 579, 580, 581, 1000, 5000, 100000]) {
            const { renderer } = makeRenderer();
            player.vx = speed;
            renderer.updateCamera(player, { altitude }, 1 / 60, false, false);
            assert.ok(renderer.camera.zoom < previousZoom, `Zoom must keep decreasing at speed ${speed}, altitude ${altitude}.`);
            assert.ok(renderer.camera.zoom > 0.16 && renderer.camera.zoom <= 0.95);
            if (Number.isFinite(previousZoom) && [80, 81, 500, 501, 580, 581].includes(speed)) {
                assert.ok(previousZoom - renderer.camera.zoom < 0.003, 'Old thresholds must not introduce zoom steps.');
            }
            previousZoom = renderer.camera.zoom;
        }
    }
});

test('camera zoom eases through speed changes and position recenters, including reduced motion', () => {
    const world = createWorld();
    const player = { ...world.player, landedOn: null, docked: null, vx: 1000, vy: 0 };
    for (const reducedMotion of [false, true]) {
        const { renderer } = makeRenderer();
        renderer.reducedMotion = reducedMotion;
        renderer.cameraReady = true;
        renderer.camera = { x: player.x + 100000, y: player.y, zoom: 0.95 };
        renderer.updateCamera(player, { altitude: 0 }, 1 / 60, false, false);
        const targetZoom = 0.16 + (0.95 - 0.16) / (1 + 1000 / 260);
        assert.ok(renderer.camera.zoom < 0.95 && renderer.camera.zoom > targetZoom);
        assert.ok(Math.abs(renderer.camera.x - player.x) < 1000, 'Position should recenter without snapping zoom.');
        const previousZoom = renderer.camera.zoom;
        renderer.updateCamera(player, { altitude: 0 }, 1 / 60, false, false);
        assert.ok(renderer.camera.zoom < previousZoom && renderer.camera.zoom > targetZoom);
    }
});

test('camera zoom easing is independent of frame rate and retains close-up service views', () => {
    const world = createWorld();
    const player = { ...world.player, landedOn: null, docked: null, vx: 1000, vy: 0 };
    const zooms = [];
    for (const frames of [30, 60, 120]) {
        const { renderer } = makeRenderer();
        renderer.cameraReady = true;
        renderer.camera = { x: player.x, y: player.y, zoom: 0.95 };
        for (let frame = 0; frame < frames; frame++) renderer.updateCamera(player, { altitude: 0 }, 1 / frames, false, false);
        zooms.push(renderer.camera.zoom);
    }
    assert.ok(Math.max(...zooms) - Math.min(...zooms) < 1e-10);
    for (const state of [{ landedOn: 'earth', docked: null }, { landedOn: null, docked: 'earth' }]) {
        const { renderer } = makeRenderer();
        renderer.updateCamera({ ...player, ...state, vx: 0 }, { altitude: 500 }, 1 / 60, false, false);
        assert.equal(renderer.camera.zoom, 0.95);
    }
});


test('braking retains two forward nozzles while rotation produces none', () => {
    const { renderer } = makeRenderer();
    const world = createWorld();
    const player = world.player;
    Object.assign(player, { landedOn: null, angle: 0, rotationVelocity: 0, vx: 0, vy: -50 });
    const brakingJets = renderer.exhaustJets(player, { rcsY: 1 }, false);
    assert.deepEqual(brakingJets.map(jet => jet.id), ['frontLeft', 'frontRight']);
    const [left, right] = brakingJets;
    assert.equal(left.x, -right.x);
    assert.ok(left.x < 0 && left.y < 0 && left.y === right.y);
    assert.ok(left.dx < 0 && right.dx > 0 && left.dy < 0 && left.dy === right.dy);
    assert.equal(left.dx, -right.dx);
    for (const jet of brakingJets) {
        assert.equal(jet.kind, 'attitude');
        assert.equal(jet.power, 1);
        assert.ok(Math.abs(Math.hypot(jet.dx, jet.dy) - 1) < 1e-10);
    }
    player.vy = -200;
    assert.ok(renderer.exhaustJets(player, { rcsY: 1 }, false).every(jet => jet.power > 1));
    player.vy = 0;
    assert.deepEqual(renderer.exhaustJets(player, { rcsY: 1 }, false), []);
    player.vy = -50;
    for (const direction of [-1, 1]) {
        player.rotationVelocity = direction;
        const turningJets = renderer.exhaustJets(player, { aimAngle: 0 }, false);
        assert.deepEqual(turningJets, []);
        const combined = renderer.exhaustJets(player, { aimAngle: 0, rcsY: 1, burn: true }, false);
        assert.equal(combined.length, 3);
        assert.equal(new Set(combined.map(jet => jet.id)).size, 3);
        assert.deepEqual(combined.filter(jet => jet.kind === 'attitude'), brakingJets);
    }
});


test('turning emits no particles while main and brake effects remain active', () => {
    const { renderer } = makeRenderer();
    const world = createWorld();
    Object.assign(world.player, { landedOn: null, rotationVelocity: 8, angle: 0, vy: -80 });
    renderer.updateExhaust(world, { aimAngle: 0 }, .1, false, false);
    assert.equal(renderer.particles.length, 0);
    renderer.updateExhaust(world, { aimAngle: 0, burn: true, rcsY: 1 }, .1, false, false);
    assert.ok(renderer.particles.some(particle => particle.kind === 'main'));
    assert.ok(renderer.particles.some(particle => particle.kind === 'attitude'));
});


test('damage emits bounded white leak particles without changing the world and respects reduced motion', () => {
    const { renderer } = makeRenderer();
    const world = createWorld();
    const event = { x: world.player.x, y: world.player.y, amount: 5 };
    renderer.camera = { x: event.x, y: event.y, zoom: 0.95 };
    const before = structuredClone(world);
    renderer.damageBurst(world, event);
    assert.equal(renderer.particles.length, 26);
    assert.ok(renderer.particles.every(particle => particle.kind === 'damage' && particle.x === event.x && particle.y === event.y));
    const colors = [];
    Object.defineProperty(renderer.context, 'fillStyle', { set(value) { colors.push(value); } });
    renderer.drawExhaust();
    assert.ok(colors.includes('#ffffff'));
    assert.deepEqual(world, before);
    for (let frame = 0; frame < 40; frame++) renderer.updateExhaust(world, {}, 0.05, false, false);
    assert.equal(renderer.particles.length, 0);
    for (let index = 0; index < 30; index++) renderer.damageBurst(world, event);
    assert.equal(renderer.particles.length, 360);
    renderer.particles = [];
    renderer.reducedMotion = true;
    renderer.damageBurst(world, event);
    assert.equal(renderer.particles.length, 0);
});

// Place the pilot at an unselected relay so guidance cannot depend on navigation selection.
function dockingWorld(distance = 0) {
    const world = createWorld();
    const body = bodies.find(body => body.id !== world.player.homeId && !world.planets[body.id].home);
    const point = dockingPoint(body);
    Object.assign(world.player, { x: point.x + distance, y: point.y, vx: 0, vy: 0,
        angle: 0, deadUntil: 0, docked: null, landedOn: null });
    world.target = { bodyId: world.player.homeId, type: 'planet' };
    return world;
}

test('docking ghost follows nearest unselected relay only within assist range while alive and undocked', () => {
    const { renderer, calls } = makeRenderer();
    const ghosts = [];
    renderer.drawRocket = player => ghosts.push({ ...player });
    for (const [distance, docked, deadUntil, expected] of [
        [201, null, 0, 0], [200, null, 0, 1], [150, null, 0, 1],
        [0, 'relay', 0, 0], [0, null, 10, 0]
    ]) {
        const world = dockingWorld(distance);
        Object.assign(world.player, { docked, deadUntil });
        const before = structuredClone(world);
        ghosts.length = 0; calls.length = 0;
        renderer.drawDockingGuide(world, { x: .2, y: .7 });
        assert.equal(ghosts.length, expected);
        if (expected) {
            const dock = dockingPoint(bodies.find(body => body.id !== world.player.homeId && !world.planets[body.id].home));
            assert.equal(ghosts[0].x, dock.x);
            assert.equal(ghosts[0].y, dock.y);
            assert.equal(ghosts[0].angle, 0);
            assert.ok(calls.some(call => call[0] === 'arc'));
        }
        assert.deepEqual(world, before);
    }
});

test('canvas guide leaves the cursor prompt to the accessible DOM dialog', () => {
    const { renderer } = makeRenderer();
    const labels = [];
    renderer.label = (...args) => labels.push(args);
    renderer.drawDockingGuide(dockingWorld(50), { x: .2, y: .7 });
    assert.equal(labels.length, 0);
});

test('dotted docking guide connects rotated right bays at the actual rendered sprite scale', () => {
    for (const zoom of [.16, .95]) {
        const { renderer, calls } = makeRenderer();
        const world = dockingWorld(50);
        world.player.angle = Math.PI / 2;
        renderer.camera = { x: world.player.x, y: world.player.y, zoom };
        renderer.drawDockingGuide(world);
        const center = renderer.screen(world.player.x, world.player.y);
        const scale = Math.max(.65, zoom);
        const move = calls.find(call => call[0] === 'moveTo');
        assert.ok(Math.abs(move[1] - center.x - .5 * scale) < 1e-8);
        assert.ok(Math.abs(move[2] - center.y - 7 * scale) < 1e-8);
        const dock = dockingPoint(bodies.find(body => body.id !== world.player.homeId && !world.planets[body.id].home));
        const destination = renderer.screen(dock.x, dock.y);
        assert.deepEqual(calls.find(call => call[0] === 'lineTo'),
            ['lineTo', destination.x + 7 * scale, destination.y - .5 * scale]);
    }
});

test('docking animation copies poses, interpolates for .14 seconds and never changes simulation', () => {
    const { renderer } = makeRenderer();
    const world = dockingWorld();
    world.player.docked = 'relay';
    const before = structuredClone(world);
    const from = { ...world.player, x: world.player.x - 80, y: world.player.y + 40, angle: .4 };
    renderer.beginDocking(from, world.player);
    from.x = 999999;
    assert.equal(renderer.dockingVisualPlayer(world.player).x, world.player.x - 80);
    renderer.visualTime += .07;
    const middle = renderer.dockingVisualPlayer(world.player);
    assert.equal(middle.x, world.player.x - 40);
    assert.equal(middle.y, world.player.y + 20);
    assert.ok(Math.abs(middle.angle - .2) < 1e-8);
    renderer.visualTime += .07;
    assert.equal(renderer.dockingVisualPlayer(world.player), world.player);
    assert.deepEqual(world, before);
    assert.equal(renderer.dockingEffect, null);
});

test('reduced motion keeps ghost opacity steady and makes docking instantaneous', () => {
    const { renderer } = makeRenderer();
    const world = dockingWorld();
    renderer.reducedMotion = true;
    const alphas = [];
    renderer.drawRocket = () => alphas.push(renderer.context.globalAlpha);
    renderer.drawDockingGuide(world);
    renderer.visualTime += .2;
    renderer.drawDockingGuide(world);
    assert.deepEqual(alphas, [.4, .4]);
    world.player.docked = 'relay';
    renderer.beginDocking({ ...world.player, x: world.player.x - 50 }, world.player);
    assert.equal(renderer.dockingVisualPlayer(world.player), world.player);
    assert.equal(renderer.dockingEffect, null);
});

test('frame rendering uses the interpolated hull while retaining the attached world pose', () => {
    const { renderer } = makeRenderer();
    const world = dockingWorld();
    world.player.docked = 'relay';
    const before = structuredClone(world);
    renderer.beginDocking({ ...world.player, x: world.player.x - 80, angle: .4 }, world.player);
    const hulls = [];
    renderer.drawRocket = player => hulls.push({ ...player });
    renderer.draw(world, {}, false, .035);
    assert.equal(hulls.length, 1);
    assert.equal(hulls[0].x, world.player.x - 60);
    assert.ok(Math.abs(hulls[0].angle - .3) < 1e-8);
    assert.deepEqual(world, before);
});

test('selected relay guidance no longer repeats docking key or angle and speed checklist', () => {
    const { renderer } = makeRenderer();
    const world = dockingWorld();
    const body = bodies.find(body => body.id !== world.player.homeId && !world.planets[body.id].home);
    world.target = { bodyId: body.id, type: 'relay' };
    renderer.camera = { x: world.player.x, y: world.player.y, zoom: .95 };
    const labels = [];
    renderer.label = text => labels.push(text);
    renderer.drawGuidance(world);
    assert.ok(labels.some(text => text.includes('RELAY')));
    assert.ok(labels.every(text => !/E TO DOCK|DEG|m\/s/.test(text)));
});

// Map bodies remain recognizable circles after widening the visible area.
test('map draws scaled planet and sun circles with a wider view and matching hit targets', () => {
    const { renderer, calls, map } = makeRenderer();
    const world = createWorld();
    renderer.drawMap(world);
    const layout = renderer.mapLayout(world);
    assert.ok(layout.scale < Math.min(map.width, map.height) * .55 / 8000);
    const circles = calls.filter(call => call[0] === 'arc');
    for (const body of [...bodies, ...renderer.starBodies]) {
        const point = renderer.mapPoint(body.x, body.y, layout);
        assert.ok(circles.some(call => Math.abs(call[1] - point.x) <= .5
            && Math.abs(call[2] - point.y) <= .5 && call[3] >= 3));
    }
    assert.equal(calls.filter(call => call[0] === 'fillRect').length, 1);
});

// Removed home stations must disappear visually as well as from interactions and collisions.
test('home relay is not drawn and capture shield expands temporarily in the player color', () => {
    const { renderer, calls } = makeRenderer();
    const world = createWorld();
    renderer.drawStation(bodies[0], world);
    assert.equal(calls.length, 0);
    renderer.beginCapture('moon', world.player.color);
    renderer.visualTime = .4;
    renderer.drawCaptureEffects();
    assert.ok(calls.some(call => call[0] === 'arc' && call[3] > 0));
    assert.equal(renderer.context.strokeStyle, world.player.color);
    renderer.visualTime = 1.1;
    renderer.drawCaptureEffects();
    assert.equal(renderer.captureEffects.length, 0);
});

test('map player marker is larger and nearly white, while stars have a broad glow', () => {
    const { renderer, calls } = makeRenderer();
    const world = createWorld();
    renderer.drawMap(world);
    assert.equal(renderer.mapContext.strokeStyle, '#f4fff9');
    assert.ok(calls.some(call => call[0] === 'moveTo' && call[1] === 0 && call[2] === -12));
    const star = renderer.starBodies[0];
    renderer.camera = { x: star.x, y: star.y, zoom: .5 };
    renderer.drawStar(star);
    assert.ok(calls.some(call => call[0] === 'arc' && call[3] > star.radius * .5 / 2));
    assert.ok(renderer.context.shadowBlur >= 30);
});

// The first destination explains the cargo loop without keeping tutorial copy after a capture.
test('initial Moon relay guide has a larger arrow and large cargo caption', () => {
    const { renderer, calls } = makeRenderer();
    const world = createWorld();
    const labels = [];
    renderer.label = (...args) => labels.push(args);
    renderer.camera = { x: world.player.x, y: world.player.y, zoom: .95 };
    renderer.drawGuidance(world);
    assert.ok(calls.some(call => call[0] === 'moveTo' && call[1] === 20 && call[2] === 0));
    assert.ok(labels.some(args => args[0] === 'CAPTURE PLANETS TO GAIN CARGO' && args[6] === 12));
    labels.length = 0;
    world.stats.captures = 1;
    renderer.drawGuidance(world);
    assert.equal(labels.some(args => args[0].includes('CAPTURE PLANETS')), false);
});

// Crossing the old nearest-star boundary must preserve relative distances and map selection.
test('map projection stays continuous between systems and preserves world distances', () => {
    const { renderer } = makeRenderer();
    const world = createWorld();
    const x = (systems[0].x + systems[1].x) / 2;
    const y = (systems[0].y + systems[1].y) / 2;
    const left = renderer.mapCoordinates(x - 1, y);
    const right = renderer.mapCoordinates(x + 1, y);
    assert.equal(right.x - left.x, 2);
    assert.equal(right.y - left.y, 0);
    world.player.x = x; world.player.y = y;
    const layout = renderer.mapLayout(world);
    const point = renderer.mapPoint(x + 100, y - 100, layout);
    assert.ok(Math.abs(point.x - layout.width / 2 - 100 * layout.scale) < 1e-9);
    assert.ok(Math.abs(point.y - layout.height / 2 + 100 * layout.scale) < 1e-9);
});

// Both local and remote hulls read the same server timestamp and stop flashing after damage expires.
test('damaged rockets flash red briefly without changing the pilot state', () => {
    const { renderer } = makeRenderer();
    const player = { ...createWorld().player, damageFlashUntil: 1.3 };
    const colors = [];
    Object.defineProperty(renderer.context, 'fillStyle', { set(value) { colors.push(value); } });
    const before = structuredClone(player);
    renderer.drawRocket(player, 1.1);
    assert.ok(colors.includes('#ff4545'));
    colors.length = 0;
    renderer.drawRocket(player, 1.31);
    assert.ok(!colors.includes('#ff4545'));
    assert.deepEqual(player, before);
});

// Cooldown is a shrinking cursor wedge, while engines still emit particles and guns emit no steam.
test('overheated cursor shows remaining cooldown and steam is absent for all pilots', () => {
    const { renderer, calls } = makeRenderer();
    const world = createWorld();
    world.player.gunOverheatedUntil = 2.5;
    const cursor = { x: .6, y: .4 };
    renderer.drawAimGuide(world.player, cursor, 0);
    const full = calls.find(call => call[0] === 'arc' && call[3] === 9);
    assert.ok(Math.abs(full[5] - full[4] - Math.PI * 2) < 1e-9);
    calls.length = 0;
    renderer.drawAimGuide(world.player, cursor, 1.25);
    const half = calls.find(call => call[0] === 'arc' && call[3] === 9);
    assert.ok(Math.abs(half[5] - half[4] - Math.PI) < 1e-9);
    calls.length = 0;
    renderer.drawAimGuide(world.player, cursor, 2.5);
    assert.ok(!calls.some(call => call[0] === 'arc'));
    world.others = [{ ...world.player, id: 'other', thrusting: false }];
    renderer.updateExhaust(world, {}, .1, false, false);
    renderer.updateRemoteExhaust(world, .1, false);
    assert.equal(renderer.particles.length, 0);
    renderer.updateExhaust(world, { burn: true }, .1, false, false);
    assert.ok(renderer.particles.some(particle => particle.kind === 'main'));
});

// Starting outside Sol must not hide the first-capture explanation or reduce its arrow.
test('non-Earth home pilots get the same large capture and cargo guidance', () => {
    const { renderer, calls } = makeRenderer();
    const world = createWorld();
    const home = bodies.find(body => body.id === 'aster');
    Object.assign(world.player, { homeId: home.id, x: home.x, y: home.y - home.radius - 20 });
    world.target = { bodyId: 'cobalt', type: 'relay' };
    renderer.camera = { x: world.player.x, y: world.player.y, zoom: .95 };
    const labels = [];
    renderer.label = (...args) => labels.push(args);
    renderer.drawGuidance(world);
    assert.ok(calls.some(call => call[0] === 'moveTo' && call[1] === 20 && call[2] === 0));
    assert.ok(labels.some(args => args[0] === 'CAPTURE PLANETS TO GAIN CARGO'));
    world.stats.captures = 1; labels.length = 0;
    renderer.drawGuidance(world);
    assert.ok(!labels.some(args => args[0].includes('CAPTURE PLANETS')));
});

// A turret's head reads the authoritative aim for its owner, and its bar appears only after damage.
test('visible turret uses shared aim and displays a refilling disable health bar', () => {
    const { renderer, calls } = makeRenderer();
    const world = createWorld();
    const body = bodies[1];
    const state = world.planets[body.id];
    Object.assign(state, { owner: world.player.id, level: 2, turretAngle: -.7, turretHealth: 3 });
    renderer.drawTurret(body, world, '#8cdeb0');
    assert.ok(calls.some(call => call[0] === 'rotate' && call[1] === -.7));
    assert.ok(calls.some(call => call[0] === 'fillRect' && call[1] === -16 && call[3] === 32 * 3 / 5));
    calls.length = 0;
    state.turretHealth = 5;
    renderer.drawTurret(body, world, '#8cdeb0');
    assert.ok(!calls.some(call => call[0] === 'strokeRect' && call[1] === -17));
});

// Far-away pilots stay visible as colored map-edge direction markers even when their hull is hidden.
test('map draws distant public pilot markers independently of nearby flight ships', () => {
    const { renderer, calls, map } = makeRenderer();
    const world = createWorld();
    world.others = [];
    world.mapPlayers = [{ id: 'distant', label: 'Pilot 2', color: '#ff9fb8', x: 50000, y: world.player.y, angle: .4, deadUntil: 0, connected: true }];
    renderer.drawMap(world);
    assert.ok(calls.some(call => call[0] === 'fillText' && call[1] === 'Pilot 2'));
    assert.ok(calls.some(call => call[0] === 'translate' && call[1] === map.width - 8));
});
