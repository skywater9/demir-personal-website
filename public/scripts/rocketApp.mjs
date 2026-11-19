import {
    createRun, route, routeBody, tuning, stepRun, dashRun, targetFor, nearestBody,
    gravityAt, dockingStatus, tryDock, recordRunEvent
} from './rocketPhysics.mjs?v=20261118-strong-dash';
import { RunStore, saveKey } from './rocketStorage.mjs?v=20261118-strong-dash';
import { RocketRenderer } from './rocketRenderer.mjs?v=20261118-strong-dash';

const keyControls = Object.freeze({
    ArrowUp: 'burn', KeyA: 'rotateLeft', ArrowLeft: 'rotateLeft',
    KeyD: 'rotateRight', ArrowRight: 'rotateRight', KeyW: 'burn',
    KeyS: 'rcsDown'
});
const dashDirections = Object.freeze({ KeyW: 'forward', KeyA: 'left', KeyS: 'backward', KeyD: 'right' });
const eventLabels = Object.freeze({
    started: 'Flight started on Earth', returned: 'Returned to flight',
    left: 'Left flight for menu', suspended: 'Left page or switched away',
    interrupted: 'Previous session interrupted; recovered saved progress',
    payloadDelivered: 'Payload delivered', landedAndRefueled: 'Landed, refueled, and loaded payload',
    undocked: 'Detached from relay', won: 'Journey completed', lost: 'Flight lost',
    abandoned: 'Replaced by a new flight'
});

// Format the simulation clock without including any time spent in menus or away from the page.
export function formatTime(seconds) {
    const tenths = Math.floor(Math.max(0, seconds) * 10);
    const minutes = Math.floor(tenths / 600);
    return `${String(minutes).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

// Express long world distances compactly while retaining meter precision near a landing or docking target.
export function formatDistance(distance) {
    return distance >= 10000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.max(0, distance).toFixed(distance < 100 ? 1 : 0)} m`;
}

// Coordinate UI, held controls, fixed-step physics, and persistence without coupling physics to the DOM.
export class FlightApp {
    // Permit small test doubles for the document and renderer so lifecycle behavior can be verified offline.
    constructor({ page = globalThis.document, browserWindow = globalThis.window, store = null, renderer = null, autoStart = true } = {}) {
        this.page = page;
        this.browserWindow = browserWindow;
        this.ui = Object.fromEntries([...page.querySelectorAll('[id]')].map(element => [element.id, element]));
        this.mode = 'menu';
        this.keys = new Set();
        this.lastDashTap = new Map();
        this.pendingDash = null;
        this.pointers = new Map();
        this.activeInput = {};
        this.heldButtons = [...page.querySelectorAll('[data-control]')];
        this.accumulator = 0;
        this.saveElapsed = 0;
        this.hudElapsed = 0;
        this.messageUntil = 0;
        this.lastFrame = null;
        this.animating = autoStart;
        this.busy = false;
        this.resultsPending = false;
        this.savePending = false;
        this.failedRunId = null;
        this.failureElapsed = 0;
        let storage = null;
        try { storage = browserWindow.localStorage; } catch { /* The visible warning below covers denied storage access. */ }
        this.store = store || new RunStore(storage, message => this.showStorageWarning(message), {
            lockManager: browserWindow.navigator?.locks, requireLocks: true
        });
        const saved = this.store.getActive();
        this.run = saved || createRun();
        this.run.throttle = 1;
        this.renderer = renderer || new RocketRenderer(this.ui.flightCanvas, this.ui.mapCanvas);
        this.bindEvents();
        this.updateMenu();
        this.showScreen('menu', false);
        this.updateHud();
        if (autoStart) browserWindow.requestAnimationFrame(now => this.frame(now));
    }

    // Surface persistence limitations immediately instead of silently promising a resumable run.
    showStorageWarning(message) {
        this.ui.storageWarning.textContent = message;
        this.ui.storageWarning.hidden = false;
        this.ui.saveStatus.textContent = 'SAVING UNAVAILABLE / MEMORY ONLY';
    }

    // Avoid starting a pending transition in the background if the pilot leaves while its save is waiting.
    isForeground() {
        return this.page.visibilityState !== 'hidden'
            && (typeof this.page.hasFocus !== 'function' || this.page.hasFocus());
    }

