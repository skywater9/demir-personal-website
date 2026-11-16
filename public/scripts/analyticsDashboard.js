import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
    getAuth, connectAuthEmulator, onAuthStateChanged, setPersistence, browserSessionPersistence,
    signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { firebaseConfig, useFirebaseEmulators } from './firebaseConfig.js?v=20261116-spark';
import { createAnalyticsHeatmap } from './analyticsHeatmap.js?v=20261116-spark';

const app = initializeApp(useFirebaseEmulators
    ? { ...firebaseConfig, projectId: 'demo-website-analytics' } : firebaseConfig);
const auth = getAuth(app);
if (useFirebaseEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099');
}

const elements = {};
for (const element of document.querySelectorAll('[id]')) {
    elements[element.id] = element;
}
const state = { sessions: [], sessionCursor: null, selected: null, events: [], timelineCursor: null };
const requests = new Set();
let authVersion = 0;
let selectionVersion = 0;
let sessionsBusy = false;
let timelineBusy = false;
const actionLabels = {
    headerClick: 'Header clicked', counterIncrement: 'Counter incremented',
    counterReset: 'Counter reset', gameStart: 'Game start requested',
    gameContinue: 'Continue requested', gameNewRun: 'New run requested',
    gameConfirmNewRun: 'New run confirmed', gameCancelNewRun: 'New run canceled',
    gameMenu: 'Game menu requested', gameRetry: 'Retry requested',
    gameHistory: 'Run history requested', gameHistoryBack: 'Run history back requested',
    gameDock: 'Dock requested', gameThrottleUp: 'Throttle increased', gameThrottleDown: 'Throttle decreased',
    gameRotateLeft: 'Rotate left pressed', gameRotateRight: 'Rotate right pressed',
    gameRcsUp: 'RCS up pressed', gameRcsDown: 'RCS down pressed',
    gameRcsLeft: 'RCS left pressed', gameRcsRight: 'RCS right pressed', gameResume: 'Resume requested',
    gameBurn: 'Main engine pressed', gameThrottle: 'Throttle control pressed'
};
const sectionLabels = {
    header: 'Header', clickCounter: 'Click counter', game: 'Game', visitCounter: 'Visit counter',
    menu: 'Menu', cockpit: 'Cockpit', history: 'Run history', results: 'Results'
};
const meaningfulEvents = new Set(['pageView', 'pageRestore', 'interaction', 'sectionView', 'scrollMilestone', 'gameLifecycle']);
const heatmap = createAnalyticsHeatmap({ elements, readAnalytics, showError, clearError });

elements.environmentLabel.textContent = useFirebaseEmulators ? 'Local verification' : 'Private dashboard';
elements.googleSignInButton.hidden = useFirebaseEmulators;
elements.localSignInForm.hidden = !useFirebaseEmulators;

// Format estimated durations without exposing raw millisecond fields throughout the UI.
function formatDuration(milliseconds) {
    if (!Number.isFinite(milliseconds)) return '—';
    const seconds = Math.max(0, milliseconds) / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

// Format recorded wall-clock timestamps using the owner's local timezone.
function formatDate(timestamp) {
    return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '—';
}

// Render untrusted stored values as text, never HTML.
function createTextElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = String(text);
    if (className) element.className = className;
    return element;
}

// Keep errors visible to keyboard and screen-reader users without exposing tokens.
function showError(error) {
    if (error.name === 'AbortError') return;
    elements.error.textContent = error.message || 'The request could not be completed.';
    elements.error.hidden = false;
}

// Clear an old error before beginning a new deliberate operation.
function clearError() {
    elements.error.textContent = '';
    elements.error.hidden = true;
}

// Abort outstanding reads and clear sensitive DOM state whenever the account changes.
function clearDashboard() {
    heatmap.clear();
    for (const controller of requests) controller.abort();
    requests.clear();
    sessionsBusy = false;
    timelineBusy = false;
    selectionVersion += 1;
    state.sessions = [];
    state.sessionCursor = null;
    state.selected = null;
    state.events = [];
    state.timelineCursor = null;
    elements.sessionRows.replaceChildren();
    elements.timelineRows.replaceChildren();
    elements.sessionMetrics.replaceChildren();
    elements.sectionDurations.replaceChildren();
    elements.selectedSessionId.textContent = '';
    elements.timelineCount.textContent = '';
    elements.sessionCount.textContent = '';
    elements.sessionDetail.hidden = true;
    elements.selectionPrompt.hidden = false;
    elements.selectionPrompt.textContent = 'Select a session to inspect its action timeline.';
    elements.dashboard.hidden = true;
}

