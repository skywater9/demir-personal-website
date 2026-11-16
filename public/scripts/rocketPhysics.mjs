export const tuning = Object.freeze({
    maxFuel: 100, mainAcceleration: 34, rcsAcceleration: 5,
    mainFuelRate: 0.62, rcsFuelRate: 0.12, rotationFuelRate: 0.025,
    rotationRate: 1.55, shipRadius: 18, padHalfWidth: 48,
    safeLandingSpeed: 8, safeLandingAngle: Math.PI / 15,
    dockingDistance: 32, dockingSpeed: 5, dockingAngle: Math.PI / 15,
    influenceAltitude: 1050, fixedStep: 1 / 120
});

export const bodies = Object.freeze([
    { id: 'earth', name: 'Earth', x: 0, y: 0, radius: 260, gravity: 9.81, color: '#4b91b5', land: '#79a66b', refuel: 48, gas: false },
    { id: 'moon', name: 'Moon', x: 1900, y: -100, radius: 145, gravity: 1.62, color: '#a4a9b5', land: '#727887', refuel: 34, gas: false },
    { id: 'venus', name: 'Venus', x: -2700, y: 100, radius: 245, gravity: 8.87, color: '#d7ad6b', land: '#a77e4e', refuel: 48, gas: false },
    { id: 'mercury', name: 'Mercury', x: -5400, y: -70, radius: 170, gravity: 3.7, color: '#a99786', land: '#75685f', refuel: 42, gas: false },
    { id: 'mars', name: 'Mars', x: 4500, y: 80, radius: 205, gravity: 3.71, color: '#bc7155', land: '#854f48', refuel: 44, gas: false },
    { id: 'jupiter', name: 'Jupiter', x: 7500, y: 180, radius: 380, gravity: 24.79, color: '#cfad8e', land: '#9d7265', refuel: 65, gas: true },
    { id: 'saturn', name: 'Saturn', x: 10600, y: 40, radius: 320, gravity: 10.44, color: '#d6c291', land: '#a8916d', refuel: 50, gas: true },
    { id: 'uranus', name: 'Uranus', x: 13600, y: -80, radius: 275, gravity: 8.69, color: '#8ac6ca', land: '#5c989f', refuel: 48, gas: true },
    { id: 'neptune', name: 'Neptune', x: 16600, y: 20, radius: 270, gravity: 11.15, color: '#587fbf', land: '#385a98', refuel: 55, gas: true }
].map(body => Object.freeze(body)));

export const route = Object.freeze(['earth', 'moon', 'venus', 'mercury', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);

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
        vx: 0, vy: 0, angle: 0, fuel: tuning.maxFuel, throttle: 0.85,
        landedOn: 'earth', docked: false, payload: true, serviced: [0],
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
        const distance = Math.max(body.radius, Math.hypot(dx, dy));
        const altitude = distance - body.radius;
        const fade = Math.max(0, Math.min(1, (tuning.influenceAltitude - altitude) / 300));
        const acceleration = body.gravity * (body.radius / distance) ** 2 * fade;
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
        ready: run.status === 'active' && run.phase === 'station' && !run.docked
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

// Settle low-speed contact and service only the next expected destination, once per route visit.
function resolveSurface(run, body, resting = false) {
    const dx = run.x - body.x;
    const dy = run.y - body.y;
    const distance = Math.hypot(dx, dy);
    const surfaceDistance = body.radius + tuning.shipRadius;
    if (distance > surfaceDistance && !resting) return;
    const speed = Math.hypot(run.vx, run.vy);
    if (speed > tuning.safeLandingSpeed) {
        finishRun(run, 'lost', `Impact on ${body.name} at ${speed.toFixed(1)} m/s.`);
        return;
    }
    const nx = distance > 0 ? dx / distance : 0;
    const ny = distance > 0 ? dy / distance : -1;
    run.x = body.x + nx * surfaceDistance;
    run.y = body.y + ny * surfaceDistance;
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

// Advance one small deterministic physics step; menus and hidden pages never call this method.
export function stepRun(run, input = {}, dt = tuning.fixedStep) {
    if (run.status !== 'active' || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 1 / 30);
    if (run.fuel <= 0) {
        run.fuel = 0;
        finishRun(run, 'lost', 'Fuel depleted.');
        return;
    }
    run.elapsed += dt;
    const rotate = Math.max(-1, Math.min(1, input.rotate || 0));
    const rcsX = Math.max(-1, Math.min(1, input.rcsX || 0));
    const rcsY = Math.max(-1, Math.min(1, input.rcsY || 0));
    const burning = Boolean(input.burn) && run.throttle > 0;
    const moving = burning || rcsX !== 0 || rcsY !== 0;
    run.fuel = Math.max(0, run.fuel - dt * (
        (burning ? tuning.mainFuelRate * run.throttle : 0)
        + tuning.rcsFuelRate * (Math.abs(rcsX) + Math.abs(rcsY))
        + tuning.rotationFuelRate * Math.abs(rotate)));
    if (run.fuel <= 0) {
        finishRun(run, 'lost', 'Fuel depleted.');
        return;
    }
    if (run.docked && !moving) return;
    if (run.docked) {
        run.docked = false;
        recordRunEvent(run, 'undocked');
    }
    run.angle = normalizeAngle(run.angle + rotate * tuning.rotationRate * dt);
    if (run.landedOn && !moving) {
        const landedBody = bodies.find(body => body.id === run.landedOn);
        resolveSurface(run, landedBody, true);
        return;
    }
    run.landedOn = null;
    const gravity = gravityAt(run.x, run.y);
    const thrust = burning ? tuning.mainAcceleration * run.throttle : 0;
    let ax = gravity.ax + Math.sin(run.angle) * thrust + rcsX * tuning.rcsAcceleration;
    const ay = gravity.ay - Math.cos(run.angle) * thrust + rcsY * tuning.rcsAcceleration;
    const near = nearestBody(run);
    if (near.body.id === 'jupiter' && near.altitude < 200) {
        ax += Math.sin(run.elapsed * 0.7) * 1.4;
    }
    run.vx += ax * dt;
    run.vy += ay * dt;
    run.x += run.vx * dt;
    run.y += run.vy * dt;
    for (const body of bodies) {
        resolveSurface(run, body);
        if (run.status !== 'active') return;
        const station = stationFor(body);
        if (Math.hypot(run.x - station.x, run.y - station.y) < 34) {
            const speed = Math.hypot(run.vx, run.vy);
            if (speed > tuning.safeLandingSpeed) {
                finishRun(run, 'lost', `Station collision at ${speed.toFixed(1)} m/s.`);
                return;
            }
            const dx = run.x - station.x;
            const dy = run.y - station.y;
            const distance = Math.max(0.001, Math.hypot(dx, dy));
            run.x = station.x + (dx / distance || -1) * 35;
            run.y = station.y + dy / distance * 35;
            run.vx *= -0.3;
            run.vy *= -0.3;
        }
    }
}