    // Change one text node only when its value changes to keep the frequently updated HUD lightweight.
    text(id, value) {
        const element = this.ui[id];
        if (element.textContent !== String(value)) element.textContent = String(value);
    }

    // Keep persistence callbacks inside a shared browser lock while allowing lightweight synchronous test stores.
    mutateStore(action, onComplete) {
        try {
            const result = this.store.transaction(action);
            if (result && typeof result.then === 'function') {
                return result.then(onComplete).catch(error => this.storageOperationFailed(error));
            }
            return onComplete(result);
        } catch (error) {
            this.storageOperationFailed(error);
        }
    }

    // Recover from a failed lock operation without leaving controls stuck or losing the current in-memory run.
    storageOperationFailed(error) {
        console.warn('[orbital freight] Flight recorder operation failed.', error);
        this.store.available = false;
        this.store.lockManager = null;
        this.busy = false;
        this.resultsPending = false;
        this.savePending = false;
        this.showStorageWarning('The flight recorder is unavailable. This session is now kept in memory only.');
        this.openMenu();
    }

    // Bind normal buttons separately from held engine inputs so mouse, touch, and keyboard share behavior.
    bindEvents() {
        this.ui.startButton.addEventListener('click', () => {
            if (this.store.getActive()) this.showScreen('confirm');
            else this.newRun();
        });
        this.ui.continueButton.addEventListener('click', () => this.continueRun());
        this.ui.confirmNewButton.addEventListener('click', () => this.newRun());
        this.ui.cancelNewButton.addEventListener('click', () => this.showScreen('menu'));
        this.ui.menuButton.addEventListener('click', () => this.openMenu());
        this.ui.resultMenuButton.addEventListener('click', () => this.openMenu());
        this.ui.retryButton.addEventListener('click', () => this.newRun());
        this.ui.historyButton.addEventListener('click', () => {
            this.renderHistory();
            this.showScreen('history');
        });
        this.ui.historyBackButton.addEventListener('click', () => this.showScreen('menu'));
        this.ui.dockButton.addEventListener('click', () => this.attach());
        for (const button of this.heldButtons) this.bindHeldButton(button);
        this.page.addEventListener('keydown', event => this.handleKeyDown(event));
        this.page.addEventListener('keyup', event => {
            this.keys.delete(event.code);
            this.keys.delete(`button:${event.code}`);
        });
        this.browserWindow.addEventListener('blur', () => this.suspend('suspended'));
        this.page.addEventListener('visibilitychange', () => {
            if (this.page.visibilityState === 'hidden') this.suspend('suspended');
        });
        this.browserWindow.addEventListener('pagehide', () => this.suspend('suspended'));
        this.browserWindow.addEventListener('pageshow', () => { this.lastFrame = null; });
        this.browserWindow.addEventListener('storage', event => {
            if (event.key !== saveKey && event.key !== null) return;
            if (this.mode === 'flight' && !this.store.ownsActive(this.run.id)) this.ownershipLost();
            else {
                if (this.mode === 'menu') this.updateMenu();
            }
        });
    }

    // Use pointer capture and per-pointer state to avoid stuck controls and support simultaneous touch inputs.
    bindHeldButton(button) {
        button.addEventListener('pointerdown', event => {
            if (this.mode !== 'flight' || event.button !== 0) return;
            event.preventDefault();
            button.setPointerCapture(event.pointerId);
            this.pointers.set(event.pointerId, button.dataset.control);
        });
        for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
            button.addEventListener(eventName, event => this.pointers.delete(event.pointerId));
        }
        button.addEventListener('keydown', event => {
            if (this.mode !== 'flight' || event.code !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            this.keys.add(`button:${event.code}`);
        });
        button.addEventListener('blur', () => {
            this.keys.delete('button:Space');
            this.keys.delete('button:Enter');
        });
    }

