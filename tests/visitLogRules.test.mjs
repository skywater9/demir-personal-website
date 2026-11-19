import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { eventWrites, firestoreValue, conquestActions, conquestTargets, conquestRanges, targets } from '../public/scripts/visitLogCore.mjs';
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);

// Exercise the real deployed rule language through Firebase's emulators, including owner-only queries.
test('Spark log rules enforce ownership, strict privacy schema, append-only events and owner queries', { skip: !enabled }, async () => {
    const project = 'demo-website-analytics';
    const api = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/`;
    const authApi = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:`;
    // Obtain real emulator-issued auth tokens so Firestore evaluates ordinary client permissions.
    async function authRequest(method, body) {
        const response = await fetch(`${authApi}${method}?key=fake`, { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json();
        assert.equal(response.ok, true, JSON.stringify(result));
        return result;
    }
    const writer = await authRequest('signUp', { returnSecureToken: true });
    const stranger = await authRequest('signUp', { returnSecureToken: true });
    const require = createRequire(new URL('../functions/package.json', import.meta.url));
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const admin = initializeApp({ projectId: project }, `rules-${randomUUID()}`);
    const ownerEmail = `owner-${randomUUID()}@example.test`;
    const owner = await getAuth(admin).createUser({ email: ownerEmail, password: 'emulator-only-pass123' });
    await getAuth(admin).setCustomUserClaims(owner.uid, { analyticsOwner: true });
    const ownerToken = (await authRequest('signInWithPassword', { email: ownerEmail,
        password: 'emulator-only-pass123', returnSecureToken: true })).idToken;
    const sessionId = randomUUID();
    const root = `projects/${project}/databases/(default)/documents/visitLogs/${sessionId}`;
    const now = Date.now();
    const visit = { sessionId, writerId: writer.localId, startedAt: now, lastEventAt: now, lastSequence: 0 };
    // Submit client REST calls without any admin bypass.
    async function call(path, token, body) {
        return fetch(`${api}${path}`, { method: body ? 'POST' : 'GET',
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}) });
    }
    // Commit a document with server timestamps exactly as the browser's transport does.
    async function commit(writes, token = writer.idToken, expected = 200) {
        const response = await call(`projects/${project}/databases/(default)/documents:commit`, token, { writes });
        const result = await response.json();
        assert.equal(response.status, expected, JSON.stringify(result));
        return result;
    }
    // Generate an append-only test event with the real client encoder.
    function event(sequence, extra = {}) {
        return { sessionId, sequence, eventName: 'click', target: 'gameStart', recordedAt: now + sequence,
            elapsedMs: sequence, details: {}, ...extra };
    }
    try {
        assert.equal((await call(root, writer.idToken)).status, 404);
        await commit([{ update: { name: root, fields: firestoreValue(visit).mapValue.fields },
            currentDocument: { exists: false }, updateTransforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }
            ] }]);
        await commit(eventWrites(root, [event(1), event(2)]));
        assert.equal((await call(root, stranger.idToken)).status, 403);
        assert.equal((await call(`${root}/events/1`, stranger.idToken)).status, 403);
        assert.equal((await call(`${root}/events/1`, writer.idToken)).status, 200);
        // Retry conflict must never overwrite an existing event.
        await commit(eventWrites(root, [event(1)]), writer.idToken, 409);
        await commit(eventWrites(root, [event(3)]), stranger.idToken, 403);
        await commit(eventWrites(root, [event(3, { details: { email: 'private@example.test' } })]), writer.idToken, 403);
        await commit(eventWrites(root, [event(3, { details: { action: 'arbitrary visitor text' } })]), writer.idToken, 403);
        await commit(eventWrites(root, [event(3, { target: 'private text' })]), writer.idToken, 403);
        await commit(eventWrites(root, [event(3, { details: { fuel: -1 } })]), writer.idToken, 403);
        await commit(eventWrites(root, [event(5001)]), writer.idToken, 403);
        await commit([{ update: { name: root, fields: { writerId: { stringValue: stranger.localId } } },
            updateMask: { fieldPaths: ['writerId'] } }], writer.idToken, 403);
        await commit([{ delete: `${root}/events/1` }], writer.idToken, 403);
        const listVisits = { structuredQuery: { from: [{ collectionId: 'visitLogs' }],
            orderBy: [{ field: { fieldPath: 'startedAt' }, direction: 'DESCENDING' }], limit: 25 } };
        assert.equal((await call(`projects/${project}/databases/(default)/documents:runQuery`, writer.idToken, listVisits)).status, 403);
        assert.equal((await call(`projects/${project}/databases/(default)/documents:runQuery`, ownerToken, listVisits)).status, 200);
        const listEvents = { structuredQuery: { from: [{ collectionId: 'events' }],
            orderBy: [{ field: { fieldPath: 'sequence' }, direction: 'ASCENDING' }], limit: 100 } };
        const response = await call(`${root}:runQuery`, ownerToken, listEvents);
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).filter(row => row.document).map(row => row.document.fields.sequence.integerValue), ['1', '2']);
        // Out-of-order arrival updates neither roll back the summary nor reject missing earlier rows.
        await commit(eventWrites(root, [event(5)]));
        await commit(eventWrites(root, [event(3), event(4)]));
        const summary = await (await call(root, ownerToken)).json();
        assert.equal(summary.fields.lastSequence.integerValue, '5');
        assert.equal(summary.fields.lastEventAt.integerValue, String(now + 5));
        // A full twelve-row browser chunk must stay within Firestore's batched rules access limits.
        await commit(eventWrites(root, Array.from({ length: 12 }, (_, index) => event(index + 6))));
        const fullBatch = await (await call(root, ownerToken)).json();
        assert.equal(fullBatch.fields.lastSequence.integerValue, '17');
        await commit(eventWrites(`${root}-missing`, [event(1)]), writer.idToken, 403);

        // Exercise the new schema through raw REST writes so client-side projection cannot hide rule gaps.
        let sequence = 18;
        const conquestEvents = conquestActions.map(action => event(sequence++, { eventName: 'conquest', target: 'planet',
            details: { action, gameplaySeconds: 120.5, fuel: 70.5, cargo: 200, owned: 3, planetLevel: 2, amount: 25 } }));
        const targetEvents = targets.map(target => event(sequence++, { target }));
        for (const target of conquestTargets) conquestEvents.push(event(sequence++, {
            eventName: 'conquest', target, details: { action: 'joined' }
        }));
        conquestEvents.push(event(sequence++, { eventName: 'conquest', target: 'relay', details: { action: 'hackProgress' } }));
        const acceptedEvents = [...conquestEvents, ...targetEvents];
        for (let offset = 0; offset < acceptedEvents.length; offset += 12) {
            await commit(eventWrites(root, acceptedEvents.slice(offset, offset + 12)));
        }
        for (const [key, maximum] of Object.entries(conquestRanges)) {
            await commit(eventWrites(root, [event(sequence++, { eventName: 'conquest', target: 'conquest',
                details: { action: 'joined', [key]: maximum } })]));
            for (const value of [-1, maximum + 1, '1', true, {}, ...(['gameplaySeconds', 'fuel'].includes(key) ? [] : [0.5])]) {
                await commit(eventWrites(root, [event(sequence, { eventName: 'conquest', target: 'conquest',
                    details: { action: 'joined', [key]: value } })]), writer.idToken, 403);
            }
        }
        for (const details of [
            {}, { action: 'started' }, { action: 'private-action' }, { action: 'joined', x: 123 },
            { action: 'joined', digit: 7 }, { action: 'joined', planetName: 'Earth' },
            { action: 'joined', playerId: 'private-player' }, { action: 'joined', roomId: 'private-room' },
            { action: 'joined', credential: 'private-token' }, { action: 'joined', routeIndex: 1 },
            { action: 'joined', text: 'x'.repeat(20000) },
            { action: 'hackProgress', amount: 1 }, { action: 'hackProgress', amount: 101 },
            { action: 'hackProgress', amount: 7 },
            { action: 'damaged', amount: 0, fuel: 20 },
            { action: 'damaged', amount: 5 },
            { action: 'damaged', fuel: 20 }
        ]) {
            await commit(eventWrites(root, [event(sequence, { eventName: 'conquest', target: 'conquest', details })]), writer.idToken, 403);
        }
        for (const target of ['gameStart', 'planet-1', 'private-planet']) {
            await commit(eventWrites(root, [event(sequence, { eventName: 'conquest', target,
                details: { action: 'joined' } })]), writer.idToken, 403);
        }
        for (const [key, value] of [['fuel', { doubleValue: 'NaN' }], ['fuel', { doubleValue: 'Infinity' }],
            ['amount', { nullValue: null }], ['target', { nullValue: null }]]) {
            const writes = eventWrites(root, [event(sequence, { eventName: 'conquest', target: 'conquest', details: { action: 'joined' } })]);
            const fields = writes[0].update.fields;
            if (key === 'target') fields.target = value;
            else fields.details.mapValue.fields[key] = value;
            await commit(writes, writer.idToken, 403);
        }
        await commit(eventWrites(root, [event(sequence, { details: { action: 'captured', cargo: 100 } })]), writer.idToken, 403);
        await commit(eventWrites(root, [event(sequence, { eventName: 'conquest', target: 'relay',
            details: { action: 'captured' }, extra: 'private-value' })]), writer.idToken, 403);
        await commit(eventWrites(root, [event(sequence, { recordedAt: now + 90000000, elapsedMs: 90000000 })]), writer.idToken, 403);
        await commit(eventWrites(root, [event(sequence)]), ownerToken, 403);
        await commit([{ update: { name: `${root}/events/18`, fields: firestoreValue({ details: { action: 'reset' } }).mapValue.fields },
            updateMask: { fieldPaths: ['details'] } }], writer.idToken, 403);
        await commit([{ delete: root }], writer.idToken, 403);
        assert.equal((await call(root)).status, 403);
        assert.equal((await call(`${root}/events/18`, stranger.idToken)).status, 403);
        assert.equal((await call(`${root}/events/18`, writer.idToken)).status, 200);
        assert.equal((await call(`${root}:runQuery`, writer.idToken, listEvents)).status, 403);
        assert.equal((await call(`${root}:runQuery`, undefined, listEvents)).status, 403);
        const remote = await (await call(`${root}:runQuery`, ownerToken, listEvents)).json();
        const remoteRows = remote.filter(row => row.document).map(row => row.document.fields);
        assert.equal(remoteRows[0].eventName.stringValue, 'click', 'Historical rows remain readable.');
        assert.equal(remoteRows[17].details.mapValue.fields.action.stringValue, 'joined');
        assert.equal(remoteRows[17].details.mapValue.fields.cargo.integerValue, '200');
        // The owner's existing sequence cursor also works across the old/new event boundary.
        const page = { structuredQuery: { ...listEvents.structuredQuery, limit: 10,
            startAt: { values: [{ integerValue: '17' }], before: false } } };
        const paged = await (await call(`${root}:runQuery`, ownerToken, page)).json();
        assert.equal(paged.filter(row => row.document)[0].document.fields.sequence.integerValue, '18');
    } finally { await deleteApp(admin); }
});
