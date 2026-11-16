import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
    getFirestore, connectFirestoreEmulator, doc, runTransaction
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig, useFirebaseEmulators } from './firebaseConfig.js';

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

// Initialize optional Google Analytics only in production, keeping emulator visits local.
async function initializeGoogleAnalytics() {
    if (useFirebaseEmulators) return;
    try {
        const { getAnalytics, isSupported } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-analytics.js');
        if (await isSupported()) getAnalytics(app);
    } catch (error) {
        console.warn('[site analytics] Google Analytics unavailable.', { reason: error.message });
    }
}

void recordSiteVisit();
void initializeGoogleAnalytics();