    // Handle flight shortcuts without stealing browser shortcuts or ordinary button activation.
    handleKeyDown(event) {
        if (event.code === 'Tab' && this.mode !== 'flight') {
            this.trapFocus(event);
            return;
        }
        if (event.code === 'Escape') {
            event.preventDefault();
            if (this.mode === 'flight') this.openMenu();
            else if (this.mode !== 'menu') this.showScreen('menu');
            return;
        }
        if (this.mode !== 'flight' || event.ctrlKey || event.metaKey || event.altKey) return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
        if (event.code === 'Space' && event.target?.tagName === 'BUTTON') return;
        if (keyControls[event.code] || dashDirections[event.code]) {
            event.preventDefault();
            if (!event.repeat && !this.keys.has(event.code) && !this.busy && !this.resultsPending) {
                this.handleDashTap(event);
            }
            this.keys.add(event.code);
        } else if (event.code === 'KeyE' && !event.repeat) {
            event.preventDefault();
            this.attach();
        }
    }

    // Require two real presses of the same key; held-key repeats and cooldown taps never buffer a dash.
    handleDashTap(event) {
        const direction = dashDirections[event.code];
        if (!direction) return;
        const now = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
        const previousTap = this.lastDashTap.get(event.code);
        if (previousTap !== undefined && now >= previousTap && now - previousTap <= tuning.dashTapWindow) {
            this.lastDashTap.delete(event.code);
            if (this.pendingDash === null && this.run.status === 'active'
                && this.run.elapsed + 1e-9 >= (this.run.dashReadyAt || 0)) this.pendingDash = direction;
        } else {
            this.lastDashTap.set(event.code, now);
        }
    }

    // Keep modal keyboard navigation inside the active panel while the cockpit is inert.
    trapFocus(event) {
        const panel = this.activePanel();
        const focusable = [...panel.querySelectorAll('button:not([disabled]):not([hidden]), summary')];
        if (!focusable.length) return;
        const index = focusable.indexOf(this.page.activeElement);
        if (event.shiftKey && index <= 0) {
            event.preventDefault();
            focusable.at(-1).focus();
        } else if (!event.shiftKey && (index === focusable.length - 1 || index === -1)) {
            event.preventDefault();
            focusable[0].focus();
        }
    }

    // Resolve the one visible dialog without exposing hidden menu panels to keyboard users.
    activePanel() {
        return this.ui[{ menu: 'mainMenu', confirm: 'confirmPanel', history: 'historyPanel', results: 'resultPanel' }[this.mode]];
    }

    // Clear all physical input whenever control leaves gameplay so held thrust never resumes unexpectedly.
    clearInput() {
        this.activeInput = {};
        this.lastDashTap.clear();
        this.pendingDash = null;
        this.run.rotationVelocity = 0;
        for (const action of this.loggedActions || []) this.emitLog('controlRelease', action);
        this.loggedActions = new Set();
        this.keys.clear();
        this.pointers.clear();
        for (const button of this.heldButtons) button.classList.remove('is-held');
    }

    // Show exactly one screen and disable background controls while a dialog is open.
    showScreen(mode, focus = true) {
        this.mode = mode;
        this.ui.gameShell.dataset.screen = mode;
        this.emitLog('screenView', mode);
        this.clearInput();
        this.accumulator = 0;
        this.lastFrame = null;
        const panels = { menu: 'mainMenu', confirm: 'confirmPanel', history: 'historyPanel', results: 'resultPanel' };
        for (const [screen, id] of Object.entries(panels)) this.ui[id].hidden = mode !== screen;
        this.ui.menuOverlay.hidden = mode === 'flight';
        if (mode !== 'flight') this.ui.dockDialog.hidden = true;
        this.ui.instrumentPanel.inert = mode !== 'flight';
        this.ui.controlPanel.inert = mode !== 'flight';
        this.ui.menuButton.inert = mode !== 'flight';
        if (mode === 'menu') this.updateMenu();
        if (focus && this.page.visibilityState !== 'hidden') {
            const target = mode === 'flight' ? this.ui.flightCanvas : this.activePanel();
            target.tabIndex = -1;
            target.focus({ preventScroll: true });
        }
    }

