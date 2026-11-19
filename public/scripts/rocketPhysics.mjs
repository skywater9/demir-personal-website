export const tuning = Object.freeze({
    // Fuel remains a saved/displayed percentage; half capacity doubles the percentage used per burn.
    maxFuel: 100, fuelCapacityScale: 0.5, mainAcceleration: 34, rcsAcceleration: 5,
    mainFuelRate: 0.62, rcsFuelRate: 0.12, rotationFuelRate: 0.025,
    rotationRate: 1.55, rotationAcceleration: 0.3, maxRotationRate: 2.15,
    dashImpulse: 108, dashFuelCost: 1, dashCooldown: 2, dashTapWindow: 250,
    shipRadius: 18, padHalfWidth: 48,
    safeLandingSpeed: 12, surfaceCrashSpeed: 25, stationCrashSpeed: 30, safeLandingAngle: Math.PI / 15,
    dockingDistance: 32, dockingSpeed: 8, dockingAngle: Math.PI / 15, dockingAssistDistance: 200,
    influenceAltitude: 1050, fixedStep: 1 / 120
});

export const bodies = Object.freeze([
    { id: 'earth', name: 'Earth', x: 0, y: 0, radius: 260, gravity: 9.81, color: '#4b91b5', land: '#79a66b', refuel: 25, gas: false },
    { id: 'moon', name: 'Moon', x: 1900, y: -100, radius: 145, gravity: 1.62, color: '#a4a9b5', land: '#727887', refuel: 25, gas: false },
    { id: 'venus', name: 'Venus', x: -2700, y: 100, radius: 245, gravity: 8.87, color: '#d7ad6b', land: '#a77e4e', refuel: 25, gas: false },
    { id: 'mercury', name: 'Mercury', x: -5400, y: -70, radius: 170, gravity: 3.7, color: '#a99786', land: '#75685f', refuel: 25, gas: false },
    { id: 'mars', name: 'Mars', x: 4500, y: 80, radius: 205, gravity: 3.71, color: '#bc7155', land: '#854f48', refuel: 25, gas: false },
    { id: 'jupiter', name: 'Jupiter', x: 7500, y: 180, radius: 380, gravity: 24.79, color: '#cfad8e', land: '#9d7265', refuel: 25, gas: true },
    { id: 'saturn', name: 'Saturn', x: 10600, y: 40, radius: 320, gravity: 10.44, color: '#d6c291', land: '#a8916d', refuel: 25, gas: true },
    { id: 'uranus', name: 'Uranus', x: 13600, y: -80, radius: 275, gravity: 8.69, color: '#8ac6ca', land: '#5c989f', refuel: 25, gas: true },
    { id: 'neptune', name: 'Neptune', x: 16600, y: 20, radius: 270, gravity: 11.15, color: '#587fbf', land: '#385a98', refuel: 25, gas: true }
].map(body => Object.freeze(body)));

