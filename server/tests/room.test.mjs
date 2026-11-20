import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../room.mjs';
import { validateSave } from '../persistence.mjs';
import { blackHole, bodies, dockingPoint, tuning, withPlayer, killPlayer, upgradeRocket } from '../../public/scripts/conquestPhysics.mjs';

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
    assert.ok(pb.player.damageFlashUntil > room.world.elapsed);
    assert.equal(pa.player.damageFlashUntil, undefined);
    pa.player.x = pb.player.x - 500;
    const target = room.view(a.playerId).others.find(player => player.id === b.playerId);
    assert.equal(target.damageFlashUntil, pb.player.damageFlashUntil);
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
    Object.assign(actor.player, dockingPoint(bodies.find(body => body.id === actor.player.homeId)), { docked: actor.player.homeId, cargo: 100 });
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

// Full distant ship details and other pilots' hacking challenges stay out of snapshots.
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

// Planet hackers can compete without occupying a relay; stale inputs cannot advance either challenge.
test('planet capture permits competing hackers and rejects stale challenge responses', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    for (const id of [a.playerId, b.playerId]) Object.assign(room.world.players[id].player,
        dockingPoint(bodies[1]), { landedOn: null, vx: 0, vy: 0 });
    assert.equal(room.action(a.playerId, { action: 'interact' }).ok, true);
    assert.equal(room.action(b.playerId, { action: 'interact' }).ok, true);
    const actor = room.world.players[a.playerId];
    const wrong = room.action(a.playerId, { action: 'digit', digit: actor.hack.digit, challengeId: actor.hack.challengeId - 1 });
    assert.equal(wrong.ok, false);
    assert.equal(actor.hack.progress, 0);
});

// Captured planets never consume station reservations for a newly joining pilot.
test('new pilots reserve free stations even when every planet is already owned', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000);
    for (const body of bodies.filter(body => !body.station)) room.world.planets[body.id].owner = a.playerId;
    const b = room.join('', 1000);
    assert.ok(room.world.players[b.playerId].player.homeId.startsWith('station-'));
    assert.notEqual(room.world.players[a.playerId].player.homeId, room.world.players[b.playerId].player.homeId);
    assert.equal(room.world.planets.moon.owner, a.playerId);
    assert.equal(room.world.planets.moon.home, false);
});

// Turret aim and recovery are shared state, not inferred separately for each viewer.
test('turret owner and attacker see the same tracking head and disabled turrets stop firing', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    const body = bodies[1], planet = room.world.planets[body.id];
    Object.assign(planet, { owner: a.playerId, level: 2 });
    const owner = room.world.players[a.playerId], enemy = room.world.players[b.playerId];
    space(owner, body.x - 500);
    Object.assign(owner.player, { y: body.y - 500 });
    Object.assign(enemy.player, { x: body.x + 500, y: body.y - body.radius - 400, landedOn: null });
    room.tick(tuning.fixedStep, 1000);
    const firstAngle = planet.turrets[0].angle;
    assert.ok(Number.isFinite(firstAngle));
    assert.notEqual(firstAngle, -Math.PI / 2);
    assert.equal(room.view(a.playerId).planets.moon.turrets[0].angle, room.view(b.playerId).planets.moon.turrets[0].angle);
    enemy.player.x -= 100;
    room.tick(tuning.fixedStep, 1000);
    assert.notEqual(planet.turrets[0].angle, firstAngle);
    // Model the server-confirmed disable state and verify no gunfire until recovery completes.
    planet.turrets[0].health = 0;
    planet.turrets[0].disabledUntil = room.world.elapsed + 10;
    planet.turrets[1].health = 0;
    planet.turrets[1].disabledUntil = room.world.elapsed + 10;
    room.world.projectiles = [];
    for (let index = 0; index < 5; index++) room.tick(1, 1000);
    assert.equal(room.world.projectiles.filter(shot => shot.source === 'turret').length, 0);
    assert.ok(planet.turrets[0].health > 2 && planet.turrets[0].health < 3);
});

// Every spawn slot should direct a newcomer toward a capturable relay near its home system.
test('all eight home slots begin with a neutral relay target, not just Earth', () => {
    const room = new GameRoom(null, 1000);
    for (let index = 0; index < 8; index++) {
        const joined = room.join('', 1000);
        const view = room.view(joined.playerId);
        assert.equal(view.target.type, 'relay');
        assert.notEqual(view.target.bodyId, view.player.homeId);
        assert.equal(view.planets[view.target.bodyId].owner, null);
        assert.equal(view.planets[view.target.bodyId].home, false);
    }
});

// Distant map markers contain only public identity and position, while flight views retain proximity limits.
test('map snapshots reveal all pilot positions without exposing cargo, fuel or credentials', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    const pa = room.world.players[a.playerId], pb = room.world.players[b.playerId];
    space(pa); space(pb, 90000);
    const view = room.view(a.playerId);
    assert.ok(!view.others.some(player => player.id === b.playerId));
    const marker = view.mapPlayers.find(player => player.id === b.playerId);
    assert.equal(marker.x, pb.player.x);
    assert.equal(marker.fuel, undefined); assert.equal(marker.cargo, undefined); assert.equal(marker.token, undefined);
});

// Attribution is emitted only when a shot is fatal, so chat can name the correct generated pilot.
test('fatal projectile identifies its attacker for the shared death announcement', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000);
    space(room.world.players[a.playerId], 49000); space(room.world.players[b.playerId]);
    room.world.players[b.playerId].player.fuel = 4;
    room.world.projectiles.push({ id: 'kill', owner: a.playerId, source: 'player', x: 49900, y: 50000,
        vx: 20000, vy: 0, radius: 3, expiresAt: 5 });
    room.tick(tuning.fixedStep, 1000);
    const death = room.world.events.find(event => event.type === 'died' && event.playerId === b.playerId);
    assert.equal(death.attackerId, a.playerId); assert.equal(death.source, 'player');
    assert.equal(room.saved().notices, undefined);
});