    // Render Start or Continue/New Run from actual saved state rather than from an unsaved preview.
    updateMenu() {
        const saved = this.store.getActive();
        this.ui.continueButton.hidden = !saved;
        this.ui.startButton.dataset.analyticsId = saved ? 'gameNewRun' : 'gameStart';
        this.ui.startButton.classList.toggle('primary-button', !saved);
        this.ui.startButton.classList.toggle('secondary-button', Boolean(saved));
        this.ui.startButton.textContent = saved ? 'NEW FLIGHT →' : 'START FLIGHT →';
        this.text('historyCount', String(this.store.getHistory().length).padStart(2, '0'));
        this.text('savedRunNote', saved
            ? `${routeBody(saved.routeIndex).name} / ${formatTime(saved.elapsed)} / ${saved.fuel.toFixed(1)}% fuel. Flight saved on this browser.`
            : 'Start on Earth with a full tank and your first payload.');
    }

    // Emit allowlisted product actions without collecting keystrokes, DOM text, or visitor identity.
    emitLog(name, target, details = {}) {
        if (typeof this.browserWindow.CustomEvent !== 'function' || typeof this.browserWindow.dispatchEvent !== 'function') return;
        try {
            this.browserWindow.dispatchEvent(new this.browserWindow.CustomEvent('rocket:log', { detail: { name, target, details } }));
        } catch { /* Logging failures must never interrupt flight. */ }
    }

    // Dispatch only semantic metadata after transitions; missing browser APIs must not interrupt flight.
    emitGameLifecycle(action, run = this.run) {
        if (typeof this.browserWindow.CustomEvent !== 'function'
            || typeof this.browserWindow.dispatchEvent !== 'function') return;
        try {
            this.browserWindow.dispatchEvent(new this.browserWindow.CustomEvent('rocket:gameLifecycle', {
                detail: { action, runId: run.id, routeIndex: run.routeIndex, deliveries: run.delivered,
                    fuel: run.fuel, gameplaySeconds: run.elapsed }
            }));
        } catch { /* Analytics is optional and must never interrupt gameplay. */ }
    }

    // Archive replaced progress as abandoned and restart every new flight on Earth with full fuel.
    newRun() {
        if (this.busy) return;
        this.busy = true;
        return this.mutateStore(() => {
            const previous = this.store.getActive();
            if (previous) {
                previous.status = 'abandoned';
                previous.reason = 'Pilot started a new flight.';
                recordRunEvent(previous, 'abandoned');
                if (!this.store.archive(previous, { claim: true })) return null;
                this.emitGameLifecycle('abandoned', previous);
            }
            const next = createRun();
            if (!this.isForeground()) recordRunEvent(next, 'suspended');
            return this.store.saveActive(next) ? next : null;
        }, next => {
            this.busy = false;
            if (!next) return this.ownershipLost();
            this.run = next;
            this.emitGameLifecycle('started');
            if (!this.isForeground()) this.emitGameLifecycle('suspended');
            this.saveElapsed = 0;
            this.showScreen(this.isForeground() ? 'flight' : 'menu');
            this.updateHud();
            this.message('Earth payload loaded. Hold Space to launch. Release to coast.', 8);
        });
    }

    // Restore all physical state and record a return without counting any offline time.
    continueRun() {
        if (this.busy) return;
        this.busy = true;
        return this.mutateStore(() => {
            const saved = this.store.getActive();
            if (!saved) return null;
            saved.throttle = 1;
            if (!['left', 'suspended', 'interrupted'].includes(saved.events.at(-1)?.type)) recordRunEvent(saved, 'interrupted');
            recordRunEvent(saved, 'returned');
            if (!this.isForeground()) recordRunEvent(saved, 'suspended');
            return this.store.saveActive(saved, { claim: true }) ? saved : null;
        }, saved => {
            this.busy = false;
            if (!saved) return this.ownershipLost();
            this.run = saved;
            this.emitGameLifecycle('continued');
            if (!this.isForeground()) this.emitGameLifecycle('suspended');
            this.showScreen(this.isForeground() ? 'flight' : 'menu');
            this.updateHud();
            this.message('Flight resumed. Engines are idle until you apply thrust.', 5);
        });
    }

