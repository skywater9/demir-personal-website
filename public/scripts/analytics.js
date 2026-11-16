import { analyticsConfig } from './analyticsConfig.js';
import { useFirebaseEmulators } from './firebaseConfig.js';
import { createAnalyticsTransport } from './analyticsTransport.js';

// Debug always stays local; a separate opt-in enables collection on the local Hosting emulator.
const query = new URLSearchParams(window.location.search);
const debugEnabled = query.get('analyticsDebug') === '1';
const collectionEnabled = !debugEnabled && (analyticsConfig.collectionEnabled
    || (useFirebaseEmulators && query.get('analyticsCollect') === '1'));

if (debugEnabled || collectionEnabled) {
    startAnalyticsDebug();
}

// Track explicit interactions locally and optionally hand snapshots to the private collector.
function startAnalyticsDebug() {
    const config = {
        layoutVersion: 'homepage-v1',
        checkpointMs: 15000,
        engagedTimeoutMs: 60000,
        sessionTimeoutMs: 30 * 60 * 1000,
        maxSessionMs: 24 * 60 * 60 * 1000,
        maxEvents: 300
    };
    const storageKey = collectionEnabled ? 'websiteAnalyticsSession' : 'websiteAnalyticsDebugSession';
    const events = [];
    const visibleSections = new Set();
    const scrollMilestones = new Set();
    const transport = collectionEnabled ? createAnalyticsTransport(useFirebaseEmulators) : null;
    let nextSequence = 1;
    let storageAvailable = true;
    let session = restoreSession();
    let lastCheckpoint = performance.now();
    let lastInput = lastCheckpoint - Math.max(0, Date.now() - session.lastActivityAt);
    let pageVisible = document.visibilityState === 'visible';

    // Start a fresh anonymous session without storing a persistent visitor identity.
    function createSession() {
        const now = Date.now();
        return {
            sessionId: crypto.randomUUID(),
            startedAt: now,
            lastActivityAt: now,
            visibleMs: 0,
            engagedMs: 0,
            sectionVisibleMs: {},
            lastMeaningfulAction: null
        };
    }

    // Restore only a valid, recent summary; private browsing may block storage entirely.
    function restoreSession() {
        try {
            const saved = JSON.parse(sessionStorage.getItem(storageKey));
            if (saved && typeof saved.sessionId === 'string'
                && Number.isFinite(saved.startedAt) && saved.startedAt <= Date.now()
                && Date.now() - saved.startedAt < config.maxSessionMs
                && Number.isFinite(saved.lastActivityAt) && saved.lastActivityAt <= Date.now()
                && Date.now() - saved.lastActivityAt < config.sessionTimeoutMs
                && Number.isFinite(saved.visibleMs) && saved.visibleMs >= 0
                && Number.isFinite(saved.engagedMs) && saved.engagedMs >= 0
                && saved.sectionVisibleMs && typeof saved.sectionVisibleMs === 'object'
                && !Array.isArray(saved.sectionVisibleMs)
                && Object.values(saved.sectionVisibleMs).every(value => Number.isFinite(value) && value >= 0)) {
                return saved;
            }
        } catch (error) {
            storageAvailable = false;
            console.warn('[analytics debug] Session restore unavailable; using memory.', error);
        }
        return createSession();
    }

    // Persist only the summary, keeping detailed click events in a bounded memory buffer.
    function saveSession() {
        if (!storageAvailable) {
            return;
        }
        try {
            sessionStorage.setItem(storageKey, JSON.stringify(session));
        } catch (error) {
            storageAvailable = false;
            console.warn('[analytics debug] Session save unavailable; using memory.', error);
        }
    }

    // Record explicit fields rather than DOM text, form values, or URL query parameters.
    function recordEvent(eventName, properties = {}) {
        const event = {
            eventName,
            sequence: nextSequence++,
            sessionId: session.sessionId,
            pagePath: window.location.pathname,
            layoutVersion: config.layoutVersion,
            recordedAt: Date.now(),
            elapsedMs: Math.max(0, Date.now() - session.startedAt),
            properties
        };
        events.push(event);
        if (events.length > config.maxEvents) {
            events.shift();
        }
        if (debugEnabled) {
            console.debug('[analytics debug]', eventName, event);
        }
    }

    // Count only observed foreground intervals and the part covered by recent activity.
    function updateTiming() {
        const now = performance.now();
        if (pageVisible) {
            const elapsed = Math.max(0, now - lastCheckpoint);
            const engagedUntil = Math.min(now, lastInput + config.engagedTimeoutMs);
            session.visibleMs += elapsed;
            session.engagedMs += Math.max(0, engagedUntil - lastCheckpoint);
            for (const sectionId of visibleSections) {
                session.sectionVisibleMs[sectionId] = (session.sectionVisibleMs[sectionId] || 0) + elapsed;
            }
        }
        lastCheckpoint = now;
    }

    // Refresh activity locally without recording keystrokes or every scroll event.
    function noteActivity() {
        updateTiming();
        if (Date.now() - session.lastActivityAt >= config.sessionTimeoutMs
            || Date.now() - session.startedAt >= config.maxSessionMs) {
            recordEvent('sessionTimeout');
            if (Date.now() - session.startedAt < config.maxSessionMs) {
                transport?.captureSnapshot(getSnapshot());
            }
            session = createSession();
            scrollMilestones.clear();
            recordEvent('pageView');
        }
        session.lastActivityAt = Date.now();
        lastInput = performance.now();
    }

    // Capture real pointer positions separately from meaningful control activation.
    function handleClick(event) {
        noteActivity();
        const target = event.target instanceof Element ? event.target : null;
        const trackedElement = target?.closest('[data-analytics-id]');
        const section = target?.closest('[data-analytics-section]');
        const anchor = trackedElement || section;
        const elementId = trackedElement?.dataset.analyticsId || null;
        const sectionId = section?.dataset.analyticsSection || null;
        if (event.detail > 0) {
            const bounds = anchor?.getBoundingClientRect();
            recordEvent('click', {
                elementId,
                sectionId,
                documentX: event.clientX + window.scrollX,
                documentY: event.clientY + window.scrollY,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                pageWidth: document.documentElement.scrollWidth,
                pageHeight: document.documentElement.scrollHeight,
                relativeX: bounds?.width ? Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) : null,
                relativeY: bounds?.height ? Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) : null
            });
        }
        if (elementId) {
            session.lastMeaningfulAction = { elementId, recordedAt: Date.now() };
            session.lastActivityAt = session.lastMeaningfulAction.recordedAt;
            recordEvent('interaction', { elementId, sectionId, inputType: event.detail === 0 ? 'keyboard' : 'pointer' });
        }
        saveSession();
    }

    // Record each depth once; non-scrollable pages do not imply an intentional full-page scroll.
    function handleScroll() {
        noteActivity();
        const pageHeight = document.documentElement.scrollHeight;
        if (pageHeight <= window.innerHeight) {
            return;
        }
        const depth = Math.min(100, 100 * (window.scrollY + window.innerHeight) / pageHeight);
        for (const milestone of [25, 50, 75, 100]) {
            if (depth >= milestone && !scrollMilestones.has(milestone)) {
                scrollMilestones.add(milestone);
                recordEvent('scrollMilestone', { percent: milestone });
            }
        }
    }

    // Checkpoint before visibility transitions so hidden tabs never add foreground time.
    function handleVisibility() {
        updateTiming();
        pageVisible = document.visibilityState === 'visible';
        recordEvent('visibilityChange', { visible: pageVisible });
        saveSession();
        transport?.captureSnapshot(getSnapshot());
    }

    // Observe substantial section exposure without treating it as proof of reading.
    function handleSections(entries) {
        updateTiming();
        for (const entry of entries) {
            const sectionId = entry.target.dataset.analyticsSection;
            if (entry.intersectionRatio >= 0.5) {
                if (!visibleSections.has(sectionId)) {
                    visibleSections.add(sectionId);
                    recordEvent('sectionView', { sectionId });
                }
            } else {
                visibleSections.delete(sectionId);
            }
        }
        saveSession();
    }

    // Expose copies for manual inspection so console commands cannot mutate tracker state.
    function getSnapshot() {
        updateTiming();
        saveSession();
        return JSON.parse(JSON.stringify({
            mode: collectionEnabled ? 'collection' : 'localDebug',
            collection: transport?.getStatus() || null,
            config,
            session,
            elapsedMs: Math.max(0, Date.now() - session.startedAt),
            pageVisible,
            events
        }));
    }

    // Save a final observed interval on navigation, including back/forward cache transitions.
    function handlePageHide() {
        updateTiming();
        pageVisible = false;
        saveSession();
        transport?.captureSnapshot(getSnapshot());
    }

    // Resume from the back/forward cache without counting the time spent away.
    function handlePageShow(event) {
        if (event.persisted) {
            lastCheckpoint = performance.now();
            pageVisible = document.visibilityState === 'visible';
            recordEvent('pageRestore');
        }
    }

    // Emit low-frequency timing summaries instead of creating a timer event every second.
    function checkpoint() {
        updateTiming();
        saveSession();
        if (Date.now() - session.startedAt >= config.maxSessionMs) {
            return;
        }
        if (pageVisible) {
            recordEvent('sessionCheckpoint', {
                visibleMs: Math.round(session.visibleMs),
                engagedMs: Math.round(session.engagedMs)
            });
        }
        transport?.captureSnapshot(getSnapshot());
    }

    window.websiteAnalytics = Object.freeze({ getSnapshot });
    document.addEventListener('click', handleClick, true);
    document.addEventListener('pointerdown', noteActivity, { passive: true });
    document.addEventListener('keydown', noteActivity, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    const sectionObserver = new IntersectionObserver(handleSections, { threshold: [0, 0.5] });
    document.querySelectorAll('[data-analytics-section]').forEach(section => sectionObserver.observe(section));
    recordEvent('pageView');
    saveSession();
    transport?.captureSnapshot(getSnapshot());
    window.setInterval(checkpoint, config.checkpointMs);
    console.info(`[analytics] ${collectionEnabled ? 'Collection' : 'Local preview'} enabled. Inspect window.websiteAnalytics.getSnapshot().`);
}
