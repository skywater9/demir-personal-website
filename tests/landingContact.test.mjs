import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, planetBodies, tuning, stepWorld } from '../public/scripts/conquestPhysics.mjs';
import { GameRoom } from '../server/room.mjs';

// Keep a friendly planet available while removing the starter-station landing flag.
function planetWorld() {
    const world = createWorld('surface-contact', 0);
    const body = planetBodies.find(body => body.id === 'moon');
    world.planets[body.id].owner = world.player.id;
    Object.assign(world.player, { landedOn: null, docked: null, vx: 0, vy: 0, angle: 0 });
    return { world, body, radius: body.radius + tuning.shipRadius };
}

test('gentle side and underside bumps rebound where contact happened without landing or teleporting', () => {
    for (const side of ['left', 'right', 'bottom']) {
        const { world, body, radius } = planetWorld();
        const dx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
        const dy = side === 'bottom' ? 1 : 0;
        Object.assign(world.player, { x: body.x + dx * (radius + .02), y: body.y + dy * (radius + .02),
            vx: -dx * 8, vy: -dy * 8 });
        stepWorld(world, {}, .03);
        assert.equal(world.player.landedOn, null);
        assert.ok(world.player.vx * dx + world.player.vy * dy > 0);
        stepWorld(world, {}, .1);
        assert.equal(world.player.landedOn, null);
        assert.ok(Math.hypot(world.player.x - body.x - dx * radius, world.player.y - body.y - dy * radius) < 5);
    }
});

test('real pad landings retain the actual contact point instead of snapping to the pad center', () => {
    const { world, body, radius } = planetWorld();
    const offset = tuning.padHalfWidth * .5;
    Object.assign(world.player, { x: body.x + offset, y: body.y - Math.sqrt(radius * radius - offset * offset) - .02,
        vy: 8, fuel: 50 });
    stepWorld(world, {}, .03);
    assert.equal(world.player.landedOn, body.id);
    const position = { x: world.player.x, y: world.player.y };
    stepWorld(world, {}, .2);
    assert.equal(world.player.x, position.x); assert.equal(world.player.y, position.y);
    assert.ok(Math.abs(world.player.x - body.x - offset) < .01);
    assert.ok(world.player.fuel > 50);
});

test('invalid saved side-contact landing flags are cleared without repositioning the rocket', () => {
    const { world, body, radius } = planetWorld();
    Object.assign(world.player, { landedOn: body.id, x: body.x + radius, y: body.y });
    stepWorld(world, {}, .03);
    assert.equal(world.player.landedOn, null);
    assert.ok(Math.abs(world.player.x - body.x - radius) < 2);
    assert.ok(Math.abs(world.player.y - body.y) < 2);
});

test('multiplayer collision substeps never move a side-bumping rocket to the pad', () => {
    const room = new GameRoom(null, 1000);
    const joined = room.join('', 1000);
    const body = planetBodies.find(body => body.id === 'moon');
    const player = room.world.players[joined.playerId].player;
    room.world.planets[body.id].owner = player.id;
    Object.assign(player, { landedOn: null, docked: null, x: body.x + body.radius + tuning.shipRadius + .02,
        y: body.y, vx: -8, vy: 0, angle: 0 });
    room.tick(.2, 1000);
    assert.equal(player.landedOn, null);
    assert.ok(player.x > body.x + body.radius);
    assert.ok(Math.abs(player.y - body.y) < 2);
});