    // Persist departures once, then require Continue before any further physics or elapsed time.
    suspend(type = 'left') {
        if (this.mode !== 'flight' || this.run.status !== 'active') return;
        recordRunEvent(this.run, type);
        const departureRun = this.run;
        this.showScreen('menu');
        return this.mutateStore(() => departureRun.status !== 'active' || this.store.saveActive(departureRun), saved => {
            if (!saved) this.ownershipLost();
            else {
                this.emitGameLifecycle(type === 'left' ? 'left' : 'suspended', departureRun);
                if (this.mode === 'menu') this.updateMenu();
            }
        });
    }

    // Return to the start menu while preserving active progress or already-recorded results.
    openMenu() {
        if (this.mode === 'flight') this.suspend('left');
        else this.showScreen('menu');
    }

    // Yield to an explicitly continued or replaced flight in another tab without checkpointing stale state.
    ownershipLost() {
        this.showScreen('menu');
        this.text('savedRunNote', this.store.getActive()
            ? 'The flight recorder changed in another tab. Choose Continue to use its latest saved progress.'
            : 'The flight recorder changed in another tab. Previous results remain available; start a new flight to continue.');
    }

    // Render current fuel draw as a percentage of simultaneous maximum thruster use.
    updateUsageMeter(input = {}) {
        const use = (input.burn ? tuning.mainFuelRate : 0)
            + tuning.rcsFuelRate * (Math.abs(input.rcsX || 0) + Math.abs(input.rcsY || 0))
            + tuning.rotationFuelRate * Math.abs(input.rotate || 0);
        const maximumUse = tuning.mainFuelRate + tuning.rcsFuelRate + tuning.rotationFuelRate;
        const percent = Math.round(Math.min(1, use / maximumUse) * 100);
        this.ui.usageFill.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
        this.ui.usageGauge.setAttribute('aria-valuenow', String(percent));
        this.text('usageValue', `${percent}%`);
    }

    // Combine independently held pointer and keyboard actions into one bounded physics input.
    currentInput() {
        const actions = new Set(this.pointers.values());
        for (const key of this.keys) {
            if (keyControls[key]) actions.add(keyControls[key]);
            if (key.startsWith('button:')) {
                const focusedControl = this.page.activeElement?.dataset.control;
                if (focusedControl) actions.add(focusedControl);
            }
        }
        for (const action of actions) if (!this.loggedActions?.has(action)) this.emitLog('controlPress', action);
        for (const action of this.loggedActions || []) if (!actions.has(action)) this.emitLog('controlRelease', action);
        this.loggedActions = actions;
        for (const button of this.heldButtons) button.classList.toggle('is-held', actions.has(button.dataset.control));
        return {
            burn: actions.has('burn'),
            rotate: Number(actions.has('rotateRight')) - Number(actions.has('rotateLeft')),
            rcsX: 0,
            rcsY: Number(actions.has('rcsDown'))
        };
    }

    // Require an explicit attach action and checkpoint a successful delivery immediately.
    attach() {
        if (this.mode !== 'flight' || this.busy || this.resultsPending) return;
        this.emitLog('dockAttempt', 'gameDock');
        this.busy = true;
        this.clearInput();
        return this.mutateStore(() => {
            if (!this.store.ownsActive(this.run.id)) return 'stale';
            if (!tryDock(this.run)) return 'notReady';
            if (this.run.status === 'won') return this.store.archive(this.run) ? 'won' : 'stale';
            return this.store.saveActive(this.run) ? 'delivered' : 'stale';
        }, result => {
            this.busy = false;
            if (result === 'stale') return this.ownershipLost();
            if (result === 'delivered' || result === 'won') this.emitGameLifecycle('delivered');
            if (result === 'won') this.emitGameLifecycle('won');
            if (result === 'notReady') this.message(`Align upright within ${tuning.dockingDistance} m of the bay marker and slow to ${tuning.dockingSpeed} m/s or less.`, 5);
            else if (result === 'won') this.renderResults();
            else this.message(`Payload delivered. Next: ${targetFor(this.run).body.name}. Hold J to back away from the bay.`, 8);
            this.updateHud();
        });
    }

    // Explain significant flight transitions in a short non-blocking status message.
    message(text, duration = 5) {
        this.text('flightMessage', text);
        this.messageUntil = this.run.elapsed + duration;
    }