// Online pilots use the same full-vector brake while the snapshot exposes the remote plume cue.
test('authoritative braking cancels sideways drift at arbitrary heading', () => {
    const room = new GameRoom(null, 1000);
    const joined = room.join('', 1000);
    const actor = room.world.players[joined.playerId];
    space(actor);
    Object.assign(actor.player, { vx: 80, vy: -60, angle: .7 });
    room.setInput(joined.playerId, { burn: false, fire: false, rcsX: 0, rcsY: 1, aimAngle: null }, 1000);
    room.tick(.1, 1000);
    assert.ok(actor.player.vx < 80 && actor.player.vx > 0);
    assert.ok(actor.player.vy > -60 && actor.player.vy < 0);
    assert.ok(Math.abs(actor.player.vx / actor.player.vy + 4 / 3) < 1e-9);
    assert.equal(actor.player.braking, true);
    for (let frame = 0; frame < 20; frame++) room.tick(.1, 1000);
    assert.equal(actor.player.vx, 0); assert.equal(actor.player.vy, 0);
});

// Exercise current ownership and the full escrow lifecycle with a real projectile.
test('leaderboard ranks current holdings and bounties persist, pay, and refund', () => {
    const room = new GameRoom(null, 1000);
    const a = room.join('', 1000), b = room.join('', 1000), c = room.join('', 1000);
    const legacy = structuredClone(room.saved());
    delete legacy.world.bounties;
    const migrated = new GameRoom(validateSave(legacy), 2000);
    migrated.expire(33000);
    assert.equal(Object.keys(migrated.sessions).length, 3);
    const pa = room.world.players[a.playerId];
    const pb = room.world.players[b.playerId];
    const pc = room.world.players[c.playerId];
    const moon = room.world.planets.moon;
    moon.owner = a.playerId;
    room.world.planets[blackHole.id].owner = c.playerId;
    assert.equal(room.leaderboard()[0].id, a.playerId);
    assert.equal(room.leaderboard().find(row => row.id === c.playerId).held, 0);
    moon.owner = b.playerId;
    assert.deepEqual(room.leaderboard().map(row => row.held), [1, 0, 0]);
    assert.equal(room.leaderboard()[0].id, b.playerId);
    pa.player.cargo = 15;
    pc.player.cargo = 11;
    const post = (issuer, target, amount) => room.action(issuer.playerId, { action: 'placeBounty', targetId: target.playerId, amount });
    assert.equal(post(a, a, 1).ok, false);
    assert.equal(post(a, b, 1.5).ok, false);
    assert.equal(post(a, b, 16).ok, false);
    assert.equal(post(a, b, 5).ok, true);
    assert.equal(post(a, b, 2).ok, true);
    assert.equal(post(c, b, 3).ok, true);
    assert.equal(pa.player.cargo, 8);
    assert.equal(room.leaderboard()[0].bounty, 10);
    const saved = validateSave(structuredClone(room.saved()));
    const restored = new GameRoom(saved, 2000);
    assert.equal(restored.leaderboard()[0].bounty, 10);
    assert.equal(restored.world.planets.moon.owner, b.playerId);
    assert.equal(restored.join(b.token, 2500).resumed, true);

    room.action(b.playerId, { action: 'selfDestruct' });
    assert.equal(room.leaderboard()[0].bounty, 10);
    pb.player.deadUntil = 0;
    pb.player.fuel = 4;
    space(pa, 48000); space(pb); space(pc, 49000);
    room.world.projectiles.push({ id: 'bounty-hit', owner: c.playerId, source: 'player',
        x: 49900, y: 50000, vx: 20000, vy: 0, radius: 3, expiresAt: 5 });
    room.tick(tuning.fixedStep, 1000);
    assert.equal(pc.player.cargo, 18);
    assert.equal(room.world.events.find(event => event.bountyPaid)?.bountyPaid, 10);
    assert.equal(room.leaderboard()[0].bounty, 0);

    assert.equal(post(a, b, 4).ok, true);
    room.leave(b.playerId);
    assert.equal(pa.player.cargo, 8);
    assert.equal(room.leaderboard().some(row => row.id === b.playerId), false);
    assert.doesNotThrow(() => validateSave(room.saved()));
});

// Keep the nearby visual budget separate from the full server-side cargo pool.
test('flight snapshots send only the nearest cargo and preserve the full saved pool', () => {
    const room = new GameRoom(null, 1000);
    const { playerId } = room.join('', 1000);
    const { x, y } = room.world.players[playerId].player;
    const cargo = Array.from({ length: 230 }, (_, index) => ({
        id: `near-${index}`, x: x + index + 14.24, y, vx: -20, vy: 0, amount: 1, expiresAt: 120
    })).reverse();
    cargo.push({ id: 'distant', x: x + 5000, y, vx: 0, vy: 0, amount: 10, expiresAt: 120 });
    room.world.pickups = cargo;
    const visible = room.flightView(playerId).pickups;
    assert.equal(visible.length, 192);
    assert.equal(visible[0].id, 'near-0');
    assert.equal(visible.at(-1).id, 'near-191');
    assert.equal(visible[0].x, Math.round((x + 14.24) * 10) / 10);
    assert.equal(visible[0].vx, undefined);
    assert.equal(room.view(playerId).pickups.length, 231);
    assert.equal(room.saved().world.pickups.at(-1).id, 'distant');
});
