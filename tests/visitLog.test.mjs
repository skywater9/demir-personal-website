import test from 'node:test';
import assert from 'node:assert/strict';
import { VisitQueue, queueKey, safeDetails, eventWrites, conquestActions, conquestTargets,
    conquestRanges, safeConquestDetails, ConquestTracker } from '../public/scripts/visitLogCore.mjs';

// Provide tab storage without introducing a browser or touching production services.
function memoryStorage() {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const sessionId = '12345678-1234-1234-1234-123456789abc';

test('captures what, on what, and when; refresh retains pending rows and sequence', () => {
    const storage = memoryStorage();
    const queue = new VisitQueue(storage, 1000, () => sessionId);
    queue.add('pageView', 'page', {}, 1000);
    queue.add('click', 'gameStart', {}, 4000);
    const restored = new VisitQueue(storage, 5000, () => assert.fail('must restore'));
    assert.equal(restored.state.sessionId, sessionId);
    assert.equal(restored.state.pending[1].elapsedMs, 3000);
    assert.equal(restored.add('gameLifecycle', 'flight', { action: 'started' }, 6000).sequence, 3);
    restored.acknowledge(restored.state.pending.slice(0, 2));
    assert.deepEqual(restored.state.pending.map(event => event.sequence), [3]);
});

test('new visits rotate after inactivity; corrupt or blocked storage cannot break gameplay', () => {
    const storage = memoryStorage();
    new VisitQueue(storage, 1000, () => sessionId);
    assert.equal(new VisitQueue(storage, 1801001, () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa').state.sequence, 0);
    storage.setItem(queueKey, '{broken');
    assert.doesNotThrow(() => new VisitQueue(storage, 1000, () => sessionId));
    const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    assert.doesNotThrow(() => new VisitQueue(blocked, 1000, () => sessionId).add('pageView', 'page', {}, 1000));
});

test('drops identity, URLs, text and unknown actions; bounds only approved gameplay metrics', () => {
    assert.deepEqual(safeDetails({ email: 'private@example.test', password: 'secret', text: 'typed',
        runId: 'linked-id', url: 'https://example.test/?secret=value', action: 'injected',
        fuel: Infinity, throttle: 500, routeIndex: -10, open: true }), { open: true, routeIndex: 0, throttle: 100 });
    const queue = new VisitQueue(null, 1000, () => sessionId);
    assert.equal(queue.add('click', 'private visitor text', {}, 1001).target, 'other');
    assert.equal(queue.add('unapproved', 'page'), null);
});

test('clock rollback stays monotonic and acknowledgement never discards newly captured rows', () => {
    const queue = new VisitQueue(null, 1000, () => sessionId);
    const first = queue.add('click', 'gameStart', {}, 4000);
    const second = queue.add('screenView', 'flight', {}, 3000);
    queue.acknowledge([first]);
    assert.equal(second.elapsedMs, 3000);
    assert.deepEqual(queue.state.pending, [second]);
});

test('REST commits create immutable deterministic rows and monotonic server summaries', () => {
    const queue = new VisitQueue(null, 1000, () => sessionId);
    queue.add('pageView', 'page', {}, 1000);
    queue.add('click', 'gameStart', {}, 2000);
    const writes = eventWrites('projects/test/databases/(default)/documents/visitLogs/test', queue.state.pending);
    assert.equal(writes[0].update.name.endsWith('/events/1'), true);
    assert.deepEqual(writes[0].currentDocument, { exists: false });
    assert.deepEqual(writes[0].updateTransforms, [{ fieldPath: 'receivedAt', setToServerValue: 'REQUEST_TIME' }]);
    assert.equal(writes[2].transform.fieldTransforms[0].maximum.integerValue, '2000');
    assert.equal(writes[2].transform.fieldTransforms[1].maximum.integerValue, '2');
    assert.ok(Buffer.byteLength(JSON.stringify(writes)) < 48000);
});

test('per-visit limit stops allocating rows without affecting the game', () => {
    const queue = new VisitQueue(null, 1000, () => sessionId);
    queue.state.sequence = 4999;
    assert.equal(queue.add('pageLeave', 'page', {}, 2000).sequence, 5000);
    assert.equal(queue.add('click', 'gameStart', {}, 3000), null);
});

test('conquest snapshots preserve approved outcomes and strip game identity and raw inputs', () => {
    const snapshot = { gameplaySeconds: 120.125, fuel: 63.456, cargo: 200, owned: 3, planetLevel: 2 };
    for (const action of conquestActions) {
        for (const target of conquestTargets) {
            const queue = new VisitQueue(null, 1000, () => sessionId);
            const event = queue.add('conquest', target, { action, ...snapshot, amount: 25,
                x: 1234, y: 5678, digit: 7, planetName: 'private-planet', playerId: 'private-player',
                roomId: 'private-room', credential: 'private-token', target: 'private-target' }, 2000);
            assert.equal(event.target, target);
            assert.deepEqual(event.details, { action, gameplaySeconds: 120.13, fuel: 63.46,
                cargo: 200, owned: 3, planetLevel: 2, amount: 25 });
            assert.equal(JSON.stringify(event).includes('private-'), false);
        }
    }
    assert.equal(safeDetails({ action: 'captured', cargo: 2 }).action, undefined, 'Legacy schema stays separate.');
    assert.deepEqual(safeConquestDetails({ action: 'joined' }), { action: 'joined' });
    assert.deepEqual(safeConquestDetails({ action: 'hackProgress' }), { action: 'hackProgress' });
    assert.deepEqual(safeDetails(null), {});
});

test('conquest rejects invalid snapshots and labels without allocating a sequence or corrupting the outbox', () => {
    const queue = new VisitQueue(null, 1000, () => sessionId);
    for (const [key, maximum] of Object.entries(conquestRanges)) {
        for (const value of [-1, maximum + 1, NaN, Infinity, -Infinity, '1', null, true, {}]) {
            assert.equal(queue.add('conquest', 'conquest', { action: 'joined', [key]: value }, 2000), null, `${key}: ${value}`);
        }
        assert.notEqual(safeConquestDetails({ action: 'joined', [key]: maximum }), null);
        assert.notEqual(safeConquestDetails({ action: 'joined', [key]: 0 }), null);
        if (!['gameplaySeconds', 'fuel'].includes(key)) assert.equal(safeConquestDetails({ action: 'joined', [key]: 0.5 }), null);
    }
    for (const target of ['private planet', 'planet-1', 'gameStart', '', null]) {
        assert.equal(queue.add('conquest', target, { action: 'joined' }, 2000), null);
    }
    for (const input of [null, [], {}, { action: 'private-action' }, { action: 'started' }]) {
        assert.equal(safeConquestDetails(input), null);
    }
    // An omitted target defaults to the fixed product label, never arbitrary DOM text.
    assert.equal(queue.state.sequence, 0);
    assert.equal(queue.add('conquest', undefined, { action: 'joined' }, 2000).target, 'conquest');
    assert.equal(queue.state.pending.length, 1);
    assert.equal(queue.state.pending[0].target, 'conquest');
});

test('held fire and hack milestones bound rows and keep terminal outcomes available', () => {
    const tracker = new ConquestTracker();
    assert.ok(tracker.accept({ action: 'shotStarted' }));
    for (let index = 0; index < 1000; index++) assert.equal(tracker.accept({ action: 'shotStarted' }), null);
    assert.deepEqual(tracker.accept({ action: 'shotEnded', amount: 120 }).details, { action: 'shotEnded', amount: 120 });
    assert.equal(tracker.accept({ action: 'shotEnded' }), null);
    assert.ok(tracker.accept({ action: 'shotStarted' }));
    assert.ok(tracker.accept({ action: 'died' }));
    assert.ok(tracker.accept({ action: 'shotStarted' }));
    assert.ok(tracker.accept({ action: 'hackStarted', target: 'relay' }));
    assert.equal(tracker.accept({ action: 'hackStarted', target: 'relay' }), null);
    assert.ok(tracker.accept({ action: 'hackProgress' }), 'A count is optional, with one unnumbered milestone per hack.');
    assert.equal(tracker.accept({ action: 'hackProgress' }), null);
    let milestones = 0;
    for (let amount = 0; amount < 1000; amount++) {
        if (tracker.accept({ action: 'hackProgress', amount })) milestones++;
    }
    assert.equal(milestones, 20);
    assert.equal(tracker.accept({ action: 'hackProgress', amount: 25 }), null);
    assert.ok(tracker.accept({ action: 'captured', owned: 2 }));
    assert.ok(tracker.accept({ action: 'hackStarted' }));
    assert.ok(tracker.accept({ action: 'hackProgress', amount: 5 }));
});

test('legacy rows and conquest rows survive refresh together with stable retry IDs', () => {
    const storage = memoryStorage();
    const queue = new VisitQueue(storage, 1000, () => sessionId);
    queue.add('gameLifecycle', 'flight', { action: 'delivered', routeIndex: 1, deliveries: 1 }, 1100);
    queue.add('screenView', 'servers', {}, 1200);
    queue.add('screenView', 'records', {}, 1300);
    queue.add('controlPress', 'fire', {}, 1400);
    queue.add('conquest', 'planet', { action: 'captured', cargo: 0, owned: 2, planetLevel: 0 }, 1500);
    const restored = new VisitQueue(storage, 1600, () => assert.fail('visit must be retained'));
    assert.deepEqual(restored.state.pending, queue.state.pending);
    assert.deepEqual(eventWrites('projects/test/documents/visitLogs/test', restored.state.pending),
        eventWrites('projects/test/documents/visitLogs/test', queue.state.pending));
    assert.equal(restored.add('conquest', 'conquest', { action: 'continued' }, 1700).sequence, 6);
});


test('damage outcomes require positive fuel loss and remaining fuel, without leaking hit coordinates', () => {
    const queue = new VisitQueue(null, 1000, () => sessionId);
    assert.equal(queue.add('conquest', 'conquest', { action: 'damaged', fuel: 20 }, 2000), null);
    assert.equal(queue.add('conquest', 'conquest', { action: 'damaged', amount: 0, fuel: 20 }, 2000), null);
    assert.equal(queue.add('conquest', 'conquest', { action: 'damaged', amount: 5 }, 2000), null);
    const event = queue.add('conquest', 'conquest', { action: 'damaged', amount: 5, fuel: 0,
        x: 300, y: -700, reason: 'private hit metadata' }, 2000);
    assert.deepEqual(event.details, { action: 'damaged', fuel: 0, amount: 5 });
});