    // Archive final state before presenting results so a refresh cannot lose the win or failure record.
    showResults() {
        if (this.resultsPending || this.failedRunId === this.run.id) return;
        this.resultsPending = true;
        this.clearInput();
        return this.mutateStore(() => this.store.ownsActive(this.run.id) && this.store.archive(this.run), saved => {
            this.resultsPending = false;
            if (!saved) return this.ownershipLost();
            this.emitGameLifecycle(this.run.status);
            if (this.run.status === 'lost') {
                this.failedRunId = this.run.id;
                this.failureElapsed = 0;
            } else this.renderResults();
        });
    }

    // Reveal terminal metrics only after the run result has been archived under the shared storage lock.
    renderResults() {
        const won = this.run.status === 'won';
        this.text('resultEyebrow', won ? 'ALL PAYLOADS DELIVERED' : 'FLIGHT RECORDED / RUN LOST');
        this.text('resultTitle', won ? 'Journey complete.' : 'Signal lost.');
        this.text('resultReason', this.run.reason);
        this.text('resultTime', formatTime(this.run.elapsed));
        this.text('resultFuel', `${this.run.fuel.toFixed(1)}%`);
        this.text('resultDeliveries', `${this.run.delivered} / ${route.length}`);
        this.text('resultPlanet', routeBody(this.run.routeIndex).name.toUpperCase());
        this.ui.retryButton.hidden = won;
        this.showScreen('results');
    }

    // Build history with text nodes only so saved data never becomes executable HTML.
    renderHistory() {
        this.ui.historyRows.replaceChildren();
        const active = this.store.getActive();
        const runs = [...(active ? [active] : []), ...this.store.getHistory()];
        if (!runs.length) {
            const empty = this.page.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = 'No flights recorded. Your first launch starts the log.';
            this.ui.historyRows.append(empty);
        }
        for (const run of runs) {
            const row = this.page.createElement('details');
            row.className = `history-row is-${run.status}`;
            const summary = this.page.createElement('summary');
            const values = [
                ['history-result', `▸ ${run.status === 'active' ? 'SAVED' : run.status.toUpperCase()}`],
                ['history-date', new Date(run.startedAt).toLocaleString()],
                ['', formatTime(run.elapsed)], ['', `${run.fuel.toFixed(1)}%`]
            ];
            for (const [className, value] of values) {
                const item = this.page.createElement('span');
                item.className = className;
                item.textContent = value;
                summary.append(item);
            }
            const detail = this.page.createElement('div');
            detail.className = 'history-detail';
            const description = this.page.createElement('p');
            description.textContent = `${run.delivered} / ${route.length} deliveries · ${routeBody(run.routeIndex).name} · ${run.reason || 'Unfinished flight; choose Continue from the menu.'}`;
            const events = this.page.createElement('ol');
            for (const event of run.events) {
                const item = this.page.createElement('li');
                item.textContent = `${formatTime(event.elapsed)} / ${new Date(event.at).toLocaleTimeString()} — ${eventLabels[event.type] || event.type}`;
                events.append(item);
            }
            detail.append(description, events);
            row.append(summary, detail);
            this.ui.historyRows.append(row);
        }
    }