// Attach a fresh Firebase ID token to each read; responses are never cached in browser storage.
async function readAnalytics(query) {
    const user = auth.currentUser;
    const version = authVersion;
    if (!user) throw new Error('Sign in to view analytics.');
    const controller = new AbortController();
    requests.add(controller);
    try {
        const token = await user.getIdToken();
        if (version !== authVersion) throw new DOMException('Account changed.', 'AbortError');
        const response = await fetch(`/api/analytics?${new URLSearchParams(query)}`, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'omit', cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
        });
        if (version !== authVersion) throw new DOMException('Account changed.', 'AbortError');
        if (response.status === 404) {
            throw new Error('The analytics backend is not deployed (/api/analytics returned 404). Complete Firebase billing and Functions setup, then deploy the backend.');
        }
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error('The analytics API returned an unexpected response. Check that the Firebase Functions backend and Hosting API rewrite are deployed.');
        }
        if (!response.ok) {
            if (response.status === 401) await signOut(auth);
            throw new Error(result.error || 'Analytics could not be loaded.');
        }
        return result;
    } finally {
        requests.delete(controller);
    }
}

// Render accessible session buttons with consistent columns and explicit selection state.
function renderSessions() {
    elements.sessionRows.replaceChildren();
    for (const session of state.sessions) {
        const row = document.createElement('tr');
        row.setAttribute('aria-current', String(session.sessionId === state.selected?.sessionId));
        const identityCell = document.createElement('td');
        const button = createTextElement('button', `${session.sessionId.slice(0, 8)}…`, 'session-button');
        button.title = session.sessionId;
        button.setAttribute('aria-label', `View session started ${formatDate(session.startedAt)}`);
        button.addEventListener('click', () => selectSession(session));
        identityCell.append(button, createTextElement('span', formatDate(session.startedAt), 'session-start'));
        row.append(identityCell);
        for (const duration of [session.durationMs, session.visibleMs, session.engagedMs]) {
            row.append(createTextElement('td', formatDuration(duration)));
        }
        row.append(createTextElement('td', session.eventCount || 0));
        elements.sessionRows.append(row);
    }
    elements.sessionCount.textContent = state.sessions.length
        ? `${state.sessions.length} sessions loaded.` : 'No sessions recorded yet.';
    elements.moreSessionsButton.hidden = !state.sessionCursor;
}

// Fetch one bounded session page; refresh intentionally resets the selected timeline.
async function loadSessions(reset = false) {
    if (sessionsBusy) return;
    const version = authVersion;
    sessionsBusy = true;
    elements.refreshButton.disabled = true;
    elements.moreSessionsButton.disabled = true;
    clearError();
    try {
        const query = { view: 'sessions' };
        if (!reset && state.sessionCursor) query.cursor = state.sessionCursor;
        const result = await readAnalytics(query);
        if (version !== authVersion) return;
        if (reset) {
            selectionVersion += 1;
            state.selected = null;
            state.events = [];
            elements.sessionDetail.hidden = true;
            elements.selectionPrompt.hidden = false;
            elements.selectionPrompt.textContent = 'Select a session to inspect its action timeline.';
        }
        state.sessions = reset ? result.sessions : [...state.sessions, ...result.sessions];
        state.sessionCursor = result.nextCursor;
        elements.dashboard.hidden = false;
        heatmap.setAuthorized(true);
        elements.status.textContent = 'Owner access verified. Select a session to inspect its actions.';
        renderSessions();
    } catch (error) {
        if (version === authVersion) {
            elements.status.textContent = 'Analytics is unavailable for this account or configuration.';
            showError(error);
        }
    } finally {
        if (version === authVersion) {
            sessionsBusy = false;
            elements.refreshButton.disabled = false;
            elements.moreSessionsButton.disabled = false;
        }
    }
}

