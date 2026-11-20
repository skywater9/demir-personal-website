import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../server/room.mjs';
import { createWorld, planetBodies, turretPositions, tuning, stepWorld, interact, capturePress } from '../public/scripts/conquestPhysics.mjs';
import { validateSave } from '../server/persistence.mjs';

// Put competing pilots within interaction range without occupying their starter stations.
function contenders() {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    const body = planetBodies.find(body => body.id === 'moon');
    for (const id of [a.playerId, b.playerId]) Object.assign(room.world.players[id].player,
        { x: body.x, y: body.y - body.radius - 150, vx: 0, vy: 0, landedOn: null, docked: null });
    return { room, a: a.playerId, b: b.playerId, body };
}

// Accept one fresh current code after the engine's minimum press interval.
function press(room, id) {
    room.world.elapsed += tuning.hackPressInterval + .01;
    const hack = room.world.players[id].hack;
    return room.action(id, { action: 'capturePress', challengeId: hack.challengeId });
}

test('first completed capture wins, cancels all rivals and enforces a five-second recapture lock', () => {
    const { room, a, b, body } = contenders();
    for (const id of [a, b]) assert.ok(room.action(id, { action: 'interact', bodyId: body.id }).ok);
    assert.ok(press(room, b).ok);
    const stale = { action: 'capturePress', challengeId: room.world.players[b].hack.challengeId };
    for (let index = 0; index < 8; index++) assert.ok(press(room, a).ok);
    assert.equal(room.world.planets.moon.owner, a);
    assert.equal(room.world.players[a].hack, null); assert.equal(room.world.players[b].hack, null);
    assert.equal(room.view(b).captures.length, 0);
    assert.equal(room.action(b, stale).ok, false);
    assert.equal(room.action(b, { action: 'interact', bodyId: body.id }).reason, 'CAPTURE COOLDOWN');
    assert.doesNotThrow(() => validateSave(room.saved()));
    room.world.elapsed = room.world.planets.moon.recaptureAt - .01;
    assert.equal(room.action(b, { action: 'interact', bodyId: body.id }).ok, false);
    room.world.elapsed += .02;
    assert.equal(room.action(b, { action: 'interact', bodyId: body.id }).ok, true);
    assert.equal(room.world.planets.moon.owner, a);
});

test('owned planet shop remains available during its recapture cooldown', () => {
    const { room, a, body } = contenders();
    Object.assign(room.world.planets.moon, { owner: a, recaptureAt: 5 });
    assert.equal(room.action(a, { action: 'interact', bodyId: body.id }).ok, true);
    assert.equal(room.world.players[a].player.shoppingOn, body.id);
});

test('one hostile hit destroys each turret permanently and every gun must be destroyed before capture', () => {
    const world = createWorld('one-hit', 0);
    const body = planetBodies.find(body => body.id === 'moon');
    Object.assign(world.player, { x: body.x, y: body.y - body.radius - 150, vx: 0, vy: 0, landedOn: null, docked: null });
    Object.assign(world.planets.moon, { owner: 'enemy', level: 3 });
    assert.equal(interact(world, body.id).ok, false);
    for (const turret of turretPositions(body, 3)) {
        const tangent = { x: -Math.sin(turret.angle), y: Math.cos(turret.angle) };
        world.projectiles = [{ id: `hit-${turret.index}`, source: 'player', owner: world.player.id,
            x: turret.x - tangent.x * 70, y: turret.y - tangent.y * 70,
            vx: tangent.x * 10000, vy: tangent.y * 10000, radius: 3, expiresAt: 100 }];
        stepWorld(world);
        assert.equal(world.planets.moon.turrets[turret.index].health, 0);
        if (turret.index < 2) assert.equal(interact(world, body.id).ok, false);
    }
    world.projectiles = [];
    for (let index = 0; index < 20; index++) stepWorld(world, { rcsY: 1 }, 1);
    assert.ok(world.planets.moon.turrets.every(turret => turret.health === 0));
    Object.assign(world.player, { x: body.x, y: body.y - body.radius - 150, deadUntil: 0, landedOn: null });
    assert.equal(interact(world, body.id).ok, true);
});

test('basic rocket can fire eight shots before a full overheat cooldown', () => {
    const world = createWorld('heat', 0);
    Object.assign(world.player, { x: 50000, y: 50000, vx: 0, vy: 0, landedOn: null, docked: null });
    for (let index = 0; index < 500 && !world.player.gunOverheatedUntil; index++) stepWorld(world, { fire: true });
    assert.equal(world.stats.shots, 8);
    const count = world.stats.shots;
    stepWorld(world, { fire: true }, 1);
    assert.equal(world.stats.shots, count);
    assert.ok(world.player.gunOverheatedUntil > world.elapsed);
});


test('higher planet levels require progressively more fresh E presses, up through level ten', () => {
    for (const level of [0, 1, 3, 5, 10]) {
        const world = createWorld(`capture-${level}`, 0);
        const body = planetBodies.find(body => body.id === 'moon');
        Object.assign(world.player, { x: body.x, y: body.y - body.radius - 150, landedOn: null, docked: null });
        Object.assign(world.planets.moon, { owner: level ? 'enemy' : null, level,
            turrets: Array.from({ length: level }, () => ({ health: 0, angle: 0, disabledUntil: 0, nextShotAt: 0 })) });
        assert.ok(interact(world, body.id).ok);
        assert.equal(world.hack.required, 8 + level * 2);
        const required = world.hack.required;
        for (let count = 0; count < required; count++) {
            world.elapsed += tuning.hackPressInterval + .01;
            assert.ok(capturePress(world).ok);
            assert.equal(world.hack === null, count === required - 1);
        }
        assert.equal(world.planets.moon.owner, world.player.id);
    }
});

test('server restart clears old partial challenges before applying the new capture difficulty', () => {
    const { room, a, body } = contenders();
    assert.ok(room.action(a, { action: 'interact', bodyId: body.id }).ok);
    assert.ok(room.world.players[a].hack);
    const restored = new GameRoom(structuredClone(room.saved()), 2000);
    assert.equal(restored.world.players[a].hack, null);
});
