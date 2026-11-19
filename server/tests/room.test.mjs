import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../room.mjs';
import { bodies, dockingPoint, tuning, withPlayer, killPlayer, upgradeRocket } from '../../public/scripts/conquestPhysics.mjs';

// Place an actor in empty space so movement checks do not depend on nearby planets.
function space(actor, x = 50000) { Object.assign(actor.player, { x, y: 50000, vx: 0, vy: 0, landedOn: null, docked: null }); }

// Two pilots share one clock/economy while retaining their own position and private state.
test('two pilots join distinct homes and move in the same galaxy exactly once per tick', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    assert.notEqual(a.playerId, b.playerId);
    const pa = room.world.players[a.playerId], pb = room.world.players[b.playerId];
    assert.notEqual(pa.player.homeId, pb.player.homeId);
    space(pa); space(pb, 51000);
    assert.equal(room.setInput(a.playerId, { burn: true, fire: false, rcsX: 0, rcsY: 0, aimAngle: -Math.PI / 2 }, 1000), true);
    room.tick(.1, 1000);
    assert.ok(pa.player.vy < -20);
    assert.equal(pb.player.vy, 0);
    assert.ok(Math.abs(room.world.elapsed - .1) < 1e-8);
    assert.equal(room.setInput(a.playerId, { x: 999999, cargo: 100 }, 1000), false);
    room.tick(.1, 1400);
    assert.ok(pa.player.vy > -25, 'Stale burn input is cleared.');
});

// Collect once even when multiple rockets overlap the same pickup in the same tick.
test('cargo is awarded to only one pilot and projectiles damage the actual target', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    const pa = room.world.players[a.playerId], pb = room.world.players[b.playerId];
    space(pa); space(pb);
    room.world.pickups.push({ id: 'pod', x: 50000, y: 50000, vx: 0, vy: 0, amount: 3, expiresAt: 100 });
    room.tick(tuning.fixedStep, 1000);
    assert.equal(pa.player.cargo + pb.player.cargo, 3);
    assert.equal(room.world.pickups.length, 0);
    pa.player.x = 49000;
    room.world.projectiles.push({ id: 'hit', source: 'player', owner: a.playerId, x: 49900, y: 50000,
        vx: 20000, vy: 0, radius: 3, expiresAt: 5 });
    room.tick(tuning.fixedStep, 1000);
    assert.equal(pb.player.fuel, 95);
    assert.equal(pa.player.fuel, 100);
});

// Disconnect reservations expire, whereas online pilots receive a new grace period after a restart.
test('reconnect survives restart and abandoned territory expires without releasing other players', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    room.world.planets.moon.owner = a.playerId;
    room.world.planets.moon.level = 2;
    room.world.players[a.playerId].player.rocketTier = 3;
    const saved = structuredClone(room.saved());
    assert.equal(JSON.stringify(saved).includes(a.token), false);
    const restored = new GameRoom(saved, 900000);
    assert.equal(restored.world.planets.moon.owner, a.playerId);
    const resumed = restored.join(a.token, 910000);
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.playerId, a.playerId);
    assert.equal(restored.world.players[a.playerId].player.rocketTier, 3);
    restored.expire(930001);
    assert.ok(restored.world.players[a.playerId]);
    assert.equal(restored.world.players[b.playerId], undefined);
    restored.disconnect(a.playerId, 940000);
    restored.expire(970001);
    assert.equal(restored.world.planets.moon.owner, null);
    assert.equal(restored.world.planets.moon.level, 0);
});

// Rocket purchases are server-priced and each death downgrades at most once.
test('rocket purchases and one-tier death loss are authoritative and idempotent', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000);
    const actor = room.world.players[a.playerId];
    room.world.planets.moon.owner = a.playerId;
    Object.assign(actor.player, dockingPoint(bodies[1]), { docked: 'moon', cargo: 100 });
    withPlayer(room.world, a.playerId, () => {
        assert.equal(upgradeRocket(room.world).ok, true);
        assert.equal(room.world.player.rocketTier, 1);
        assert.equal(room.world.player.cargo, 92);
        killPlayer(room.world); killPlayer(room.world);
        assert.equal(room.world.player.rocketTier, 0);
    });
    assert.equal(actor.stats.deaths, 1);
    assert.equal(room.world.planets.moon.owner, a.playerId);
});

