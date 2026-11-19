import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { getFirestore, collection, query, orderBy, limit, startAfter, getDocs } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig } from './firebaseConfig.js?v=20261118-conquest';

const app = initializeApp(firebaseConfig, 'visit-log-owner');
const auth = getAuth(app);
const db = getFirestore(app);
const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
let generation = 0;
let selected = null;
let sessions = [];
let sessionCursor = null;
let eventCursor = null;
let eventCount = 0;
let selectionVersion = 0;
let loadingVisits = false;
let loadingEvents = false;

// Build all content as text nodes so recorded data can never execute markup in the owner's browser.
function node(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
}

// Describe failures without exposing auth credentials or raw server responses.
function reportError(error) {
    ui.error.hidden = false;
    if (error.code === 'auth/popup-blocked') {
        ui.error.textContent = 'Allow the Google sign-in popup for this site, then try again.';
        return;
    }
    if (error.code === 'auth/popup-closed-by-user') {
        ui.error.textContent = 'Google sign-in was closed. Choose Sign in with Google to try again.';
        return;
    }
    ui.error.textContent = error.code === 'permission-denied'
        ? 'This account is not authorized to read the log. Sign out and use the Firebase project owner account.'
        : 'Could not load the log. Check your connection and Spark quota, then try again.';
}

// Clear private rows immediately on auth changes and invalidate any outstanding network reads.
function clearDashboard() {
    generation++;
    selectionVersion++;
    selected = null;
    sessions = [];
    sessionCursor = null;
    eventCursor = null;
    eventCount = 0;
    loadingVisits = false;
    loadingEvents = false;
    ui.sessionRows.replaceChildren();
    ui.timelineRows.replaceChildren();
    ui.selectedSessionId.textContent = '';
    ui.sessionMetrics.textContent = '';
    ui.timelineCount.textContent = '';
    ui.sessionCount.textContent = '';
    ui.dashboard.hidden = true;
    ui.sessionDetail.hidden = true;
    ui.moreSessionsButton.hidden = true;
    ui.moreTimelineButton.hidden = true;
    ui.error.hidden = true;
}