// Describe selected events using only named actions and structured metadata.
function describeEvent(event) {
    const properties = event.properties;
    const section = sectionLabels[properties.sectionId] || properties.sectionId || '';
    switch (event.eventName) {
        case 'gameLifecycle': {
            const labels = {
                started: 'Flight started', continued: 'Flight continued', left: 'Flight left for menu',
                suspended: 'Flight suspended', landed: 'Landed and refueled', delivered: 'Payload delivered',
                won: 'Journey won', lost: 'Flight lost', abandoned: 'Flight abandoned'
            };
            return [labels[properties.action] || properties.action,
                `Run ${properties.runId} · stop ${properties.routeIndex + 1}/10 · deliveries ${properties.deliveries}/10 · fuel ${properties.fuel.toFixed(1)}% · gameplay ${formatDuration(properties.gameplaySeconds * 1000)}`];
        }
        case 'interaction': return [actionLabels[properties.elementId] || properties.elementId, `${properties.inputType} · ${event.pagePath}`];
        case 'pageView': return ['Page opened', event.pagePath];
        case 'pageRestore': return ['Page restored', event.pagePath];
        case 'sectionView': return ['Section exposed', section];
        case 'scrollMilestone': return ['Scroll depth', `${properties.percent}%`];
        case 'click': return ['Click / tap', `${properties.elementId || 'Untracked area'} · x ${Math.round(properties.documentX)}, y ${Math.round(properties.documentY)}`];
        case 'visibilityChange': return ['Visibility', properties.visible ? 'Visible' : 'Hidden'];
        case 'sessionCheckpoint': return ['Timing checkpoint', `Visible ${formatDuration(properties.visibleMs)} · engaged ${formatDuration(properties.engagedMs)}`];
        case 'sessionTimeout': return ['Session ended', 'Inactivity or maximum session age'];
        default: return [event.eventName, event.pagePath];
    }
}

// Rebuild the selected summary and timeline; partial loading is always labeled.
function renderTimeline() {
    if (!state.selected) return;
    const session = state.selected;
    elements.selectedSessionId.textContent = session.sessionId;
    elements.sessionMetrics.replaceChildren();
    const firstAction = state.events.find(event => event.eventName === 'interaction');
    const metrics = [
        ['Started', formatDate(session.startedAt)],
        ['Observed duration', formatDuration(session.durationMs)],
        ['Visible time', formatDuration(session.visibleMs)],
        ['Engaged estimate', formatDuration(session.engagedMs)],
        ['First action in loaded events', firstAction ? formatDuration(firstAction.elapsedMs) : 'Not observed'],
        ['Last meaningful action', session.lastMeaningfulAction
            ? `${actionLabels[session.lastMeaningfulAction.elementId] || session.lastMeaningfulAction.elementId} · ${formatDate(session.lastMeaningfulAction.recordedAt)}` : 'Not observed']
    ];
    for (const [label, value] of metrics) {
        const group = document.createElement('div');
        group.append(createTextElement('dt', label), createTextElement('dd', value));
        elements.sessionMetrics.append(group);
    }
    elements.sectionDurations.replaceChildren();
    for (const [sectionId, duration] of Object.entries(session.sectionVisibleMs)) {
        elements.sectionDurations.append(createTextElement('li', `${sectionLabels[sectionId] || sectionId}: ${formatDuration(duration)}`));
    }
    if (!elements.sectionDurations.children.length) {
        elements.sectionDurations.append(createTextElement('li', 'No section exposure recorded.'));
    }
    const events = elements.includeSystemEvents.checked
        ? state.events : state.events.filter(event => meaningfulEvents.has(event.eventName));
    elements.timelineRows.replaceChildren();
    for (const event of events) {
        const [action, detail] = describeEvent(event);
        const row = document.createElement('tr');
        row.append(createTextElement('td', formatDuration(event.elapsedMs)),
            createTextElement('td', action), createTextElement('td', detail));
        elements.timelineRows.append(row);
    }
    const interactionCount = state.events.filter(event => event.eventName === 'interaction').length;
    elements.timelineCount.textContent = `${state.events.length} of ${session.eventCount} recorded events loaded; ${interactionCount} named interactions loaded. ${events.length} rows shown.${state.timelineCursor ? ' Load more to complete the timeline.' : ''}`;
    elements.moreTimelineButton.hidden = !state.timelineCursor;
    elements.sessionDetail.hidden = false;
    elements.selectionPrompt.hidden = true;
}