    // Plot world velocity in screen coordinates, independently of the rocket's current attitude.
    updateVelocityDial(run, degrees) {
        const speed = Math.hypot(run.vx, run.vy);
        const moving = speed >= 0.005;
        // Keep slow drift visible and bound fast-flight arrows inside the dial; the number gives exact speed.
        const length = moving ? Math.min(56, Math.max(18, speed * 1.5)) : 0;
        const dx = moving ? run.vx / speed * length : 0;
        const dy = moving ? run.vy / speed * length : 0;
        const x = 80 + dx;
        const y = 80 + dy;
        const nx = moving ? run.vx / speed : 0;
        const ny = moving ? run.vy / speed : 0;
        this.ui.velocityVector.setAttribute('x2', x.toFixed(2));
        this.ui.velocityVector.setAttribute('y2', y.toFixed(2));
        this.ui.velocityVector.setAttribute('visibility', moving ? 'visible' : 'hidden');
        this.ui.velocityArrowHead.setAttribute('visibility', moving ? 'visible' : 'hidden');
        this.ui.velocityArrowHead.setAttribute('d', `M ${x.toFixed(2)} ${y.toFixed(2)} L ${(x - nx * 8 - ny * 4).toFixed(2)} ${(y - ny * 8 + nx * 4).toFixed(2)} L ${(x - nx * 8 + ny * 4).toFixed(2)} ${(y - ny * 8 - nx * 4).toFixed(2)} Z`);
        this.ui.velocityComponents.setAttribute('d', `M 80 80 H ${x.toFixed(2)} M 80 80 V ${y.toFixed(2)}`);
        this.ui.velocityProjection.setAttribute('d', `M ${x.toFixed(2)} 80 V ${y.toFixed(2)} H 80`);
        this.ui.velocityRocket.setAttribute('transform', `translate(80 80) rotate(${degrees})`);
        this.ui.velocityDial.setAttribute('aria-label', `Speed ${speed.toFixed(2)} metres per second. X ${run.vx.toFixed(2)}, Y ${run.vy.toFixed(2)}; positive Y is down. Rocket rotation ${degrees.toFixed(1)} degrees.`);
        this.text('speedValue', speed.toFixed(2));
        this.text('vxValue', `${run.vx >= 0 ? '+' : ''}${run.vx.toFixed(2)}`);
        this.text('vyValue', `${run.vy >= 0 ? '+' : ''}${run.vy.toFixed(2)}`);
    }

    // Update readable flight instruments and the same tolerance indicators that the physics enforces.
    updateHud() {
        const run = this.run;
        const near = nearestBody(run);
        const target = targetFor(run);
        const gravity = gravityAt(run.x, run.y);
        const docking = dockingStatus(run);
        const degrees = run.angle * 180 / Math.PI;
        const inRange = near.altitude <= tuning.influenceAltitude;
        this.text('fuelValue', run.fuel.toFixed(1));
        this.ui.fuelValue.closest('.fuel-panel').classList.toggle('is-low', run.fuel < 20);
        this.ui.fuelFill.style.width = `${run.fuel}%`;
        this.ui.fuelGauge.setAttribute('aria-valuenow', run.fuel.toFixed(1));
        this.text('timeValue', formatTime(run.elapsed));
        this.text('deliveryValue', String(run.delivered).padStart(2, '0'));
        this.text('altitudeValue', inRange ? Math.max(0, near.altitude).toFixed(1) : '—');
        this.updateVelocityDial(run, degrees);
        this.text('gravityValue', gravity.magnitude.toFixed(2));
        this.text('rotationValue', `${degrees.toFixed(1)}°`);
        this.text('payloadValue', run.payload ? 'LOADED' : 'EMPTY');
        this.text('routePosition', `STOP ${String(run.routeIndex + 1).padStart(2, '0')} / 10`);
        this.text('objectiveType', 'CURRENT OBJECTIVE:');
        this.text('objectiveName', target.name.toUpperCase());
        this.ui.flightCanvas.setAttribute('aria-label', `Rocket flight view. Target ${target.name}, ${formatDistance(Math.hypot(run.x - target.x, run.y - target.y))} away. Instruments and controls are below.`);
        this.text('environmentLabel', inRange ? `${near.body.name.toUpperCase()} / ${near.body.gas && near.altitude < 200 ? 'ATMOSPHERE' : near.altitude < 50 ? 'SURFACE OPERATIONS' : 'GRAVITY ZONE'}` : 'DEEP SPACE / COAST TO CONSERVE');
        this.text('dockState', run.docked ? 'ATTACHED' : run.phase !== 'station' ? 'DELIVERED' : docking.ready ? 'READY TO ATTACH' : 'ALIGNING');
        const wasDockHidden = this.ui.dockDialog.hidden;
        this.ui.dockDialog.hidden = !(this.mode === 'flight' && run.status === 'active'
            && run.phase === 'station' && !run.docked && docking.distance <= tuning.dockingAssistDistance);
        if (wasDockHidden !== this.ui.dockDialog.hidden) this.emitLog('dockingChecklist', 'gameDock', { open: !this.ui.dockDialog.hidden });
        this.ui.dockRangeCheck.classList.toggle('is-ready', docking.distance <= tuning.dockingDistance);
        this.ui.dockSpeedCheck.classList.toggle('is-ready', docking.speed <= tuning.dockingSpeed);
        this.ui.dockAngleCheck.classList.toggle('is-ready', docking.angle <= tuning.dockingAngle);
        this.text('dockRangeCheck', `${docking.distance <= tuning.dockingDistance ? '✓' : '○'} Move within 32 m of the bay — now ${docking.distance.toFixed(0)} m`);
        this.text('dockSpeedCheck', `${docking.speed <= tuning.dockingSpeed ? '✓' : '○'} Slow to ${tuning.dockingSpeed} m/s or less — now ${docking.speed.toFixed(1)} m/s`);
        this.text('dockAngleCheck', `${docking.angle <= tuning.dockingAngle ? '✓' : '○'} Point nose straight up (0° ±12°) — now ${degrees.toFixed(0)}°`);
        this.ui.dockButton.classList.toggle('is-ready', docking.ready);
        this.ui.dockButton.disabled = !docking.ready;
        this.updateUsageMeter(this.activeInput);
    }

