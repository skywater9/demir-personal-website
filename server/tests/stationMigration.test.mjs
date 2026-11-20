import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameRoom } from '../room.mjs';
import { migrateStationHomes, GalaxyStore, validateSave } from '../persistence.mjs';
import { starterStations } from '../../public/scripts/conquestPhysics.mjs';

// Reconstruct an old-format saved room while keeping generated private pilot fields realistic.
function legacySave() {
    const room = new GameRoom(null, 1000);
    const { playerId } = room.join('', 1000);
    const data = structuredClone(room.saved());
    const actor = data.world.players[playerId];
    for (const station of starterStations) delete data.world.planets[station.id];
    Object.assign(data.world.planets.earth, { home: true, owner: playerId });
    Object.assign(data.world.planets.moon, { owner: playerId, level: 0 });
    Object.assign(actor.player, { homeId: 'earth', cargo: 17, fuel: 44, rocketTier: 2 });
    return { data, playerId };
}

test('migration preserves territory, resources, session hashes and rocket upgrades', () => {
    const { data, playerId } = legacySave();
    const result = migrateStationHomes(data);
    assert.equal(result.migrated, true);
    assert.doesNotThrow(() => validateSave(result.data));
    const actor = result.data.world.players[playerId];
    assert.equal(actor.player.homeId, 'station-1');
    assert.equal(actor.player.cargo, 17);
    assert.equal(actor.player.fuel, 44);
    assert.equal(actor.player.rocketTier, 2);
    assert.equal(result.data.world.planets.moon.owner, playerId);
    assert.equal(result.data.world.planets.earth.owner, playerId);
    assert.equal(result.data.world.planets.earth.home, false);
    assert.deepEqual(result.data.sessions, data.sessions);
    assert.equal(migrateStationHomes(result.data).migrated, false);
    assert.equal(data.world.players[playerId].player.homeId, 'earth');
});

test('load creates a private exact backup before returning migrated state', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'station-migration-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'galaxy.json');
    const original = JSON.stringify(legacySave().data);
    await writeFile(file, original);
    const migrated = await new GalaxyStore(file).load();
    assert.ok(migrated.world.planets['station-1']);
    assert.equal(await readFile(file, 'utf8'), original);
    const backup = (await readdir(dir)).find(name => name.endsWith('.bak'));
    assert.equal(await readFile(join(dir, backup), 'utf8'), original);
    assert.equal((await stat(join(dir, backup))).mode & 0o777, 0o600);
});