// Fetch another timeline page and merge it by event ID without accepting stale selections.
async function loadTimeline() {
    if (!state.selected || timelineBusy) return;
    const version = selectionVersion;
    const accountVersion = authVersion;
    timelineBusy = true;
    elements.moreTimelineButton.disabled = true;
    clearError();
    try {
        const query = { view: 'timeline', sessionId: state.selected.sessionId };
        if (state.timelineCursor) query.cursor = state.timelineCursor;
        const result = await readAnalytics(query);
        if (version !== selectionVersion || accountVersion !== authVersion) return;
        state.selected = result.session;
        const events = new Map(state.events.map(event => [event.eventId, event]));
        for (const event of result.events) events.set(event.eventId, event);
        state.events = [...events.values()].sort((first, second) => first.recordedAt - second.recordedAt
            || first.pageInstanceId.localeCompare(second.pageInstanceId) || first.sequence - second.sequence);
        state.timelineCursor = result.nextCursor;
        renderTimeline();
    } catch (error) {
        if (version === selectionVersion && accountVersion === authVersion) showError(error);
    } finally {
        if (version === selectionVersion && accountVersion === authVersion) {
            timelineBusy = false;
            elements.moreTimelineButton.disabled = false;
        }
    }
}

// Begin a new selection only after the previous timeline request finishes.
function selectSession(session) {
    if (timelineBusy) return;
    selectionVersion += 1;
    state.selected = session;
    state.events = [];
    state.timelineCursor = null;
    elements.sessionDetail.hidden = true;
    elements.selectionPrompt.hidden = false;
    elements.selectionPrompt.textContent = 'Loading session…';
    renderSessions();
    void loadTimeline();
}

// Use Google identity in production; the server still makes the owner authorization decision.
async function handleGoogleSignIn() {
    clearError();
    elements.googleSignInButton.disabled = true;
    try {
        await setPersistence(auth, browserSessionPersistence);
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
        showError(error);
    } finally {
        elements.googleSignInButton.disabled = false;
    }
}

// Accept emulator credentials only on the local emulator origin, never on the production page.
async function handleLocalSignIn(event) {
    event.preventDefault();
    if (!useFirebaseEmulators) return;
    clearError();
    elements.localSignInButton.disabled = true;
    try {
        await setPersistence(auth, browserSessionPersistence);
        await signInWithEmailAndPassword(auth, elements.localEmail.value, elements.localPassword.value);
        elements.localPassword.value = '';
    } catch (error) {
        showError(error);
    } finally {
        elements.localSignInButton.disabled = false;
    }
}

// Hide analytics immediately on sign-out, even if a network operation is still pending.
async function handleSignOut() {
    authVersion += 1;
    clearDashboard();
    clearError();
    try {
        await signOut(auth);
    } catch (error) {
        showError(error);
    }
}

// Reflect account changes and authorize through the backend before displaying any analytics.
function handleAuthState(user) {
    authVersion += 1;
    clearDashboard();
    clearError();
    elements.accountLabel.textContent = user?.email || '';
    elements.signOutButton.hidden = !user;
    elements.signInPanel.hidden = Boolean(user);
    elements.status.textContent = user ? 'Checking owner access…' : 'Sign in to view analytics.';
    if (user) void loadSessions(true);
}

elements.googleSignInButton.addEventListener('click', handleGoogleSignIn);
elements.localSignInForm.addEventListener('submit', handleLocalSignIn);
elements.signOutButton.addEventListener('click', handleSignOut);
elements.refreshButton.addEventListener('click', () => loadSessions(true));
elements.moreSessionsButton.addEventListener('click', () => loadSessions());
elements.moreTimelineButton.addEventListener('click', loadTimeline);
elements.includeSystemEvents.addEventListener('change', renderTimeline);
if (useFirebaseEmulators || document.body?.dataset?.customAnalytics !== 'disabled') {
    elements.sparkOverview.hidden = true;
    onAuthStateChanged(auth, handleAuthState, showError);
} else {
    clearDashboard();
    elements.signInPanel.hidden = true;
    elements.signOutButton.hidden = true;
    elements.sparkOverview.hidden = false;
    elements.environmentLabel.textContent = 'Spark plan overview';
    elements.status.textContent = 'Custom session collection and click heatmap are inactive. Use Google Analytics for available production activity.';
}