    // Run bounded fixed steps for stable collisions and checkpoint once per second of active flight.
    frame(now) {
        const dt = this.lastFrame === null ? 0 : Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
        this.lastFrame = now;
        let input = {};
        if (this.mode === 'flight' && !this.busy && !this.resultsPending && this.page.visibilityState !== 'hidden') {
            input = this.currentInput();
            this.accumulator += dt;
            const previousIndex = this.run.routeIndex;
            while (this.accumulator >= tuning.fixedStep && this.run.status === 'active') {
                if (this.pendingDash !== null) {
                    const direction = this.pendingDash;
                    this.pendingDash = null;
                    if (dashRun(this.run, direction)) {
                        this.renderer.dashBurst?.(this.run, direction);
                        this.message(`Dash ${direction}. Cooldown: 2s.`, 2);
                    }
                }
                stepRun(this.run, input);
                this.accumulator -= tuning.fixedStep;
            }
            if (this.run.status !== 'active') this.showResults();
            else {
                this.saveElapsed += dt;
                if (previousIndex !== this.run.routeIndex) {
                    this.emitGameLifecycle('landed');
                    this.message(`${routeBody(this.run.routeIndex).name} touchdown. Fuel received; next payload loaded.`, 8);
                }
                if (!this.savePending && (this.saveElapsed >= 1 || previousIndex !== this.run.routeIndex)) {
                    this.run.updatedAt = Date.now();
                    const checkpointRun = this.run;
                    this.savePending = true;
                    this.saveElapsed = 0;
                    this.mutateStore(() => {
                        if (checkpointRun.status !== 'active' || this.mode !== 'flight' || this.run !== checkpointRun) return true;
                        return this.store.saveActive(checkpointRun);
                    }, saved => {
                        this.savePending = false;
                        if (!saved) this.ownershipLost();
                    });
                }
                if (this.run.elapsed > this.messageUntil) this.text('flightMessage', '');
            }
        }
        this.activeInput = this.mode === 'flight' && !this.busy && !this.resultsPending ? input : {};
        this.hudElapsed += dt;
        if (this.hudElapsed >= 0.1 || dt === 0) {
            this.updateHud();
            this.hudElapsed = 0;
        }
        if (this.mode === 'flight' && this.failedRunId === this.run.id) {
            this.failureElapsed += dt;
            if (this.failureElapsed >= 0.9) this.renderResults();
        }
        const failureProgress = this.failedRunId === this.run.id ? Math.min(1, this.failureElapsed / 0.9) : null;
        this.renderer.draw(this.run, this.mode === 'flight' ? input : {}, this.mode !== 'flight', dt || 1 / 60, failureProgress);
        if (this.animating) this.browserWindow.requestAnimationFrame(next => this.frame(next));
    }
}

// Start independently of remote analytics so a blocked CDN cannot prevent local gameplay.
if (typeof document !== 'undefined' && document.getElementById('flightCanvas')) {
    try {
        new FlightApp();
    } catch (error) {
        console.error('[orbital freight] Startup failed.', error);
        const warning = document.getElementById('storageWarning');
        warning.textContent = 'The flight system could not start. Reload in a current browser with canvas and JavaScript enabled.';
        warning.hidden = false;
    }
}
