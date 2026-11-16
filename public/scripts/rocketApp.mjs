import {
    createRun, route, routeBody, tuning, stepRun, targetFor, nearestBody,
    stationFor, gravityAt, dockingStatus, tryDock, recordRunEvent
} from './rocketPhysics.mjs';
import { RunStore } from './rocketStorage.mjs';
import { RocketRenderer } from './rocketRenderer.mjs';

const keyControls = Object.freeze({
    Space: 'burn', ArrowUp: 'burn', KeyA: 'rotateLeft', ArrowLeft: 'rotateLeft',
    KeyD: 'rotateRight', ArrowRight: 'rotateRight', KeyI: 'rcsUp',
    KeyK: 'rcsDown', KeyJ: 'rcsLeft', KeyL: 'rcsRight'
});
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
        this.pointers = new Map();
        this.heldButtons = [...page.querySelectorAll('[data-control]')];
        this.accumulator = 0;
        this.saveElapsed = 0;
        this.hudElapsed = 0;
        this.messageUntil = 0;
        this.lastFrame = null;
        this.animating = autoStart;
        let storage = null;
        try { storage = browserWindow.localStorage; } catch { /* The visible warning below covers denied storage access. */ }
        this.store = store || new RunStore(storage, message => this.showStorageWarning(message));
        const saved = this.store.getActive();
        this.run = saved || createRun();
        if (saved && !['left', 'suspended', 'interrupted'].includes(saved.events.at(-1)?.type)) {
            recordRunEvent(this.run, 'interrupted');
            this.store.saveActive(this.run);
        }
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

    // Change one text node only when its value changes to keep the frequently updated HUD lightweight.
    text(id, value) {
        const element = this.ui[id];
        if (element.textContent !== String(value)) element.textContent = String(value);
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
        this.ui.throttleSlider.addEventListener('input', event => this.setThrottle(Number(event.target.value) / 100));
        this.ui.throttleUpButton.addEventListener('click', () => this.setThrottle(this.run.throttle + 0.05));
        this.ui.throttleDownButton.addEventListener('click', () => this.setThrottle(this.run.throttle - 0.05));
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
            if (this.mode !== 'flight' || !['Space', 'Enter'].includes(event.code)) return;
            event.preventDefault();
            event.stopPropagation();
            this.keys.add(`button:${event.code}`);
        });
        button.addEventListener('blur', () => {
            this.keys.delete('button:Space');
            this.keys.delete('button:Enter');
        });
    }

    // Handle flight shortcuts without stealing slider keys, browser shortcuts, or ordinary button activation.
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
        if (keyControls[event.code]) {
            event.preventDefault();
            this.keys.add(event.code);
        } else if (event.code === 'KeyW' || event.code === 'KeyS') {
            event.preventDefault();
            this.setThrottle(this.run.throttle + (event.code === 'KeyW' ? 0.05 : -0.05));
        } else if (event.code === 'KeyE' && !event.repeat) {
            event.preventDefault();
            this.attach();
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
        this.keys.clear();
        this.pointers.clear();
        for (const button of this.heldButtons) button.classList.remove('is-held');
    }

    // Show exactly one screen and disable background controls while a dialog is open.
    showScreen(mode, focus = true) {
        this.mode = mode;
        this.clearInput();
        this.accumulator = 0;
        this.lastFrame = null;
        const panels = { menu: 'mainMenu', confirm: 'confirmPanel', history: 'historyPanel', results: 'resultPanel' };
        for (const [screen, id] of Object.entries(panels)) this.ui[id].hidden = mode !== screen;
        this.ui.menuOverlay.hidden = mode === 'flight';
        this.ui.instrumentPanel.inert = mode !== 'flight';
        this.ui.controlPanel.inert = mode !== 'flight';
        this.ui.menuButton.inert = mode !== 'flight';
        this.page.querySelector('.wordmark').inert = mode !== 'flight';
        this.text('systemStatus', mode === 'flight' ? 'FLIGHT ACTIVE' : mode === 'results' ? 'FLIGHT RECORDED' : 'AWAITING PILOT');
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

    // Archive replaced progress as abandoned and restart every new flight on Earth with full fuel.
    newRun() {
        const previous = this.store.getActive();
        if (previous) {
            previous.status = 'abandoned';
            previous.reason = 'Pilot started a new flight.';
            recordRunEvent(previous, 'abandoned');
            this.store.archive(previous);
        }
        this.run = createRun();
        this.saveElapsed = 0;
        this.store.saveActive(this.run);
        this.showScreen('flight');
        this.updateHud();
        this.message('Earth payload loaded. Hold Space to launch. Release to coast.', 8);
    }

    // Restore all physical state and record a return without counting any offline time.
    continueRun() {
        const saved = this.store.getActive();
        if (!saved) return;
        this.run = saved;
        recordRunEvent(this.run, 'returned');
        this.store.saveActive(this.run);
        this.showScreen('flight');
        this.updateHud();
        this.message('Flight resumed. Engines are idle until you apply thrust.', 5);
    }

    // Persist departures once, then require Continue before any further physics or elapsed time.
    suspend(type = 'left') {
        if (this.mode !== 'flight' || this.run.status !== 'active') return;
        recordRunEvent(this.run, type);
        this.store.saveActive(this.run);
        this.showScreen('menu');
    }

    // Return to the start menu while preserving active progress or already-recorded results.
    openMenu() {
        if (this.mode === 'flight') this.suspend('left');
        else this.showScreen('menu');
    }

    // Clamp user throttle changes and show the setting immediately, including while an engine is held.
    setThrottle(throttle) {
        if (this.mode !== 'flight' || !Number.isFinite(throttle)) return;
        this.run.throttle = Math.max(0, Math.min(1, throttle));
        this.updateHud();
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
        for (const button of this.heldButtons) button.classList.toggle('is-held', actions.has(button.dataset.control));
        return {
            burn: actions.has('burn'),
            rotate: Number(actions.has('rotateRight')) - Number(actions.has('rotateLeft')),
            rcsX: Number(actions.has('rcsRight')) - Number(actions.has('rcsLeft')),
            rcsY: Number(actions.has('rcsDown')) - Number(actions.has('rcsUp'))
        };
    }

    // Require an explicit attach action and checkpoint a successful delivery immediately.
    attach() {
        if (this.mode !== 'flight') return;
        if (!tryDock(this.run)) {
            this.message('Align upright within 32 m of the bay marker and slow below 5 m/s.', 5);
            return;
        }
        if (this.run.status === 'won') this.showResults();
        else {
            this.store.saveActive(this.run);
            this.message(`Payload delivered. Next: ${targetFor(this.run).body.name}. Apply thrust to detach.`, 8);
        }
        this.updateHud();
    }

    // Explain significant flight transitions in a short non-blocking status message.
    message(text, duration = 5) {
        this.text('flightMessage', text);
        this.messageUntil = this.run.elapsed + duration;
    }

    // Archive final state before presenting results so a refresh cannot lose the win or failure record.
    showResults() {
        this.store.archive(this.run);
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

    // Update readable flight instruments and the same tolerance indicators that the physics enforces.
    updateHud() {
        const run = this.run;
        const near = nearestBody(run);
        const target = targetFor(run);
        const gravity = gravityAt(run.x, run.y);
        const station = stationFor(target.body);
        const docking = dockingStatus(run);
        const degrees = run.angle * 180 / Math.PI;
        const throttle = Math.round(run.throttle * 100);
        const inRange = near.altitude <= tuning.influenceAltitude;
        this.text('fuelValue', run.fuel.toFixed(1));
        this.text('fuelState', run.fuel < 20 ? 'LOW FUEL' : 'NOMINAL');
        this.ui.fuelValue.closest('.fuel-panel').classList.toggle('is-low', run.fuel < 20);
        this.ui.fuelFill.style.width = `${run.fuel}%`;
        this.ui.fuelGauge.setAttribute('aria-valuenow', run.fuel.toFixed(1));
        this.text('timeValue', formatTime(run.elapsed));
        this.text('deliveryValue', String(run.delivered).padStart(2, '0'));
        this.text('altitudeValue', inRange ? Math.max(0, near.altitude).toFixed(1) : '—');
        this.text('stationValue', Math.hypot(run.x - station.x, run.y - station.y).toFixed(0));
        this.text('speedValue', Math.hypot(run.vx, run.vy).toFixed(1));
        this.text('gravityValue', gravity.magnitude.toFixed(2));
        this.text('rotationValue', degrees.toFixed(1));
        this.text('payloadValue', run.payload ? 'LOADED' : 'EMPTY');
        this.text('vxValue', `${run.vx >= 0 ? '+' : ''}${run.vx.toFixed(1)}`);
        this.text('vyValue', `${run.vy >= 0 ? '+' : ''}${run.vy.toFixed(1)}`);
        this.text('routePosition', `STOP ${String(run.routeIndex + 1).padStart(2, '0')} / 10`);
        this.text('objectiveType', `CURRENT OBJECTIVE / ${target.type === 'station' ? 'RELAY' : 'LANDING PAD'}`);
        this.text('objectiveName', target.name.toUpperCase());
        this.text('objectiveDistance', formatDistance(Math.hypot(run.x - target.x, run.y - target.y)));
        this.text('environmentLabel', inRange ? `${near.body.name.toUpperCase()} / ${near.body.gas && near.altitude < 200 ? 'ATMOSPHERE' : near.altitude < 50 ? 'SURFACE OPERATIONS' : 'GRAVITY ZONE'}` : 'DEEP SPACE / COAST TO CONSERVE');
        this.text('dockState', run.docked ? 'ATTACHED' : run.phase !== 'station' ? 'DELIVERED' : docking.ready ? 'READY TO ATTACH' : 'ALIGNING');
        this.ui.dockRangeCheck.classList.toggle('is-ready', docking.distance <= tuning.dockingDistance);
        this.ui.dockSpeedCheck.classList.toggle('is-ready', docking.speed <= tuning.dockingSpeed);
        this.ui.dockAngleCheck.classList.toggle('is-ready', docking.angle <= tuning.dockingAngle);
        this.ui.dockButton.classList.toggle('is-ready', docking.ready);
        this.ui.dockButton.disabled = !docking.ready;
        this.ui.throttleSlider.value = String(throttle);
        this.text('throttleValue', `${throttle}%`);
        this.ui.attitudeNeedle.style.transform = `rotate(${degrees}deg)`;
        this.text('pilotNote', run.docked ? `Payload delivered. Next pad: ${target.body.name}. Burn or use RCS to detach.`
            : run.phase === 'planet' ? `Next: ${target.body.name}. Surface gravity ${target.body.gravity.toFixed(2)} m/s². Land upright at ≤ 8 m/s. Brake early.`
                : near.altitude < 100 ? `Launch upright. Use at least ${Math.ceil(near.body.gravity / tuning.mainAcceleration * 100)}% throttle here; release to coast.`
                    : 'Approach the amber bay marker. Use I/J/K/L to cancel drift; align upright and press E.');
    }

    // Run bounded fixed steps for stable collisions and checkpoint once per second of active flight.
    frame(now) {
        const dt = this.lastFrame === null ? 0 : Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
        this.lastFrame = now;
        let input = {};
        if (this.mode === 'flight' && this.page.visibilityState !== 'hidden') {
            input = this.currentInput();
            this.accumulator += dt;
            const previousIndex = this.run.routeIndex;
            while (this.accumulator >= tuning.fixedStep && this.run.status === 'active') {
                stepRun(this.run, input);
                this.accumulator -= tuning.fixedStep;
            }
            if (this.run.status !== 'active') this.showResults();
            else {
                this.saveElapsed += dt;
                if (previousIndex !== this.run.routeIndex) {
                    this.message(`${routeBody(this.run.routeIndex).name} touchdown. Fuel received; next payload loaded.`, 8);
                }
                if (this.saveElapsed >= 1 || previousIndex !== this.run.routeIndex) {
                    this.run.updatedAt = Date.now();
                    this.store.saveActive(this.run);
                    this.saveElapsed = 0;
                }
                if (this.run.elapsed > this.messageUntil) this.text('flightMessage', '');
            }
        }
        this.hudElapsed += dt;
        if (this.hudElapsed >= 0.1 || dt === 0) {
            this.updateHud();
            this.hudElapsed = 0;
        }
        this.renderer.draw(this.run, this.mode === 'flight' ? input : {}, this.mode !== 'flight', dt || 1 / 60);
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
