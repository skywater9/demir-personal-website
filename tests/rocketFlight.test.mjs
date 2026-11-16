import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createRun, stepRun, routeBody, route, tuning, gravityAt, dockingPoint, tryDock
} from '../public/scripts/rocketPhysics.mjs';
import { isValidRun } from '../public/scripts/rocketStorage.mjs';

// Approach slowly enough to brake using actual translation thrusters rather than changing the rocket's state.
function wantedVelocity(distance, limit) {
    const speed = Math.min(limit, Math.abs(distance) * 0.5, Math.sqrt(5 * Math.abs(distance)));
    return Math.sign(distance) * speed;
}

// This test-only pilot adjusts throttle and held thrusters; it never teleports, refuels, or resets velocity.
function flyTo(run, x, y, isComplete, { maxSeconds = 500, horizontalSpeed = 60, upSpeed = 40, downSpeed = 25 } = {}) {
    for (let frame = 0; frame < maxSeconds / tuning.fixedStep; frame += 1) {
        if (isComplete()) return true;
        const gravity = gravityAt(run.x, run.y);
        const ax = (wantedVelocity(x - run.x, horizontalSpeed) - run.vx) * 2 - gravity.ax;
        const ay = (wantedVelocity(y - run.y, y < run.y ? upSpeed : downSpeed) - run.vy) * 2 - gravity.ay;
        const burn = ay < -0.04;
        run.throttle = burn ? Math.min(1, Math.ceil(-ay / tuning.mainAcceleration * 100) / 100) : 0;
        stepRun(run, {
            burn,
            rcsX: Math.abs(ax) > 0.04 ? Math.sign(ax) : 0,
            rcsY: ay > 0.04 ? 1 : 0
        });
        if (run.status !== 'active') return false;
    }
    return false;
}

test('fly the full route using controls and automatic pad refueling without state shortcuts', context => {
    const run = createRun();
    const cruiseY = -1450;
    for (let index = 0; index < route.length; index += 1) {
        const bay = dockingPoint(routeBody(index));
        const approachX = bay.x - 100;
        assert.equal(flyTo(run, approachX, bay.y, () => Math.abs(run.x - approachX) < 2
            && Math.abs(run.y - bay.y) < 2 && Math.hypot(run.vx, run.vy) < 1), true,
            `${routeBody(index).name} relay approach: ${run.reason || 'approach timed out'}`);
        assert.equal(flyTo(run, bay.x, bay.y, () => tryDock(run), { horizontalSpeed: 3, upSpeed: 2, downSpeed: 2 }), true,
            `${routeBody(index).name} relay: ${run.reason || 'approach timed out'}`);
        assert.equal(run.delivered, index + 1);
        assert.equal(isValidRun(run), true);
        if (run.status === 'won') break;

        const clearX = run.x - 80;
        assert.equal(flyTo(run, clearX, run.y, () => Math.abs(run.x - clearX) < 3 && Math.abs(run.vx) < 2), true,
            `Clear the ${routeBody(index).name} receiver: ${run.reason}`);
        const climbX = run.x;
        assert.equal(flyTo(run, climbX, cruiseY, () => Math.abs(run.y - cruiseY) < 2 && Math.abs(run.vy) < 1), true,
            `Climb above ${routeBody(index).name}: ${run.reason}`);
        const next = routeBody(index + 1);
        assert.equal(flyTo(run, next.x, cruiseY, () => Math.abs(run.x - next.x) < 1 && Math.abs(run.vx) < 1), true,
            `Transit to ${next.name}: ${run.reason}`);
        assert.equal(flyTo(run, next.x, next.y - next.radius - tuning.shipRadius + 0.2,
            () => run.routeIndex === index + 1), true, `${next.name} touchdown: ${run.reason}`);
        assert.equal(run.serviced.length, index + 2);
    }
    assert.equal(run.status, 'won');
    assert.equal(run.delivered, route.length);
    assert.ok(run.fuel > 0);
    context.diagnostic(`Continuous flight completed in ${run.elapsed.toFixed(1)} simulated seconds with ${run.fuel.toFixed(1)} fuel remaining.`);
});