export const route = Object.freeze(['earth', 'moon', 'venus', 'mercury', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);

export const stationGeometry = Object.freeze([
    { name: 'panelTop', left: -28, right: 28, top: -74, bottom: -32, color: '#223b53' },
    { name: 'panelBottom', left: -28, right: 28, top: 32, bottom: 74, color: '#223b53' },
    { name: 'strut', left: -6, right: 6, top: -36, bottom: 36, color: '#75868b' },
    { name: 'hull', left: -30, right: 30, top: -20, bottom: 20, color: '#c6cebf' },
    { name: 'capTop', left: -18, right: 18, top: -28, bottom: -20, color: '#96ada9' },
    { name: 'capBottom', left: -18, right: 18, top: 20, bottom: 28, color: '#96ada9' },
    { name: 'portTop', left: -44, right: -30, top: -14, bottom: -8, color: '#dda456' },
    { name: 'portBottom', left: -44, right: -30, top: 8, bottom: 14, color: '#dda456' },
    { name: 'portLight', left: -44, right: -38, top: -6, bottom: 6, color: '#81ccb4' },
    { name: 'antennaArm', left: 30, right: 50, top: -2, bottom: 2, color: '#b4c2c0' },
    { name: 'antenna', left: 48, right: 52, top: -16, bottom: 16, color: '#b4c2c0' }
].map(part => Object.freeze(part)));

// Keep angles signed so upright landing and docking tolerances work across complete turns.
export function normalizeAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Resolve the immutable world body for a particular route stop, including the return to Earth.
export function routeBody(index) {
    return bodies.find(body => body.id === route[index]);
}

// Put every fixed station above and to the right of its planet, away from surface gravity.
export function stationFor(body) {
    return { x: body.x + 430, y: body.y - body.radius - 560, angle: 0, name: `${body.name} relay` };
}

// Locate the right-side bay approach point beside the station rather than inside its hull.
export function dockingPoint(body) {
    const station = stationFor(body);
    return { x: station.x - 58, y: station.y, angle: station.angle, name: station.name };
}

// Start each run ready to launch with a loaded payload and a full Earth tank.
export function createRun(id = globalThis.crypto.randomUUID(), now = Date.now()) {
    const earth = routeBody(0);
    return {
        version: 1, id, startedAt: now, updatedAt: now, elapsed: 0,
        routeIndex: 0, delivered: 0, phase: 'station', status: 'active', reason: '',
        x: earth.x, y: earth.y - earth.radius - tuning.shipRadius,
        vx: 0, vy: 0, angle: 0, rotationVelocity: 0, fuel: tuning.maxFuel, throttle: 1,
        dashReadyAt: 0, landedOn: 'earth', docked: false, payload: true, serviced: [0],
        events: [{ type: 'started', at: now, elapsed: 0 }]
    };
}

// Select either a station bay or the next destination pad as the current navigation objective.
export function targetFor(run) {
    if (run.phase === 'station') {
        return { ...dockingPoint(routeBody(run.routeIndex)), type: 'station', body: routeBody(run.routeIndex) };
    }
    const body = routeBody(Math.min(run.routeIndex + 1, route.length - 1));
    return { x: body.x, y: body.y - body.radius - tuning.shipRadius, type: 'planet', name: `${body.name} landing pad`, body };
}

// Find the closest surface for altitude and atmosphere instruments, even outside its gravity range.
export function nearestBody(run) {
    return bodies.reduce((closest, body) => {
        const altitude = Math.hypot(run.x - body.x, run.y - body.y) - body.radius - tuning.shipRadius;
        return !closest || altitude < closest.altitude ? { body, altitude } : closest;
    }, null);
}

// Apply inverse-square gravity with a smooth outer cutoff to keep interplanetary flight practical.
export function gravityAt(x, y) {
    let ax = 0;
    let ay = 0;
    for (const body of bodies) {
        const dx = body.x - x;
        const dy = body.y - y;
        const distance = Math.max(0.001, Math.hypot(dx, dy));
        const surfaceRadius = body.radius + tuning.shipRadius;
        const gravityDistance = Math.max(surfaceRadius, distance);
        const altitude = gravityDistance - surfaceRadius;
        const fade = Math.max(0, Math.min(1, (tuning.influenceAltitude - altitude) / 300));
        const acceleration = body.gravity * (surfaceRadius / gravityDistance) ** 2 * fade;
        ax += dx / distance * acceleration;
        ay += dy / distance * acceleration;
    }
    return { ax, ay, magnitude: Math.hypot(ax, ay) };
}

// Derive the exact docking checks used by both the attach action and the instrument panel.
export function dockingStatus(run) {
    const target = dockingPoint(routeBody(run.routeIndex));
    const distance = Math.hypot(run.x - target.x, run.y - target.y);
    const speed = Math.hypot(run.vx, run.vy);
    const angle = Math.abs(normalizeAngle(run.angle - target.angle));
    return {
        distance, speed, angle,
        ready: run.status === 'active' && run.phase === 'station' && run.payload && !run.docked
            && run.fuel > 0 && distance <= tuning.dockingDistance
            && speed <= tuning.dockingSpeed && angle <= tuning.dockingAngle
    };
}

// Store a bounded timeline of significant run events without logging every physics frame.
export function recordRunEvent(run, type, now = Date.now()) {
    run.updatedAt = now;
    run.events.push({ type, at: now, elapsed: run.elapsed });
    if (run.events.length > 200) run.events.splice(0, run.events.length - 200);
}

// End the run once so result screens and history cannot count the same failure repeatedly.
export function finishRun(run, status, reason) {
    if (run.status !== 'active') return;
    run.status = status;
    run.reason = reason;
    recordRunEvent(run, status);
}

// Attach only inside all docking tolerances, deliver payload, and select the next destination.
export function tryDock(run) {
    if (!dockingStatus(run).ready) return false;
    const point = dockingPoint(routeBody(run.routeIndex));
    run.x = point.x;
    run.y = point.y;
    run.vx = 0;
    run.vy = 0;
    run.angle = 0;
    run.rotationVelocity = 0;
    run.docked = true;
    run.payload = false;
    run.delivered += 1;
    recordRunEvent(run, 'payloadDelivered');
    if (run.routeIndex === route.length - 1) {
        finishRun(run, 'won', 'All ten payloads delivered. Journey complete.');
    } else {
        run.phase = 'planet';
    }
    return true;
}

// Dampen survivable contacts and cap rebound speed so a small mistake stays recoverable.
function bounceGently(run, nx, ny) {
    const incoming = run.vx * nx + run.vy * ny;
    if (incoming >= 0) return;
    const rebound = Math.min(3, Math.max(1, -incoming * 0.15));
    run.vx = (run.vx - incoming * nx) * 0.65 + rebound * nx;
    run.vy = (run.vy - incoming * ny) * 0.65 + rebound * ny;
    const speed = Math.hypot(run.vx, run.vy);
    if (speed > 6) {
        run.vx *= 6 / speed;
        run.vy *= 6 / speed;
    }
}

// Settle safe landings, bounce moderate impacts, and service the next expected destination once.
function resolveSurface(run, body, resting = false, previous = null) {
    let dx = run.x - body.x;
    let dy = run.y - body.y;
    let distance = Math.hypot(dx, dy);
    const surfaceDistance = body.radius + tuning.shipRadius;
    if (distance > surfaceDistance && !resting) {
        if (!previous) return;
        const sx = run.x - previous.x;
        const sy = run.y - previous.y;
        const px = previous.x - body.x;
        const py = previous.y - body.y;
        const a = sx * sx + sy * sy;
        const b = 2 * (px * sx + py * sy);
        const c = px * px + py * py - surfaceDistance * surfaceDistance;
        const discriminant = b * b - 4 * a * c;
        if (a === 0 || c <= 0 || discriminant < 0) return;
        const fraction = (-b - Math.sqrt(discriminant)) / (2 * a);
        if (fraction < 0 || fraction > 1) return;
        run.x = previous.x + sx * fraction;
        run.y = previous.y + sy * fraction;
        dx = run.x - body.x;
        dy = run.y - body.y;
        distance = Math.hypot(dx, dy);
    }
    const speed = Math.hypot(run.vx, run.vy);
    if (speed > tuning.surfaceCrashSpeed) {
        finishRun(run, 'lost', `Impact on ${body.name} at ${speed.toFixed(1)} m/s.`);
        return;
    }
    const nx = distance > 0 ? dx / distance : 0;
    const ny = distance > 0 ? dy / distance : -1;
    run.x = body.x + nx * surfaceDistance;
    run.y = body.y + ny * surfaceDistance;
    if (speed > tuning.safeLandingSpeed) {
        run.x += nx * 0.1;
        run.y += ny * 0.1;
        run.landedOn = null;
        bounceGently(run, nx, ny);
        return;
    }
    run.vx = 0;
    run.vy = 0;
    run.landedOn = body.id;
    const onPad = Math.abs(dx) <= tuning.padHalfWidth && dy < 0;
    const upright = Math.abs(normalizeAngle(run.angle)) <= tuning.safeLandingAngle;
    const nextIndex = run.routeIndex + 1;
    if (onPad && upright && run.phase === 'planet' && body.id === route[nextIndex]) {
        run.routeIndex = nextIndex;
        run.phase = 'station';
        run.payload = true;
        if (!run.serviced.includes(nextIndex)) {
            run.fuel = Math.min(tuning.maxFuel, run.fuel + body.refuel);
            run.serviced.push(nextIndex);
        }
        recordRunEvent(run, 'landedAndRefueled');
    }
}

// Sweep the whole movement segment through an expanded station part so fast glancing hits cannot tunnel.
function segmentBoxHit(previous, current, box) {
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    if (previous.x >= box.left && previous.x <= box.right && previous.y >= box.top && previous.y <= box.bottom) {
        const faces = [
            { distance: previous.x - box.left, x: box.left, y: previous.y, nx: -1, ny: 0 },
            { distance: box.right - previous.x, x: box.right, y: previous.y, nx: 1, ny: 0 },
            { distance: previous.y - box.top, x: previous.x, y: box.top, nx: 0, ny: -1 },
            { distance: box.bottom - previous.y, x: previous.x, y: box.bottom, nx: 0, ny: 1 }
        ];
        return { ...faces.reduce((nearest, face) => face.distance < nearest.distance ? face : nearest), fraction: 0 };
    }
    let entry = 0;
    let exit = 1;
    let nx = 0;
    let ny = 0;
    for (const axis of ['x', 'y']) {
        const delta = axis === 'x' ? dx : dy;
        const origin = previous[axis];
        const minimum = axis === 'x' ? box.left : box.top;
        const maximum = axis === 'x' ? box.right : box.bottom;
        if (Math.abs(delta) < 1e-12) {
            if (origin < minimum || origin > maximum) return null;
            continue;
        }
        const first = Math.min((minimum - origin) / delta, (maximum - origin) / delta);
        const last = Math.max((minimum - origin) / delta, (maximum - origin) / delta);
        if (first > entry) {
            entry = first;
            nx = axis === 'x' ? -Math.sign(delta) : 0;
            ny = axis === 'y' ? -Math.sign(delta) : 0;
        }
        exit = Math.min(exit, last);
        if (entry > exit) return null;
    }
    if (exit < 0 || entry > 1) return null;
    return { fraction: entry, x: previous.x + dx * entry, y: previous.y + dy * entry, nx, ny };
}

// Match collisions to the drawn hull, panels, bay, and antenna; soft contacts push away instead of sticking.
function resolveStation(run, body, previous) {
    const station = stationFor(body);
    if (Math.max(previous.x, run.x) < station.x - 100 || Math.min(previous.x, run.x) > station.x + 100
        || Math.max(previous.y, run.y) < station.y - 100 || Math.min(previous.y, run.y) > station.y + 100) return;
    let firstHit = null;
    for (const part of stationGeometry) {
        const hit = segmentBoxHit(previous, run, {
            left: station.x + part.left - tuning.shipRadius,
            right: station.x + part.right + tuning.shipRadius,
            top: station.y + part.top - tuning.shipRadius,
            bottom: station.y + part.bottom + tuning.shipRadius
        });
        if (hit && (!firstHit || hit.fraction < firstHit.fraction)) firstHit = hit;
    }
    if (!firstHit) return;
    const speed = Math.hypot(run.vx, run.vy);
    if (speed >= tuning.stationCrashSpeed) {
        finishRun(run, 'lost', `Station collision at ${speed.toFixed(1)} m/s.`);
        return;
    }
    run.x = firstHit.x + firstHit.nx * 0.01;
    run.y = firstHit.y + firstHit.ny * 0.01;
    bounceGently(run, firstHit.nx, firstHit.ny);
}

// Spend a small fuel burst for one rocket-relative impulse, sharing a cooldown across directions.
export function dashRun(run, direction) {
    const directions = { forward: [0, -1], left: [-1, 0], backward: [0, 1], right: [1, 0] };
    const localDirection = Object.hasOwn(directions, direction) ? directions[direction] : null;
    if (!localDirection || run.status !== 'active' || run.fuel < tuning.dashFuelCost
        || run.elapsed + 1e-9 < (run.dashReadyAt || 0)) return false;
    const [localX, localY] = localDirection;
    run.fuel = Math.max(0, run.fuel - tuning.dashFuelCost);
    run.dashReadyAt = run.elapsed + tuning.dashCooldown;
    if (run.fuel <= 0) {
        finishRun(run, 'lost', 'Fuel depleted.');
        return true;
    }
    if (run.docked) {
        run.docked = false;
        recordRunEvent(run, 'undocked');
    }
    run.landedOn = null;
    run.vx += (localX * Math.cos(run.angle) - localY * Math.sin(run.angle)) * tuning.dashImpulse;
    run.vy += (localX * Math.sin(run.angle) + localY * Math.cos(run.angle)) * tuning.dashImpulse;
    return true;
}

// Advance one small deterministic physics step; menus and hidden pages never call this method.
export function stepRun(run, input = {}, dt = tuning.fixedStep) {
    if (run.status !== 'active' || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 1 / 30);
    // Main-engine output is fixed at full thrust; retain the save field for old run compatibility.
    run.throttle = 1;
    if (run.fuel <= 0) {
        run.fuel = 0;
        finishRun(run, 'lost', 'Fuel depleted.');
        return;
    }
    run.elapsed += dt;
    const rotate = Math.max(-1, Math.min(1, input.rotate || 0));
    const rcsX = Math.max(-1, Math.min(1, input.rcsX || 0));
    const rcsY = Math.max(-1, Math.min(1, input.rcsY || 0));
    const burning = Boolean(input.burn);
    const moving = burning || rcsX !== 0 || rcsY !== 0;
    run.fuel = Math.max(0, run.fuel - dt / tuning.fuelCapacityScale * (
        (burning ? tuning.mainFuelRate : 0)
        + tuning.rcsFuelRate * (Math.abs(rcsX) + Math.abs(rcsY))
        + tuning.rotationFuelRate * Math.abs(rotate)));
    if (run.fuel <= 0) {
        finishRun(run, 'lost', 'Fuel depleted.');
        return;
    }
    // Start at the familiar turn speed, then gently accelerate until release or reversal.
    const previousRotation = Number.isFinite(run.rotationVelocity) ? run.rotationVelocity : 0;
    const rotationSpeed = Math.sign(previousRotation) === Math.sign(rotate)
        ? Math.max(tuning.rotationRate, Math.abs(previousRotation)) : tuning.rotationRate;
    run.rotationVelocity = rotate * Math.min(tuning.maxRotationRate,
        rotationSpeed + tuning.rotationAcceleration * dt);
    if (run.docked && !moving) {
        run.rotationVelocity = 0;
        return;
    }
    if (run.docked) {
        run.docked = false;
        recordRunEvent(run, 'undocked');
    }
    run.angle = normalizeAngle(run.angle + run.rotationVelocity * dt);
    if (run.landedOn && !moving) {
        const landedBody = bodies.find(body => body.id === run.landedOn);
        resolveSurface(run, landedBody, true);
        return;
    }
    run.landedOn = null;
    const gravity = gravityAt(run.x, run.y);
    const thrust = burning ? tuning.mainAcceleration : 0;
    // Rotate local lateral/forward RCS commands with the rocket while keeping screen Y downward.
    const rcsAx = (rcsX * Math.cos(run.angle) - rcsY * Math.sin(run.angle)) * tuning.rcsAcceleration;
    const rcsAy = (rcsX * Math.sin(run.angle) + rcsY * Math.cos(run.angle)) * tuning.rcsAcceleration;
    let ax = gravity.ax + Math.sin(run.angle) * thrust + rcsAx;
    const ay = gravity.ay - Math.cos(run.angle) * thrust + rcsAy;
    const near = nearestBody(run);
    if (near.body.id === 'jupiter' && near.altitude < 200) {
        ax += Math.sin(run.elapsed * 0.7) * 1.4;
    }
    run.vx += ax * dt;
    run.vy += ay * dt;
    const previous = { x: run.x, y: run.y };
    run.x += run.vx * dt;
    run.y += run.vy * dt;
    for (const body of bodies) {
        resolveSurface(run, body, false, previous);
        if (run.status !== 'active') return;
        resolveStation(run, body, previous);
        if (run.status !== 'active') return;
    }
}