// Hidden ships and other pilots' hacking challenges never appear in a client's snapshot.
test('views hide distant pilots and never include reconnect credentials or other hack digits', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    space(room.world.players[a.playerId]); space(room.world.players[b.playerId], 60000);
    room.world.players[b.playerId].hack = { digit: 9 };
    const view = room.view(a.playerId);
    assert.equal(view.others.length, 0);
    assert.equal(view.players, undefined);
    assert.equal(JSON.stringify(view).includes(a.token), false);
    assert.equal(JSON.stringify(view).includes('tokenHash'), false);
    assert.equal(view.hack, null);
});

// Upgrade bonuses preserve ordinary high-speed thrust and correctly change each weapon tier.
test('rocket tiers add fading acceleration, fuel efficiency and staged weapon behavior', () => {
    const make = tier => {
        const room = new GameRoom(null, 1000); const joined = room.join('', 1000);
        const actor = room.world.players[joined.playerId]; space(actor); actor.player.rocketTier = tier;
        return { room, actor, id: joined.playerId };
    };
    const low = make(1), high = make(1), base = make(0);
    high.actor.player.vy = -10000;
    for (const entry of [low, high, base]) {
        entry.room.setInput(entry.id, { burn: true, fire: false, aimAngle: -Math.PI / 2, rcsX: 0, rcsY: 0 }, 1000);
        entry.room.tick(tuning.fixedStep, 1000);
    }
    assert.ok(-low.actor.player.vy > -base.actor.player.vy);
    const highAcceleration = -(high.actor.player.vy + 10000) / tuning.fixedStep;
    assert.ok(highAcceleration >= tuning.mainAcceleration && highAcceleration < tuning.mainAcceleration * 1.02);
    const tier2 = make(2), tier3 = make(3);
    for (const entry of [tier2, tier3]) {
        entry.room.setInput(entry.id, { burn: true, fire: false, aimAngle: -Math.PI / 2, rcsX: 0, rcsY: 0 }, 1000);
        entry.room.tick(.1, 1000);
    }
    assert.ok(tier3.actor.player.fuel > tier2.actor.player.fuel);
    const twin = make(2), alternate = make(4);
    for (const entry of [twin, alternate]) {
        entry.room.setInput(entry.id, { burn: false, fire: true, aimAngle: 0, rcsX: 0, rcsY: 0 }, 1000);
        entry.room.tick(tuning.fixedStep, 1000);
    }
    assert.equal(twin.room.world.projectiles.length, 2);
    assert.equal(alternate.room.world.projectiles.length, 1);
    assert.ok(alternate.room.world.projectiles[0].vx > tuning.bulletSpeed);
    const firstY = alternate.room.world.projectiles[0].y;
    alternate.room.tick(.1, 1000);
    assert.equal(alternate.actor.stats.shots, 2);
    assert.ok((firstY - alternate.actor.player.y) * (alternate.room.world.projectiles.at(-1).y - alternate.actor.player.y) < 0);
    const overheatTime = tier => {
        const entry = make(tier);
        entry.room.setInput(entry.id, { burn: false, fire: true, aimAngle: 0, rcsX: 0, rcsY: 0 }, 1000);
        for (let tick = 0; tick < 1000 && !entry.actor.player.gunOverheatedUntil; tick++) entry.room.tick(tuning.fixedStep, 1000);
        return entry.actor.player.gunOverheatedUntil - tuning.gunOverheatDuration;
    };
    assert.ok(overheatTime(1) > overheatTime(0));
});

// An occupied receiver must not accept a second simultaneous hacker.
test('a relay receiver has one occupant and stale challenge responses cannot capture', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    for (const id of [a.playerId, b.playerId]) Object.assign(room.world.players[id].player,
        dockingPoint(bodies[1]), { landedOn: null, vx: 0, vy: 0 });
    assert.equal(room.action(a.playerId, { action: 'interact' }).ok, true);
    assert.equal(room.action(b.playerId, { action: 'interact' }).reason, 'OCCUPIED');
    const actor = room.world.players[a.playerId];
    const wrong = room.action(a.playerId, { action: 'digit', digit: actor.hack.digit, challengeId: actor.hack.challengeId - 1 });
    assert.equal(wrong.ok, false);
    assert.equal(actor.hack.progress, 0);
});

// A captured preferred spawn must not prevent a new pilot using another unoccupied neutral home.
test('home selection falls back safely and retargets a relay that becomes a protected home', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000);
    for (const [id, planet] of Object.entries(room.world.planets)) if (id !== 'moon') planet.owner = a.playerId;
    assert.equal(room.world.players[a.playerId].target.bodyId, 'moon');
    const b = room.join('', 1000);
    assert.equal(room.world.players[b.playerId].player.homeId, 'moon');
    assert.notEqual(room.world.players[a.playerId].target.bodyId, 'moon');
    assert.equal(room.world.planets.moon.home, true);
});