// Page visits by a single indexed field; never scan all history on every dashboard open.
async function loadVisits(reset = false) {
    if (loadingVisits) return;
    loadingVisits = true;
    ui.refreshButton.disabled = true;
    ui.moreSessionsButton.disabled = true;
    const version = generation;
    try {
        const constraints = [orderBy('startedAt', 'desc')];
        if (!reset && sessionCursor) constraints.push(startAfter(sessionCursor));
        constraints.push(limit(25));
        const snapshot = await getDocs(query(collection(db, 'visitLogs'), ...constraints));
        if (version !== generation) return;
        if (reset) sessions = [];
        sessions.push(...snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
        sessionCursor = snapshot.docs.at(-1) || null;
        ui.moreSessionsButton.hidden = snapshot.size < 25;
        ui.sessionRows.replaceChildren();
        for (const visit of sessions) {
            const row = node('tr', '');
            const cell = node('td', '');
            const button = node('button', `${visit.id.slice(0, 8)}…`, 'session-button');
            button.title = visit.id;
            button.addEventListener('click', () => void selectVisit(visit));
            cell.append(button, node('span', new Date(visit.startedAt).toLocaleString(), 'session-start'));
            row.append(cell, node('td', `${((visit.lastEventAt - visit.startedAt) / 1000).toFixed(1)} s`), node('td', visit.lastSequence));
            ui.sessionRows.append(row);
        }
        ui.sessionCount.textContent = sessions.length ? `${sessions.length} visits loaded` : 'No saved visits yet. Open the live game in a private window and play for a minute.';
        ui.status.textContent = 'Owner access verified. Choose a visit; Refresh fetches new events.';
        ui.error.hidden = true;
        if (selected && reset) {
            const updated = sessions.find(visit => visit.id === selected.id);
            if (updated) await selectVisit(updated);
        }
    } catch (error) { if (version === generation) reportError(error); }
    finally {
        if (version === generation) {
            loadingVisits = false;
            ui.refreshButton.disabled = false;
            ui.moreSessionsButton.disabled = false;
        }
    }
}

// Start a new timeline and invalidate a previous visit's pending query before rendering anything private.
async function selectVisit(visit) {
    selectionVersion++;
    loadingEvents = false;
    selected = visit;
    eventCursor = null;
    eventCount = 0;
    ui.timelineRows.replaceChildren();
    ui.selectedSessionId.textContent = `Session ${visit.id}`;
    ui.sessionMetrics.textContent = `Arrived ${new Date(visit.startedAt).toLocaleString()} · Last event ${new Date(visit.lastEventAt).toLocaleString()} · Observed ${((visit.lastEventAt - visit.startedAt) / 1000).toFixed(1)} seconds`;
    ui.selectionPrompt.hidden = true;
    ui.sessionDetail.hidden = false;
    await loadEvents();
}

// Show every event, including raw clicks and system events, in stable sequence order with actual timestamps.
async function loadEvents() {
    if (!selected || loadingEvents) return;
    loadingEvents = true;
    ui.moreTimelineButton.disabled = true;
    const version = generation;
    const selection = selectionVersion;
    const visit = selected;
    try {
        const constraints = [orderBy('sequence', 'asc')];
        if (eventCursor) constraints.push(startAfter(eventCursor));
        constraints.push(limit(100));
        const snapshot = await getDocs(query(collection(db, 'visitLogs', visit.id, 'events'), ...constraints));
        if (version !== generation || selection !== selectionVersion) return;
        for (const doc of snapshot.docs) {
            const event = doc.data();
            const row = node('tr', '');
            const planets = ['Earth', 'Moon', 'Venus', 'Mercury', 'Earth (return)', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
            const details = Object.entries(event.details || {}).map(([key, value]) => {
                if (key === 'routeIndex') return `destination: ${planets[value] || value}`;
                if (key === 'gameplaySeconds') return `gameplay: ${value} s`;
                if (key === 'fuel' || key === 'throttle') return `${key}: ${value}%`;
                if (key === 'owned') return `owned planets: ${value}`;
                if (key === 'planetLevel') return `planet level: ${value}`;
                if (key === 'amount' && event.eventName === 'conquest') {
                    if (event.details.action === 'hackProgress') return `hack milestone: ${value} successful presses`;
                    if (event.details.action === 'shotEnded') return `shots during hold: ${value}`;
                    return `amount: ${value}`;
                }
                return `${key}: ${value}`;
            }).join(' · ') || '—';
            row.append(node('td', `#${event.sequence} ${new Date(event.recordedAt).toLocaleTimeString()}`),
                node('td', `${(event.elapsedMs / 1000).toFixed(2)} s`), node('td', event.eventName),
                node('td', event.target), node('td', details));
            ui.timelineRows.append(row);
        }
        eventCount += snapshot.size;
        eventCursor = snapshot.docs.at(-1) || eventCursor;
        ui.moreTimelineButton.hidden = snapshot.size < 100;
        ui.timelineCount.textContent = `${eventCount} saved rows loaded${snapshot.size === 100 ? ' · more available' : ' · end of saved timeline'}. Highest recorded sequence: ${visit.lastSequence}.`;
        ui.error.hidden = true;
    } catch (error) { if (version === generation && selection === selectionVersion) reportError(error); }
    finally {
        if (version === generation && selection === selectionVersion) {
            loadingEvents = false;
            ui.moreTimelineButton.disabled = false;
        }
    }
}

ui.googleSignInButton.addEventListener('click', async () => {
    ui.googleSignInButton.disabled = true;
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (error) { reportError(error); }
    finally { ui.googleSignInButton.disabled = false; }
});
ui.signOutButton.addEventListener('click', () => { clearDashboard(); void signOut(auth).catch(reportError); });
ui.refreshButton.addEventListener('click', () => void loadVisits(true));
ui.moreSessionsButton.addEventListener('click', () => void loadVisits());
ui.moreTimelineButton.addEventListener('click', () => void loadEvents());
onAuthStateChanged(auth, async user => {
    clearDashboard();
    const version = generation;
    ui.signInPanel.hidden = Boolean(user);
    ui.signOutButton.hidden = !user;
    if (!user) { ui.status.textContent = 'Sign in to read the saved event log.'; return; }
    try {
        const result = await user.getIdTokenResult(true);
        if (version !== generation) return;
        if (result.claims.analyticsOwner !== true) {
            ui.status.textContent = 'This account has no owner access.';
            reportError({ code: 'permission-denied' });
            return;
        }
        ui.dashboard.hidden = false;
        await loadVisits(true);
    } catch (error) { if (version === generation) reportError(error); }
});
