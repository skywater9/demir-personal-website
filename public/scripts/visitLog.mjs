import { firebaseConfig } from './firebaseConfig.js?v=20261118-conquest';
import { VisitQueue, targets, eventWrites, firestoreValue } from './visitLogCore.mjs?v=20261118-fuel-damage';

const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
// Production is automatic; local play never writes test visits into the owner's production log.
if (!local) startLogging();
else {
    // Resolve the current menu node even when the app mounts it after this module starts.
    function showLocalStatus() {
        const status = document.getElementById('eventLogStatus');
        if (status) status.textContent = 'EVENT LOG / LOCAL PLAY — NOT UPLOADED';
    }
    showLocalStatus();
    setInterval(showLocalStatus, 5000);
}

// Attach listeners immediately, before Firebase downloads, so the visitor's first action is retained.
function startLogging() {
    let storage;
    try { storage = sessionStorage; } catch { /* Retain an in-memory visit if tab storage is blocked. */ }
    const queue = new VisitQueue(storage);
    let statusMessage = 'EVENT LOG / CONNECTING';
    let fireHeld = false;
    let token = null;
    let ready = false;
    let sending = false;
    let inFlight = new Set();
    let away = false;
    let retryAt = 0;
    let retryDelay = 5000;
    const project = firebaseConfig.projectId;
    const documentRoot = `projects/${project}/databases/(default)/documents/visitLogs/${queue.state.sessionId}`;
    const api = 'https://firestore.googleapis.com/v1/';

    // Expose honest persistence state without interrupting flight controls.
    function showStatus(message) {
        statusMessage = message;
        const status = document.getElementById('eventLogStatus');
        if (status) status.textContent = message;
    }

    // Record a semantic step; immediate local persistence protects against ordinary refreshes.
    function record(name, target = 'page', details = {}) {
        const event = queue.add(name, target, details);
        if (!event) return null;
        if (queue.state.sequence >= 5000) showStatus('EVENT LOG / VISIT LIMIT REACHED');
        else showStatus('EVENT LOG / SAVING');
        if (queue.state.pending.length >= 12) void flush();
        return event;
    }

    // Mark the first intentional action once for the complete tab visit, including refreshes.
    function firstAction(target) {
        if (queue.state.firstAction) return;
        queue.state.firstAction = true;
        record('firstAction', target);
    }

    // Send small authenticated requests that the browser may finish after pagehide.
    async function request(path, options = {}) {
        const response = await fetch(`${api}${path}`, { ...options, keepalive: true,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
        if (!response.ok) {
            const error = new Error(`Event log request failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return response.status === 204 ? {} : response.json();
    }

    // Create the visit once, preserving immutable identity and initial timestamps after a refresh.
    async function prepareVisit(user) {
        try { await request(documentRoot); }
        catch (error) {
            if (error.status !== 404) throw error;
            const data = { sessionId: queue.state.sessionId, writerId: user.uid, startedAt: queue.state.startedAt,
                lastEventAt: queue.state.startedAt, lastSequence: 0 };
            await request(`projects/${project}/databases/(default)/documents:commit`, {
                method: 'POST', body: JSON.stringify({ writes: [{ update: { name: documentRoot,
                    fields: firestoreValue(data).mapValue.fields }, currentDocument: { exists: false }, updateTransforms: [
                    { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                    { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }
                ] }] })
            });
        }
    }

    // Retry uncertain commits by reading deterministic event IDs; duplicates never create extra log rows.
    async function sendChunk(events) {
        try {
            await request(`projects/${project}/databases/(default)/documents:commit`, {
                method: 'POST', body: JSON.stringify({ writes: eventWrites(documentRoot, events) })
            });
        } catch (error) {
            if (![409, 400].includes(error.status)) throw error;
            const missing = [];
            for (const event of events) {
                try { await request(`${documentRoot}/events/${event.sequence}`); }
                catch (readError) {
                    if (readError.status !== 404) throw readError;
                    missing.push(event);
                }
            }
            if (missing.length === events.length) throw error;
            if (missing.length) await sendChunk(missing);
        }
    }

    // Drain the persisted outbox in order, backing off when Spark quotas or the network are unavailable.
    async function flush() {
        if (!ready || sending || Date.now() < retryAt || !queue.state.pending.length) return;
        sending = true;
        try {
            while (queue.state.pending.length) {
                const chunk = queue.state.pending.slice(0, 12);
                inFlight = new Set(chunk.map(event => event.sequence));
                await sendChunk(chunk);
                queue.acknowledge(chunk);
            }
            retryDelay = 5000;
            showStatus(queue.state.sequence >= 5000 ? 'EVENT LOG / VISIT LIMIT REACHED' : 'EVENT LOG / SAVED');
        } catch {
            retryAt = Date.now() + retryDelay;
            retryDelay = Math.min(60000, retryDelay * 2);
            showStatus('EVENT LOG / PENDING — RETRYING');
        } finally { sending = false; inFlight.clear(); }
    }

    // Deduplicate blur/hidden/pagehide while retaining a final event and attempting its immediate upload.
    function leave() {
        // The app may clear held controls after this listener; retain that final release edge.
        if (!away) { fireHeld = null; away = true; record('pageLeave'); }
        // Finish a new departure chunk even if an earlier keepalive request is still outstanding.
        const urgent = queue.state.pending.filter(event => !inFlight.has(event.sequence)).slice(-12);
        if (ready && sending && urgent.length) {
            void sendChunk(urgent).then(() => queue.acknowledge(urgent)).catch(() => {});
        } else void flush();
    }

    // Returning is separate from continuing gameplay, which remains the game's responsibility.
    function returned() {
        if (!away || document.visibilityState === 'hidden') return;
        away = false;
        record('pageReturn');
        void flush();
    }

    record('pageView', 'page', { restored: queue.state.sequence > 0 });
    record('screenView', document.getElementById('gameShell')?.dataset.screen || 'menu');
    document.addEventListener('click', event => {
        const element = event.target?.closest?.('[data-analytics-id]');
        const candidate = element?.dataset.analyticsId || event.target?.tagName;
        const target = targets.includes(candidate) ? candidate : 'other';
        firstAction(target);
        record('click', target);
    }, true);
    document.addEventListener('toggle', event => {
        if (event.target?.matches?.('details.manual')) record('briefingToggle', 'briefing', { open: event.target.open });
        else if (event.target?.closest?.('#historyRows')) record('historyToggle', 'history', { open: event.target.open });
    }, true);
    window.addEventListener('rocket:log', event => {
        const detail = event.detail || {};
        if (detail.target === 'fire' && ['controlPress', 'controlRelease'].includes(detail.name)) {
            const pressed = detail.name === 'controlPress';
            if (fireHeld === pressed) return;
            fireHeld = pressed;
        }
        if (['controlPress', 'throttleChange', 'dockAttempt'].includes(detail.name)) firstAction(detail.target);
        record(detail.name, detail.target, detail.details);
    });
    window.addEventListener('rocket:gameLifecycle', event => record('gameLifecycle', 'flight', event.detail));
    window.addEventListener('rocket:conquest', event => {
        const detail = event.detail;
        if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return;
        const recorded = record('conquest', detail.target === undefined ? 'conquest' : detail.target, detail);
        if (recorded && ['joined', 'continued', 'shotStarted', 'hackStarted', 'selfDestruct', 'mapTarget', 'reset'].includes(recorded.details.action)) {
            firstAction(recorded.target);
        }
    });
    window.addEventListener('blur', leave);
    window.addEventListener('pagehide', leave);
    window.addEventListener('focus', returned);
    window.addEventListener('pageshow', returned);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' ? leave() : returned());
    window.addEventListener('online', () => { retryAt = 0; void flush(); });
    setInterval(() => { showStatus(statusMessage); void flush(); }, 5000);
    setInterval(() => { if (!away && document.visibilityState !== 'hidden') record('heartbeat'); }, 20000);
    void connect();

    // Use a separate, tab-scoped anonymous auth instance so owner sign-in cannot change visitor permissions.
    async function connect() {
        try {
            const [{ initializeApp }, authSdk] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js')
            ]);
            const app = initializeApp(firebaseConfig, 'visit-log-writer');
            const auth = authSdk.initializeAuth(app, { persistence: authSdk.browserSessionPersistence });
            await auth.authStateReady();
            const user = auth.currentUser || (await authSdk.signInAnonymously(auth)).user;
            token = await user.getIdToken();
            authSdk.onIdTokenChanged(auth, async current => {
                if (current) token = await current.getIdToken();
            });
            // Refresh even on a quiet long-running game before the cached token expires.
            setInterval(() => { void user.getIdToken(true).then(value => { token = value; }).catch(() => {}); }, 45 * 60000);
            await prepareVisit(user);
            ready = true;
            await flush();
        } catch {
            showStatus('EVENT LOG / CONNECTION FAILED — RETRYING');
            setTimeout(() => void reconnect(), 30000);
        }
    }

    // Reuse the initialized auth app on transient startup failures rather than creating a second session.
    async function reconnect() {
        await connect();
    }
}
