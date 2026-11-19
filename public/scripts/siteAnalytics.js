import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
    getFirestore, connectFirestoreEmulator, doc, runTransaction
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig, useFirebaseEmulators } from './firebaseConfig.js?v=20261118-conquest';
import { ConquestTracker } from './visitLogCore.mjs?v=20261118-fuel-damage';

const app = getApps().length ? getApp() : initializeApp(useFirebaseEmulators
    ? { ...firebaseConfig, projectId: 'demo-website-analytics' } : firebaseConfig);
const db = getFirestore(app);

if (useFirebaseEmulators) {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// Preserve the local visit total while allowing privacy contexts to block storage.
function incrementLocalVisits() {
    try {
        const storedCount = Number(localStorage.getItem('pageViewsCount') || 0);
        const previousCount = Number.isSafeInteger(storedCount) && storedCount >= 0 ? storedCount : 0;
        const nextCount = previousCount < Number.MAX_SAFE_INTEGER ? previousCount + 1 : previousCount;
        localStorage.setItem('pageViewsCount', String(nextCount));
        return nextCount;
    } catch {
        return null;
    }
}

// Update the existing visit display when present, without depending on the old homepage DOM.
function displayVisitCount(message) {
    const counter = document.getElementById('count');
    if (counter) counter.textContent = message;
}

// Keep the existing shared visit counter transactional and independent of Google Analytics.
async function recordSiteVisit() {
    const localVisits = incrementLocalVisits();
    if (localVisits !== null) displayVisitCount(`You have visited this page ${localVisits} times.`);
    try {
        const totalVisits = await runTransaction(db, async transaction => {
            const reference = doc(db, 'siteStats', 'visits');
            const snapshot = await transaction.get(reference);
            const previousCount = snapshot.exists() ? snapshot.data().count : 0;
            if (!Number.isSafeInteger(previousCount) || previousCount < 0 || previousCount === Number.MAX_SAFE_INTEGER) {
                throw new Error('The visit counter is outside its supported range.');
            }
            const nextCount = previousCount + 1;
            transaction.set(reference, { count: nextCount }, { merge: true });
            return nextCount;
        });
        displayVisitCount(`Website visits: ${totalVisits}`);
    } catch (error) {
        console.warn('[site analytics] Visit counter unavailable.', { reason: error.message });
    }
}

const gameActions = new Set(['started', 'continued', 'left', 'suspended', 'landed', 'delivered', 'won', 'lost', 'abandoned']);
const pendingGameEvents = [];
const conquest = new ConquestTracker();
let googleAnalytics = null;
let logGoogleEvent = null;
let analyticsUnavailable = false;

// Exclude local development on every port, including loopback IPv4 and IPv6 hosts.
function isLocalAnalyticsHost() {
    const hostname = window.location.hostname.toLowerCase();
    return hostname === 'localhost' || hostname.endsWith('.localhost')
        || /^127\./.test(hostname) || ['::1', '[::1]', '0.0.0.0'].includes(hostname);
}

// Stop optional analytics after SDK failure and release buffered metadata without affecting visits.
function disableGoogleAnalytics(error) {
    analyticsUnavailable = true;
    pendingGameEvents.length = 0;
    console.warn('[site analytics] Google Analytics unavailable.', { reason: error.message });
}

// Log a projected event safely so SDK errors never interrupt gameplay or visit counts.
function sendGameEvent(event) {
    try {
        logGoogleEvent(googleAnalytics, event.name, event.parameters);
    } catch (error) {
        disableGoogleAnalytics(error);
    }
}

// Keep the optional SDK's pre-init buffer bounded independently of the durable Firestore outbox.
function queueGameEvent(name, parameters) {
    const event = { name, parameters };
    if (logGoogleEvent) sendGameEvent(event);
    else {
        if (pendingGameEvents.length >= 32) pendingGameEvents.shift();
        pendingGameEvents.push(event);
    }
}

// Accept only bounded game statistics and omit run identity and arbitrary event metadata.
function handleGameLifecycle(event) {
    if (analyticsUnavailable) return;
    const detail = event.detail;
    if (!detail || !gameActions.has(detail.action)
        || !Number.isInteger(detail.routeIndex) || detail.routeIndex < 0 || detail.routeIndex > 9
        || !Number.isInteger(detail.deliveries) || detail.deliveries < 0 || detail.deliveries > 10
        || !Number.isFinite(detail.fuel) || detail.fuel < 0 || detail.fuel > 100
        || !Number.isFinite(detail.gameplaySeconds) || detail.gameplaySeconds < 0 || detail.gameplaySeconds > 31536000) return;
    const parameters = { action: detail.action, route_index: detail.routeIndex, deliveries: detail.deliveries,
        fuel_remaining: detail.fuel, gameplay_seconds: detail.gameplaySeconds };
    queueGameEvent(`game_${detail.action}`, parameters);
}

// Reuse the durable log's privacy projection and milestone/held-fire bounds for optional GA reports.
function handleConquest(event) {
    if (analyticsUnavailable) return;
    const accepted = conquest.accept(event.detail);
    if (!accepted) return;
    const parameters = { target: accepted.target };
    const names = { gameplaySeconds: 'gameplay_seconds', fuel: 'fuel_remaining', planetLevel: 'planet_level' };
    for (const [key, value] of Object.entries(accepted.details)) parameters[names[key] || key] = value;
    queueGameEvent(`conquest_${accepted.details.action}`, parameters);
}

// Listen before loading the optional SDK; buffer only new native events while initialization is pending.
async function initializeGoogleAnalytics() {
    if (useFirebaseEmulators || isLocalAnalyticsHost()) return;
    window.addEventListener('rocket:gameLifecycle', handleGameLifecycle);
    window.addEventListener('rocket:conquest', handleConquest);
    try {
        const { getAnalytics, isSupported, logEvent } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-analytics.js');
        if (!await isSupported()) {
            analyticsUnavailable = true;
            pendingGameEvents.length = 0;
            return;
        }
        googleAnalytics = getAnalytics(app);
        logGoogleEvent = logEvent;
        for (const event of pendingGameEvents.splice(0)) {
            if (analyticsUnavailable) break;
            sendGameEvent(event);
        }
    } catch (error) {
        disableGoogleAnalytics(error);
    }
}

void recordSiteVisit();
void initializeGoogleAnalytics();
