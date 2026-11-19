import { MultiplayerClient, multiplayerUrl } from './multiplayerClient.mjs?v=20261118-multiplayer';
import { bodies, tuning, createWorld, stepWorld, targetFor,
    setTarget, dockingStatus, nearestRelay, interact, hackDigit, nextUpgrade, upgradePlanet,
    killPlayer, stationFor, nextRocketUpgrade, upgradeRocket } from './conquestPhysics.mjs?v=20261118-multiplayer';
import { ConquestStore, reconnectWindow } from './conquestStorage.mjs?v=20261118-multiplayer';
import { ConquestRenderer } from './conquestRenderer.mjs?v=20261118-multiplayer';

const keyControls = { KeyW: 'burn', ArrowUp: 'burn', KeyS: 'rcsDown', Space: 'fire' };
const eventActions = { damaged: 'damaged', landed: 'landed', started: 'spawned', undocked: 'detached', spawned: 'spawned', died: 'died', respawned: 'respawned', docked: 'docked',
    detached: 'detached', hackStarted: 'hackStarted', hackProgress: 'hackProgress', hackCancelled: 'hackCancelled',
    rocketUpgraded: 'upgraded', captured: 'captured', cargoCollected: 'cargoCollected', cargoDropped: 'cargoDropped', cargoPickedUp: 'cargoPickedUp',
    refuelStarted: 'refuelStarted', refuelEnded: 'refuelEnded', upgraded: 'upgraded' };

// Format simulation time as minutes and tenths without depending on a wall-clock timer.
export function formatTime(seconds) {
    const tenths = Math.floor(Math.max(0, seconds) * 10);
    return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

// Present distances in meters near a relay and kilometers for interplanetary navigation.
export function formatDistance(value) {
    return value < 1000 ? `${Math.max(0, value).toFixed(value < 100 ? 1 : 0)} m` : `${(value / 1000).toFixed(1)} km`;
}

// Drive one entirely local galaxy while keeping its rules independent from browser controls and rendering.
export class ConquestApp {
    // Inject browser, persistence and rendering interfaces to support deterministic lifecycle checks.
    constructor({ page = globalThis.document, browserWindow = globalThis.window, store = null, renderer = null, autoStart = true, now = () => Date.now(), serverUrl = null, connectionFactory = options => new MultiplayerClient(options) } = {}) {
        this.page = page;
        this.browserWindow = browserWindow;
        this.now = now;
        this.ui = Object.fromEntries([...page.querySelectorAll('[id]')].map(node => [node.id, node]));
        this.keys = new Set();
        this.pointers = new Map();
        this.loggedActions = new Set();
        this.heldButtons = [...page.querySelectorAll('[data-control]')];
        this.mode = 'menu';
        this.running = false;
        this.animating = autoStart;
        this.lastFrame = null;
        this.accumulator = 0;
        this.saveElapsed = 0;
        this.hudElapsed = 0;
        this.lastEvent = 0;
        this.dockErrorUntil = 0;
        this.fuelDamageAmount = 0;
        this.fuelDamageUntil = 0;
        this.firing = false;
        this.messageUntil = 0;
        this.aimSet = false;
        this.aimCursor = null;
        this.dockDialogMotion = null;
        this.lastHiddenAt = null;
        let storage = null;
        try { storage = browserWindow.sessionStorage; } catch { /* The visible warning explains memory-only play. */ }
        this.store = store || new ConquestStore(storage, message => this.storageWarning(message), now);
        const connectionUrl = serverUrl === null ? multiplayerUrl(page, browserWindow) : serverUrl;
        const restored = connectionUrl ? null : this.store.restore();
        this.world = restored?.world || createWorld();
        this.lastDisplayedCargo = Math.floor(this.world.player.cargo);
        this.hasSession = Boolean(restored);
        this.lastEvent = restored?.lastEvent || 0;
        this.renderer = renderer || new ConquestRenderer(this.ui.flightCanvas, this.ui.mapCanvas);
        this.connection = connectionUrl ? connectionFactory({ url: connectionUrl, storage,
            onWorld: (world, details) => this.receiveWorld(world, details),
            onEvent: event => { this.world.events.push(event); this.drainEvents(); },
            onChat: message => this.appendChat(message.text, false, message),
            onCapture: message => {
                if (message.owner === this.world.player.id) return;
                const body = bodies.find(body => body.id === message.bodyId);
                this.appendChat(body?.name || 'Planet', true, message);
                this.renderer.beginCapture?.(message.bodyId, message.color);
            },
            onDeath: event => this.renderer.beginRemoteDeath?.(event),
            onStatus: status => {
                if (status === 'reconnecting') {
                    this.running = false; this.clearInput(); this.showScreen('menu', false);
                    this.text('saveNote', 'Connection lost. Reconnecting; your place is reserved for 30 seconds.');
                } else if (status !== 'connected') this.message(status);
            }
        }) : null;
        if (this.connection) {
            this.text('gameModeLabel', 'SHARED GALAXY / MULTIPLAYER');
            this.text('mapModeLabel', 'MILKY WAY / ONLINE');
            this.text('menuDescription', 'Compete for planets. Upgrade your rocket. One galaxy, shared by every pilot.');
            this.ui.serverChat.setAttribute('aria-label', 'Room chat');
            this.ui.chatInput.setAttribute('aria-label', 'Room chat message');
        }
        this.bindEvents();
        this.showScreen('menu', false);
        this.updateHud({});
        if (restored) this.emit('continued');
        if (this.store.expired) this.emit('expired');
        if (autoStart) browserWindow.requestAnimationFrame(time => this.frame(time));
    }

    // Change only modified text nodes to keep instrument updates inexpensive.
    text(id, value) {
        const node = this.ui[id];
        if (node && node.textContent !== String(value)) node.textContent = String(value);
    }

    // Surface blocked storage without preventing the flight loop from starting.
    storageWarning(message) {
        this.text('storageWarning', message);
        this.ui.storageWarning.hidden = false;
    }

    // Dispatch bounded semantic outcomes; the logger projects them into its strict public schema.
    emit(action, details = {}) {
        if (!this.browserWindow.CustomEvent || !this.browserWindow.dispatchEvent) return;
        const player = this.world?.player;
        const owned = Object.values(this.world?.planets || {}).filter(planet => planet.owner === player?.id).length;
        this.browserWindow.dispatchEvent(new this.browserWindow.CustomEvent('rocket:conquest', { detail: {
            action, target: 'conquest', gameplaySeconds: Math.max(0, (this.world?.elapsed || 0) - (player?.joinedAt || 0)), fuel: player?.fuel || 0,
            cargo: Math.floor(player?.cargo || 0), owned, planetLevel: 0, ...details,
            ...(details.amount !== undefined ? { amount: Math.max(0, Math.round(details.amount)) } : {})
        } }));
    }

    // Retain standard held-control and screen events for the existing action logger.
    log(name, target, details = {}) {
        if (!this.browserWindow.CustomEvent || !this.browserWindow.dispatchEvent) return;
        this.browserWindow.dispatchEvent(new this.browserWindow.CustomEvent('rocket:log', { detail: { name, target, details } }));
    }

    // Bind explicit choices, local search, pointer flight controls, and lifecycle transitions.
    bindEvents() {
        this.ui.playButton.addEventListener('click', () => this.requestNew());
        this.ui.continueButton.addEventListener('click', () => this.continueSession());
        this.ui.menuButton.addEventListener('click', () => this.showScreen('menu'));
        this.ui.galaxiesButton.addEventListener('click', () => this.showScreen('servers'));
        this.ui.galaxyBackButton.addEventListener('click', () => this.showScreen('menu'));
        this.ui.joinGalaxyButton.addEventListener('click', () => this.hasSession ? this.continueSession() : this.newSession());
        this.ui.recordsButton.addEventListener('click', () => { this.renderRecords(); this.showScreen('history'); });
        this.ui.recordsBackButton.addEventListener('click', () => this.showScreen('menu'));
        this.ui.confirmButton.addEventListener('click', () => this.confirmAction());
        this.ui.cancelButton.addEventListener('click', () => {
            if (this.confirmKind === 'selfDestruct') this.emit('selfDestructCancelled');
            this.showScreen(this.confirmReturn || 'menu');
        });
        this.ui.chatForm.addEventListener('submit', event => {
            event.preventDefault();
            const text = this.ui.chatInput.value.trim().slice(0, 160);
            if (text) {
                if (this.connection) this.connection.chat(text);
                else this.appendChat(text);
            }
            this.ui.chatInput.value = '';
            this.ui.chatForm.hidden = true;
            this.ui.flightCanvas.focus();
        });
        this.ui.chatInput.addEventListener('focus', () => this.clearInput());
        this.ui.interactButton.addEventListener('click', () => this.interact());
        this.ui.upgradeButton.addEventListener('click', () => this.upgrade());
        this.ui.rocketUpgradeButton.addEventListener('click', () => this.rocketUpgrade());
        this.ui.leaveGalaxyButton.addEventListener('click', () => {
            if (this.connection) this.emit('left');
            this.connection?.leave(); this.hasSession = false; this.running = false; this.showScreen('menu'); this.updateMenu();
        });
        this.ui.selfDestructButton.addEventListener('click', () => this.requestSelfDestruct());
        this.ui.digitButton.addEventListener('click', () => this.enterDigit(this.world.hack?.digit));
        this.ui.mapCanvas.addEventListener('click', event => {
            const target = this.renderer.mapTarget?.(event.clientX, event.clientY);
            if (target) this.chooseTarget(target.bodyId);
        });
        this.ui.galaxySearch.addEventListener('input', () => {
            const visible = 'milky way local'.includes(this.ui.galaxySearch.value.trim().toLowerCase());
            this.ui.galaxyListing.hidden = !visible;
            this.ui.galaxyEmpty.hidden = visible;
        });
        const viewport = this.ui.flightCanvas.parentElement;
        viewport.addEventListener('pointermove', event => this.aimAt(event));
        viewport.addEventListener('pointerleave', () => { this.aimCursor = null; this.aimSet = false; });
        this.ui.flightCanvas.addEventListener('pointerdown', event => {
            if (this.mode === 'flight' && event.pointerType === 'touch') this.aimAt(event);
        });
        for (const button of this.heldButtons) this.bindHeldButton(button);
        this.page.addEventListener('keydown', event => this.keyDown(event));
        this.page.addEventListener('keyup', event => {
            this.keys.delete(event.code);
            this.keys.delete(`button:${event.code}`);
            if (/^(Digit|Numpad)[0-9]$/.test(event.code) && this.world.hack) hackDigit(this.world, null);
        });
        this.browserWindow.addEventListener('blur', () => this.clearInput());
        this.page.addEventListener('visibilitychange', () => {
            if (this.page.visibilityState === 'hidden') this.suspend();
            else this.returnFromBackground();
        });
        this.browserWindow.addEventListener('pagehide', () => this.suspend());
        this.browserWindow.addEventListener('pageshow', () => this.returnFromBackground());
    }

    // Pointer capture releases every held action reliably, including multiple simultaneous touches.
    bindHeldButton(button) {
        button.addEventListener('pointerdown', event => {
            if (this.mode !== 'flight' || event.button !== 0) return;
            event.preventDefault();
            button.setPointerCapture(event.pointerId);
            this.pointers.set(event.pointerId, button.dataset.control);
        });
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
            button.addEventListener(name, event => this.pointers.delete(event.pointerId));
        }
        button.addEventListener('keydown', event => {
            if (this.mode !== 'flight' || event.code !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            this.keys.add(`button:${event.code}`);
        });
        button.addEventListener('blur', () => { this.keys.delete('button:Space'); this.keys.delete('button:Enter'); });
    }

    // Map intentional gameplay keys while keeping browser shortcuts and form inputs usable.
    keyDown(event) {
        // Chat text stays local and never becomes a flight control or an analytics payload.
        if (event.target === this.ui.chatInput) {
            if (event.code === 'Escape') {
                event.preventDefault(); this.ui.chatForm.hidden = true; this.ui.flightCanvas.focus();
            }
            return;
        }
        if (this.mode === 'flight' && event.code === 'Slash' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault(); this.clearInput(); this.ui.chatForm.hidden = false; this.ui.chatInput.focus(); return;
        }
        if (event.code === 'Tab' && this.mode !== 'flight') return this.trapFocus(event);
        if (event.code === 'Tab' && this.mode === 'flight') {
            event.preventDefault();
            if (!event.repeat) {
                const expanded = this.ui.galaxyMap.classList.toggle('is-expanded');
                this.ui.galaxyMap.setAttribute('aria-label', expanded ? 'Expanded galaxy map' : 'Galaxy map');
            }
            return;
        }
        if (event.code === 'Escape') {
            event.preventDefault();
            this.showScreen(this.mode === 'flight' ? 'menu' : this.hasSession && this.running ? 'flight' : 'menu');
            return;
        }
        if (this.mode !== 'flight' || event.ctrlKey || event.metaKey || event.altKey
            || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)) return;
        // Keep shop shortcuts local to an owned relay; held keys must never repeat purchases.
        const ownedRelay = this.world.player.docked && !this.world.hack
            && this.world.planets[this.world.player.docked]?.owner === this.world.player.id;
        if (ownedRelay && (event.code === 'KeyT' || event.code === 'KeyR')) {
            event.preventDefault();
            if (!event.repeat) {
                if (event.code === 'KeyT') this.upgrade();
                else this.rocketUpgrade();
            }
            return;
        }
        const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
        if (digit && !event.repeat) {
            event.preventDefault();
            this.enterDigit(digit[1]);
            return;
        }
        if (event.code === 'KeyE' && !event.repeat) { event.preventDefault(); this.interact(); return; }
        if (keyControls[event.code]) {
            event.preventDefault();
            this.keys.add(event.code);
            this.animateControlsHint(event.code);
        }
    }

    // Hold keyboard focus within a displayed menu instead of tabbing into the flight scene.
    trapFocus(event) {
        const panel = this.ui[{ menu: 'mainMenu', servers: 'galaxyPanel', history: 'recordsPanel', confirm: 'confirmPanel' }[this.mode]];
        const nodes = [...panel.querySelectorAll('button:not([hidden]):not([disabled]), input, summary')];
        if (!nodes.length) return;
        const index = nodes.indexOf(this.page.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); nodes.at(-1).focus(); }
        else if (!event.shiftKey && (index < 0 || index === nodes.length - 1)) { event.preventDefault(); nodes[0].focus(); }
    }

    // Keep cursor position local and normalized so aim stays accurate as the camera and canvas move.
    aimAt(event) {
        if (this.mode !== 'flight') return;
        const bounds = this.ui.flightCanvas.getBoundingClientRect();
        if (!(bounds.width > 0 && bounds.height > 0) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        this.aimCursor = { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
            y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
        const viewport = this.ui.flightCanvas.parentElement.getBoundingClientRect();
        this.ui.controlsHint.style.left = `${event.clientX - viewport.left + 14}px`;
        this.ui.controlsHint.style.top = `${event.clientY - viewport.top + 14}px`;
        this.world.player.aimAngle = this.renderer.aimAt(event.clientX, event.clientY, this.world.player);
        this.aimSet = true;
    }

    // Animate and dismiss only the startup guide line for the key the pilot used.
    animateControlsHint(code) {
        const hintCode = ({ KeyW: 'KeyW', ArrowUp: 'KeyW', KeyS: 'KeyS', Space: 'Space' })[code];
        if (!hintCode) return;
        const line = this.ui.controlsHint.querySelector(`[data-control-hint="${hintCode}"]`);
        if (!line || line.hidden || line.classList.contains('is-pressed')) return;
        line.classList.add('is-pressed');
        this.browserWindow.setTimeout(() => {
            line.classList.add('is-leaving');
            this.browserWindow.setTimeout(() => {
                line.hidden = true;
                const remaining = this.ui.controlsHint.querySelector('.controls-hint-line:not([hidden])');
                if (!remaining) this.ui.controlsHint.hidden = true;
            }, 260);
        }, 1000);
    }

    // Clear thrust and fire inputs whenever focus changes.
    clearInput() {
        for (const action of this.loggedActions) this.log('controlRelease', action);
        this.loggedActions.clear();
        this.keys.clear();
        this.pointers.clear();
        for (const button of this.heldButtons) button.classList.toggle('is-held', false);
        if (this.firing) this.emit('shotEnded', { amount: Math.max(0, this.world.stats.shots - (this.shotStartCount || 0)) });
        this.firing = false;
        this.activeInput = {};
    }

    // Present one menu while keeping the live galaxy running behind it after Play.
    showScreen(mode, focus = true) {
        this.mode = mode;
        this.ui.gameShell.dataset.screen = mode;
        this.clearInput();
        this.ui.menuOverlay.hidden = mode === 'flight';
        const panels = { menu: 'mainMenu', servers: 'galaxyPanel', history: 'recordsPanel', confirm: 'confirmPanel' };
        for (const [name, id] of Object.entries(panels)) this.ui[id].hidden = name !== mode;
        this.ui.menuButton.inert = mode !== 'flight';
        this.ui.dockDialog.hidden = true;
        if (mode === 'menu') this.updateMenu();
        this.log('screenView', mode);
        if (this.hasSession && mode === 'menu') this.emit('left');
        if (focus && this.page.visibilityState !== 'hidden') {
            const target = mode === 'flight' ? this.ui.flightCanvas : this.ui[panels[mode]];
            target.focus({ preventScroll: true });
        }
        const hasVisibleHint = Boolean(this.ui.controlsHint.querySelector('.controls-hint-line:not([hidden])'));
        this.ui.controlsHint.hidden = mode !== 'flight' || !hasVisibleHint;
        if (mode === 'flight' && !this.aimSet) {
            this.ui.controlsHint.style.left = 'calc(50% + 14px)';
            this.ui.controlsHint.style.top = 'calc(50% + 14px)';
        }
    }

    // Explain local persistence honestly instead of presenting the singleplayer room as an online server.
    updateMenu() {
        if (this.connection) {
            this.ui.continueButton.hidden = !this.hasSession && !this.connection.token;
            this.ui.playButton.hidden = this.hasSession;
            this.ui.leaveGalaxyButton.hidden = !this.hasSession;
            this.ui.galaxiesButton.hidden = true;
            this.text('playButton', 'PLAY →');
            this.text('saveNote', this.hasSession ? `${this.world.online || 1} pilots in the shared galaxy. Menu does not pause flight.`
                : 'One shared galaxy. Play joins the room; refresh can reconnect for 30 seconds.');
            return;
        }
        this.ui.continueButton.hidden = !this.hasSession;
        this.ui.playButton.textContent = this.hasSession ? 'NEW GALAXY →' : 'PLAY →';
        this.ui.playButton.dataset.analyticsId = this.hasSession ? 'gameNewRun' : 'gameStart';
        this.text('saveNote', this.hasSession ? `Local galaxy saved. ${this.ownedCount()} planets · ${Math.floor(this.world.player.cargo)} cargo. The live world keeps running while this menu is open.`
            : this.store.expired ? 'Your 30-second reconnect window expired. Play starts a fresh galaxy.'
                : 'Your home is protected. Hack a neutral relay to claim your first planet.');
    }

    // Ask before replacing the current galaxy and preserve its summary for later review.
    requestNew() {
        if (this.connection) return this.joinMultiplayer();
        if (!this.hasSession) return this.newSession();
        this.confirmKind = 'reset';
        this.confirmReturn = this.mode;
        this.text('confirmTitle', 'Start a new galaxy?');
        this.text('confirmDescription', 'This releases your current territory and starts at home with zero cargo. A summary remains in Flight Records.');
        this.showScreen('confirm');
    }

    // Start a fresh local session with one protected home and no simulated opponents.
    newSession() {
        if (this.connection) return this.joinMultiplayer();
        if (this.hasSession) this.emit('reset');
        this.world = this.store.start();
        this.lastDisplayedCargo = Math.floor(this.world.player.cargo);
        this.lastEvent = 0;
        this.dockErrorUntil = 0;
        this.fuelDamageAmount = 0;
        this.fuelDamageUntil = 0;
        this.hasSession = true;
        this.running = true;
        this.aimSet = false;
        this.aimCursor = null;
        this.accumulator = 0;
        this.lastFrame = null;
        this.showScreen('flight');
        this.emit('joined');
        this.drainEvents();
        this.ui.chatMessages.replaceChildren();
        this.ui.chatForm.hidden = true;
        this.ui.chatInput.value = '';
        this.message('Follow the flashing arrow to MOON RELAY. Press E to dock, then hack it.', 12);
        this.updateHud({});
        this.checkpoint();
    }

    // Resume the saved live world without retaining any held inputs from a previous page.
    continueSession() {
        if (this.connection && !this.connection.connected) return this.joinMultiplayer();
        if (!this.hasSession) return this.newSession();
        this.running = true;
        this.lastFrame = null;
        this.showScreen('flight');
        this.emit('continued');
        this.updateHud({});
    }

    // Confirm self-destruction separately from replacing the entire galaxy.
    confirmAction() {
        if (this.confirmKind === 'selfDestruct') {
            this.emit('selfDestruct');
            if (this.connection) this.connection.action('selfDestruct').then(result => { if (!result.ok) this.message(result.reason); });
            else killPlayer(this.world, 'Self-destructed.');
            this.showScreen('flight');
            this.drainEvents();
            this.checkpoint();
        } else this.newSession();
    }

    // Keep a fuel-empty ship coasting until the pilot explicitly accepts the cargo-loss tradeoff.
    requestSelfDestruct() {
        this.confirmKind = 'selfDestruct';
        this.confirmReturn = 'flight';
        this.text('confirmTitle', 'Self-destruct and return home?');
        this.text('confirmDescription', 'Your carried cargo will float here for collection. You respawn at home with a full tank; owned planets stay yours.');
        this.showScreen('confirm');
    }

    // Select either a relay or landing pad, with owned planets defaulting to their useful service pad.
    chooseTarget(bodyId, type = null) {
        if (!bodies.some(body => body.id === bodyId)) return;
        const chosenType = type || (this.world.planets[bodyId].owner === this.world.player.id ? 'planet' : 'relay');
        if (this.connection) this.connection.action('target', { bodyId, targetType: chosenType });
        else setTarget(this.world, bodyId, chosenType);
        this.emit('mapTarget');
        this.updateHud(this.activeInput || {});
        this.checkpoint();
    }

    // Attach or detach only through the rule engine's shared docking checks.
    async interact() {
        if (this.mode !== 'flight') return;
        this.clearInput();
        const before = { ...this.world.player };
        const result = this.connection ? await this.connection.action('interact') : interact(this.world);
        if (result?.ok === false) {
            this.text('dockError', result.reason || 'UNAVAILABLE');
            this.dockErrorUntil = this.world.elapsed + 4;
            this.ui.dockError.hidden = false;
        } else {
            this.dockErrorUntil = 0;
            this.ui.dockError.hidden = true;
            if (!before.docked && this.world.player.docked) this.renderer.beginDocking?.(before, this.world.player);
        }
        this.drainEvents();
        this.updateHud({});
        this.checkpoint();
    }

    // Submit one intended digit without recording the raw keyboard input.
    async enterDigit(digit) {
        if (this.mode !== 'flight' || !this.world.hack || digit === undefined) return;
        let correct = Number(digit) === this.world.hack.digit;
        if (this.connection) {
            const challengeId = this.world.hack.challengeId;
            const result = await this.connection.action('digit', { digit: Number(digit), challengeId });
            correct = result.ok;
        } else {
            hackDigit(this.world, String(digit));
            hackDigit(this.world, null);
        }
        // Flash the keyboard cue without moving it or changing capture rules.
        const color = correct ? '#8cdeb0' : '#ff6666';
        this.ui.digitButton.animate?.([
            { backgroundColor: color, borderColor: color, color: '#071018' },
            { backgroundColor: '#22343e', borderColor: '#71878b', color: '#edb368' }
        ], { duration: 220, easing: 'ease-out' });
        this.drainEvents();
        this.updateHud(this.activeInput || {});
        this.checkpoint();
    }

    // Spend carried cargo only on the planet belonging to the currently attached owned relay.
    async upgrade() {
        if (this.mode !== 'flight') return;
        const result = this.connection ? await this.connection.action('planetUpgrade') : upgradePlanet(this.world);
        if (result?.ok === false) {
            this.emit('upgradeRejected');
            this.message(result.reason || 'More cargo is needed for this upgrade.');
        }
        this.drainEvents();
        this.updateHud({});
        this.checkpoint();
    }

    // Combine keyboard and captured pointers, logging only control transitions and firing intervals.
    currentInput() {
        const actions = new Set(this.pointers.values());
        for (const key of this.keys) {
            if (keyControls[key]) actions.add(keyControls[key]);
            if (key.startsWith('button:') && this.page.activeElement?.dataset.control) actions.add(this.page.activeElement.dataset.control);
        }
        for (const action of actions) if (!this.loggedActions.has(action)) this.log('controlPress', action);
        for (const action of this.loggedActions) if (!actions.has(action)) this.log('controlRelease', action);
        this.loggedActions = actions;
        for (const button of this.heldButtons) button.classList.toggle('is-held', actions.has(button.dataset.control));
        const player = this.world.player;
        const fire = actions.has('fire') && !player.docked && !player.deadUntil;
        if (fire !== this.firing) {
            if (fire) this.shotStartCount = this.world.stats.shots;
            this.emit(fire ? 'shotStarted' : 'shotEnded', fire ? {} : { amount: Math.max(0, this.world.stats.shots - (this.shotStartCount || 0)) });
        }
        this.firing = fire;
        if (this.aimCursor) {
            const bounds = this.ui.flightCanvas.getBoundingClientRect();
            player.aimAngle = this.renderer.aimAt(bounds.left + this.aimCursor.x * bounds.width,
                bounds.top + this.aimCursor.y * bounds.height, player);
        }
        if (!this.aimSet) player.aimAngle = player.angle - Math.PI / 2;
        return { burn: actions.has('burn'), rotate: 0, aimCursor: this.aimCursor,
            rcsX: Number(actions.has('rcsRight')) - Number(actions.has('rcsLeft')),
            rcsY: Number(actions.has('rcsDown')) - Number(actions.has('rcsUp')), fire, aimAngle: player.aimAngle };
    }

    // Count ownership from world state rather than relying on capture events that can be replayed.
    ownedCount() {
        return Object.values(this.world.planets).filter(planet => planet.owner === this.world.player.id).length;
    }

    // Show temporary flight feedback without moving the camera or blocking the controls.
    message(text, duration = 5) {
        this.text('flightMessage', text);
        this.ui.flightMessage.hidden = false;
        this.messageUntil = this.world.elapsed + duration;
    }

    // Add bounded, text-only local chat; message content is never sent to tracking or persistence.
    appendChat(text, announcement = false, sender = {}) {
        const row = this.page.createElement('p');
        row.style.color = sender.color || this.world.player.color;
        const label = sender.label || this.world.player.label || 'Pilot';
        row.textContent = announcement ? `${label} conquered ${text}` : `${label}: ${text}`;
        const messages = this.ui.chatMessages;
        messages.append(row);
        if (messages.children.length > 40) messages.replaceChildren(...Array.from(messages.children).slice(-40));
        messages.scrollTop = messages.scrollHeight;
    }

    // Project engine outcomes into user feedback and the remote event log once per event sequence.
    drainEvents() {
        for (const event of this.world.events) {
            const sequence = event.seq ?? event.sequence;
            if (!Number.isFinite(sequence) || sequence <= this.lastEvent) continue;
            this.lastEvent = sequence;
            if (event.type === 'damaged' && Number.isFinite(event.amount) && event.amount > 0) {
                const now = this.now();
                const pendingDamage = now < this.fuelDamageUntil ? this.fuelDamageAmount : 0;
                this.fuelDamageAmount = Math.min(100, pendingDamage + event.amount);
                this.fuelDamageUntil = now + 400;
                this.renderer.damageBurst?.(this.world, event);
                this.animateFuelDamage(event.amount, event.fuel);
            }
            if (event.type === 'cargoPickedUp') this.animateCargoCollection();
            const action = eventActions[event.type];
            if (action) {
                const amount = event.type === 'hackProgress' && this.world.hack
                    ? Math.max(5, Math.floor(this.world.hack.progress / this.world.hack.required * 20) * 5)
                    : Math.min(1000000, event.amount || 0);
                this.emit(action, { amount, planetLevel: event.bodyId ? this.world.planets[event.bodyId]?.level || 0 : 0,
                    ...(event.type === 'damaged' ? { fuel: event.fuel } : {}) });
            }
            const body = bodies.find(item => item.id === event.bodyId);
            if (event.type === 'captured') {
                this.message(`${body?.name || 'Planet'} captured. Collect its orbiting cargo pods and land to refuel.`, 8);
                this.appendChat(body?.name || 'Planet', true);
                this.renderer.beginCapture?.(event.bodyId, this.world.player.color);
            }
            if (event.type === 'upgraded') this.message(`${body?.name || 'Planet'} defenses upgraded.`, 5);
            if (event.type === 'died') {
                this.clearInput();
                this.message(event.previousTier > 0 ? `ROCKET UPGRADE LOST: TIER ${event.previousTier} → TIER ${event.rocketTier}` : event.reason || 'Rocket destroyed. Cargo dropped.', 5);
            }
            if (event.type === 'respawned') this.message('Respawned at home. Territory retained; tank full.', 6);
        }
    }

    // Scatter brief sparks from the newly shortened fuel edge when damage lands.
    animateFuelDamage(amount, remainingFuel) {
        if (this.browserWindow.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
        const gauge = this.ui.fuelGauge;
        const width = gauge.clientWidth - 6;
        const fuel = Number.isFinite(remainingFuel) ? remainingFuel : this.world.player.fuel;
        const edge = 3 + Math.max(0, Math.min(100, fuel)) / 100 * width;
        const count = Math.min(14, 6 + Math.ceil(amount / 4));
        for (let index = 0; index < count; index++) {
            const particle = this.page.createElement('i');
            particle.className = 'fuel-damage-particle';
            particle.setAttribute('aria-hidden', 'true');
            particle.style.left = `${edge}px`;
            particle.style.top = `${3 + Math.random() * Math.max(1, gauge.clientHeight - 10)}px`;
            gauge.append(particle);
            const driftX = -(8 + Math.random() * 24);
            const driftY = (Math.random() - 0.5) * 13;
            const flight = particle.animate([
                { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                { transform: `translate(${driftX}px, ${driftY}px) scale(.2)`, opacity: 0 }
            ], { duration: 300 + Math.random() * 220, easing: 'ease-out' });
            flight.finished.then(() => particle.remove()).catch(() => particle.remove());
        }
    }

    // Fly the collected cargo marker from the rocket to the cargo readout.
    animateCargoCollection() {
        if (this.mode !== 'flight' || typeof this.ui.cargoIcon.animate !== 'function') return;
        const rocket = this.renderer.screen(this.world.player.x, this.world.player.y);
        const canvasRect = this.ui.flightCanvas.getBoundingClientRect();
        const targetRect = this.ui.cargoIcon.getBoundingClientRect();
        const viewport = this.ui.flightCanvas.parentElement;
        const viewportRect = viewport.getBoundingClientRect();
        const startX = canvasRect.left + rocket.x / this.ui.flightCanvas.width * canvasRect.width - viewportRect.left;
        const startY = canvasRect.top + rocket.y / this.ui.flightCanvas.height * canvasRect.height - viewportRect.top;
        const endX = targetRect.left + targetRect.width / 2 - viewportRect.left;
        const endY = targetRect.top + targetRect.height / 2 - viewportRect.top;
        const marker = this.ui.cargoIcon.cloneNode(true);
        marker.removeAttribute('id');
        marker.classList.add('cargo-flight-icon');
        marker.setAttribute('aria-hidden', 'true');
        marker.style.left = `${startX - 13}px`;
        marker.style.top = `${startY - 13}px`;
        viewport.append(marker);
        const flight = marker.animate([
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
            { transform: `translate(${(endX - startX) * 0.65}px, ${(endY - startY) * 0.65}px) scale(1.25)`, opacity: 1, offset: 0.62 },
            { transform: `translate(${endX - startX}px, ${endY - startY}px) scale(.7)`, opacity: 0.25 }
        ], { duration: 680, easing: 'cubic-bezier(.2,.7,.25,1)' });
        flight.finished.then(() => {
            marker.remove();
            const counter = this.ui.cargoValue.closest('.cargo-count');
            counter.classList.remove('is-arriving');
            void counter.offsetWidth;
            counter.classList.add('is-arriving');
        }).catch(() => marker.remove());
    }

    // Update the cargo number without enlarging it; the icon carries the pickup flash.
    updateCargoDisplay(cargo) {
        const amount = Math.floor(cargo);
        this.lastDisplayedCargo = amount;
        this.text('cargoValue', amount);
    }

    // Keep navigation and interaction prompts derived from the same world rules as flight.
    updateHud(input = {}) {
        const world = this.world;
        const player = world.player;
        const target = targetFor(world);
        const allowed = player.fuel > 0 && !player.deadUntil && !player.docked;
        const aimError = Number.isFinite(input.aimAngle) ? Math.atan2(
            Math.sin(input.aimAngle + Math.PI / 2 - player.angle),
            Math.cos(input.aimAngle + Math.PI / 2 - player.angle)) : 0;
        const turning = Number.isFinite(input.aimAngle)
            ? Number(Math.abs(aimError) > .001 || Math.abs(player.rotationVelocity) > .001) : Math.abs(input.rotate || 0);
        const draw = allowed ? (input.burn ? tuning.mainFuelRate : 0)
            + tuning.rcsFuelRate * (Math.abs(input.rcsX || 0) + Math.abs(input.rcsY || 0))
            + tuning.rotationFuelRate * turning : 0;
        const maximum = tuning.mainFuelRate + tuning.rcsFuelRate * 2 + tuning.rotationFuelRate;
        const usage = Math.round(draw * ((player.rocketTier || 0) >= 3 ? .8 : 1) / maximum * 100);
        const damage = this.now() < this.fuelDamageUntil ? this.fuelDamageAmount : 0;
        const usageShare = player.fuel > 0 ? Math.min(100, usage * 0.25 / player.fuel * 100) : 0;
        const damageShare = player.fuel > 0 ? Math.min(100, damage / player.fuel * 100) : 0;
        this.ui.fuelUsageFill.style.clipPath = `inset(0 0 0 ${100 - usageShare}%)`;
        this.ui.fuelDamageFill.style.clipPath = `inset(0 0 0 ${100 - damageShare}%)`;
        this.ui.fuelGauge.setAttribute('aria-valuetext', `${player.fuel.toFixed(1)}% fuel remaining; current fuel use ${usage}%; recent damage ${damage.toFixed(1)}%`);
        this.text('fuelValue', `${player.fuel.toFixed(1)}%`);
        this.ui.fuelFill.style.width = `${player.fuel}%`;
        this.ui.fuelGauge.setAttribute('aria-valuenow', player.fuel.toFixed(1));
        this.ui.flightStatus.classList.toggle('is-low', player.fuel < 20);
        this.updateCargoDisplay(player.cargo);
        this.ui.cargoPrompt.hidden = this.mode !== 'flight' || player.cargo > 0;
        this.text('objectiveKind', target.type === 'planet' ? 'LANDING PAD / COLLECT & REFUEL' : 'RELAY / HACK OR UPGRADE');
        this.text('objectiveName', target.name.toUpperCase());
        this.text('objectiveDistance', formatDistance(Math.hypot(player.x - target.x, player.y - target.y)));
        const serviced = player.landedOn && world.planets[player.landedOn]?.owner === player.id;
        this.ui.fuelPrompt.hidden = this.mode !== 'flight' || player.fuel > 0 || Boolean(player.deadUntil) || Boolean(serviced);
        this.ui.respawnNotice.hidden = !player.deadUntil;
        if (player.deadUntil) this.text('respawnNotice', `${player.lastLostTier ? `ROCKET UPGRADE LOST: TIER ${player.lastLostTier} → TIER ${player.rocketTier} · ` : 'ROCKET LOST · '}RESPAWN IN ${Math.max(0, player.deadUntil - world.elapsed).toFixed(1)}s`);
        this.ui.serverChat.style.bottom = `${(this.ui.flightStatus.offsetHeight || 86) + 24}px`;
        this.updateDocking();
        if (world.elapsed > this.messageUntil) this.ui.flightMessage.hidden = true;
        this.ui.flightCanvas.setAttribute('aria-label', `Conquest flight. Target ${target.name}, ${formatDistance(Math.hypot(player.x - target.x, player.y - target.y))} away. ${this.ownedCount()} planets owned. ${Math.floor(player.cargo)} cargo.`);
    }

    // Show approach checks, digit input, or one upgrade action as the current relay interaction requires.
    updateDocking() {
        const world = this.world;
        const player = world.player;
        const body = player.docked ? bodies.find(body => body.id === player.docked) : nearestRelay(player, world);
        const checks = dockingStatus(world, body.id);
        const showError = this.world.elapsed < (this.dockErrorUntil || 0);
        this.ui.dockError.hidden = !showError;
        const visible = this.mode === 'flight' && !player.deadUntil && (player.docked || checks.distance <= tuning.dockingAssistDistance || showError);
        const wasHidden = this.ui.dockDialog.hidden;
        this.ui.dockDialog.hidden = !visible;
        // Avoid placing the general controls hint underneath the docking prompt.
        this.ui.controlsHint.hidden = visible || this.mode !== 'flight'
            || !this.ui.controlsHint.querySelector('.controls-hint-line:not([hidden])');
        if (visible !== !wasHidden) this.log('dockingChecklist', 'gameDock', { open: Boolean(visible) });
        if (!visible) {
            this.dockDialogMotion = null;
            return;
        }
        // Anchor the interaction beside its station and keep the full prompt on screen.
        const canvas = this.ui.flightCanvas;
        const bounds = canvas.getBoundingClientRect();
        const station = stationFor(body);
        const point = this.renderer.screen(station.x + 70, station.y);
        const stationX = point.x * bounds.width / canvas.width;
        const stationY = point.y * bounds.height / canvas.height;
        this.ui.dockDialog.classList.toggle('station-dock', !player.docked);
        const panelWidth = this.ui.dockDialog.offsetWidth || 180;
        const panelHeight = this.ui.dockDialog.offsetHeight || 50;
        this.ui.dockDialog.style.left = `${Math.max(6, Math.min(bounds.width - panelWidth - 6, stationX))}px`;
        this.ui.dockDialog.style.top = `${Math.max(6, Math.min(bounds.height - panelHeight - 6, stationY - panelHeight / 2))}px`;
        this.ui.dockDialog.classList.toggle('is-hacking', Boolean(world.hack));
        this.text('dockTitle', world.hack ? 'CAPTURE PLANET' : `${body.name} relay`);
        this.text('dockState', player.docked ? world.hack ? 'HACKING' : 'OWNED' : checks.ready ? 'READY' : 'ALIGNING');
        this.ui.dockChecks.hidden = true;
        this.ui.hackPanel.hidden = !world.hack;
        this.ui.upgradePanel.hidden = !player.docked || Boolean(world.hack);
        const speedReady = checks.speed <= tuning.dockingSpeed;
        const angleReady = checks.angle <= tuning.dockingAngle;
        this.text('dockSpeedCheck', speedReady ? 'SPEED OK' : 'SLOW DOWN');
        this.ui.dockSpeedCheck.classList.toggle('is-ready', speedReady);
        this.ui.dockSpeedCheck.classList.toggle('is-warning', !speedReady);
        const angleDegrees = player.angle * 180 / Math.PI;
        this.ui.dockCurrentRocket.setAttribute('transform', `rotate(${angleDegrees} 30 30)`);
        this.ui.dockOrientation.classList.toggle('is-aligned', angleReady);
        this.text('dockAngleValue', angleReady ? 'ALIGNMENT OK' : 'ALIGN UPRIGHT');
        this.ui.dockOrientationGraph.setAttribute('aria-label', angleReady
            ? 'Rocket aligned upright. Faint green rocket shows the upright target.'
            : 'Rocket not aligned. Faint green rocket shows the upright target; red rocket shows your current heading.');
        const speed = Math.hypot(player.vx, player.vy);
        this.text('dockCurrentSpeed', `${speed.toFixed(1)} m/s`);
        this.text('dockTargetSpeed', `${tuning.dockingSpeed.toFixed(1)} m/s`);
        this.ui.dockVelocity.classList.toggle('is-ready', speedReady);
        this.ui.interactButton.disabled = false;
        this.ui.interactButton.classList.toggle('is-ready', !player.docked && checks.ready);
        this.text('interactLabel', player.docked ? 'to Detach' : 'to dock');
        if (world.hack) {
            const hack = world.hack;
            const progress = hack.progress ?? hack.count ?? 0;
            const required = hack.required ?? hack.total ?? 1;
            this.text('digitButton', String(hack.digit));
            this.ui.digitButton.setAttribute('aria-label', `Enter hacking digit ${hack.digit}`);
            this.ui.hackFill.style.width = `${progress / required * 100}%`;
            this.ui.hackGauge.setAttribute('aria-valuenow', Math.round(progress / required * 100));
        } else if (player.docked) {
            const upgrade = nextUpgrade(world);
            const rocket = nextRocketUpgrade(world);
            this.ui.rocketUpgradeButton.disabled = !rocket.affordable;
            this.text('rocketUpgradeLabel', `ROCKET ${rocket.tier}/4`);
            this.text('rocketUpgradeName', rocket.name);
            this.text('rocketUpgradeCostValue', rocket.cost);
            this.ui.rocketUpgradeCost.hidden = !rocket.available;
            this.ui.rocketUpgradeButton.setAttribute('aria-label', `Rocket upgrade ${rocket.name}, ${rocket.cost} cargo`);
            this.text('upgradeDescription', !upgrade?.available ? upgrade?.reason || 'No upgrades available.' : upgrade.description);
            this.text('planetUpgradeLabel', upgrade?.available ? 'PLANET' : 'PLANET / MAX');
            this.ui.planetUpgradeCost.hidden = !upgrade?.available;
            this.text('planetUpgradeCostValue', upgrade?.cost || 0);
            this.ui.upgradeButton.setAttribute('aria-label', upgrade?.available
                ? `Upgrade planet for ${upgrade.cost} cargo` : 'Planet fully upgraded');
            this.text('upgradeName', upgrade?.available ? upgrade.name : 'FULLY UPGRADED');
            this.ui.upgradeButton.disabled = !upgrade?.available || player.cargo < upgrade.cost;
        }
    }

    // Join the configured shared room without changing any remote server setup.
    async joinMultiplayer() {
        this.clearInput();
        this.text('saveNote', 'Connecting to the shared galaxy…');
        try {
            await this.connection.connect();
            this.running = true; this.showScreen('flight');
        } catch (error) { this.text('saveNote', error.message); }
    }

    // Keep the renderer's world identity stable while replacing authoritative snapshot fields.
    receiveWorld(world, details = {}) {
        if (!world?.player || !world.planets) return;
        Object.assign(this.world, world);
        this.hasSession = true;
        if (details.joined) {
            this.dockErrorUntil = 0; this.ui.chatForm.hidden = true; this.ui.chatInput.value = '';
            this.lastEvent = world.eventCounter;
            this.running = true; this.lastFrame = null;
            this.showScreen('flight');
            this.emit(details.resumed ? 'continued' : 'joined');
            this.message(details.resumed ? 'Reconnected to your galaxy.' : 'Follow the flashing relay marker. Capture planets to gain cargo.', 8);
            this.ui.chatMessages.replaceChildren();
        }
        this.updateHud(this.activeInput || {});
    }

    // Buy one rocket tier using the same server-priced action as the R shortcut.
    async rocketUpgrade() {
        if (this.mode !== 'flight') return;
        const result = this.connection ? await this.connection.action('rocketUpgrade') : upgradeRocket(this.world);
        if (!result.ok) { this.emit('upgradeRejected'); this.message(result.reason); }
        else this.message(result.reason || 'Rocket upgraded.');
        this.drainEvents(); this.updateHud({}); this.checkpoint();
    }

    // Save at most once per second plus significant actions; renderer-only state never enters storage.
    checkpoint() {
        if (this.hasSession && !this.connection) this.store.save(this.world, this.lastEvent);
    }

    // Store a departing tab once and require an explicit Continue on its return.
    suspend() {
        if (this.connection) {
            this.clearInput(); this.connection.suspend(); this.running = false;
            this.lastHiddenAt = this.now(); return;
        }
        if (!this.hasSession || this.lastHiddenAt !== null) return;
        this.clearInput();
        if (this.world.hack) {
            // Detach through the engine so a refreshed page cannot preserve a partly completed hack.
            interact(this.world);
            this.drainEvents();
        }
        this.lastHiddenAt = this.now();
        this.running = false;
        this.lastFrame = null;
        this.emit('suspended');
        this.checkpoint();
        this.showScreen('menu', false);
    }

    // Recover short interruptions with real coasting/production, or release the expired local galaxy.
    returnFromBackground() {
        if (this.connection) {
            this.lastHiddenAt = null;
            if (this.connection.token) this.joinMultiplayer();
            return;
        }
        if (this.lastHiddenAt === null) return;
        const restored = this.store.restore();
        this.lastHiddenAt = null;
        this.lastFrame = null;
        this.running = false;
        if (restored) {
            this.world = restored.world;
            this.lastEvent = restored.lastEvent;
            this.hasSession = true;
            this.emit('continued');
            this.drainEvents();
        } else {
            this.emit('expired');
            this.world = createWorld();
            this.hasSession = false;
            this.lastEvent = 0;
        }
        this.showScreen('menu', false);
        this.updateHud({});
    }

    // Render conquest summaries and retain access to older finite-journey results without migrating them.
    renderRecords() {
        const list = this.ui.recordsList;
        list.replaceChildren();
        const heading = this.page.createElement('h3');
        heading.textContent = this.connection ? 'SHARED GALAXY' : 'LOCAL CONQUEST';
        list.append(heading);
        const records = this.store.records();
        if (this.hasSession) records.unshift(this.store.summarize(this.world));
        for (const record of records) {
            const item = this.page.createElement('p');
            item.className = 'record';
            item.textContent = `${formatTime(record.elapsed)} · ${record.owned} planets · ${record.captures} captures · ${record.deaths} deaths · ${Math.floor(record.cargo)} cargo · ${record.fuel.toFixed(1)}% fuel`;
            list.append(item);
        }
        if (!records.length) {
            const empty = this.page.createElement('p'); empty.textContent = 'No conquest sessions yet.'; list.append(empty);
        }
        try {
            const legacy = JSON.parse(this.browserWindow.localStorage?.getItem('orbitalFreight.v1') || 'null');
            const oldRecords = Array.isArray(legacy?.history) ? legacy.history.slice(0, 100) : [];
            if (oldRecords.length) {
                const title = this.page.createElement('h3'); title.textContent = 'EARLIER STORY FLIGHTS'; list.append(title);
                for (const record of oldRecords) {
                    if (!Number.isFinite(record.elapsed) || !Number.isFinite(record.fuel)) continue;
                    const item = this.page.createElement('p'); item.className = 'record';
                    item.textContent = `${formatTime(record.elapsed)} · ${String(record.status).slice(0, 20)} · ${record.fuel.toFixed(1)}% fuel`;
                    list.append(item);
                }
            }
        } catch { /* Older corrupt records never prevent the new local game from working. */ }
    }

    // Advance a bounded deterministic simulation while menus stay live and hidden tabs use reconnect rules.
    frame(now) {
        const dt = this.lastFrame === null ? 0 : Math.min(.1, Math.max(0, (now - this.lastFrame) / 1000));
        this.lastFrame = now;
        const input = this.mode === 'flight' && !this.world.player.deadUntil ? this.currentInput() : {};
        this.activeInput = input;
        if (this.connection && this.running && this.page.visibilityState !== 'hidden') {
            this.connection.input(input, now);
        } else if (this.running && this.page.visibilityState !== 'hidden') {
            this.accumulator += dt;
            while (this.accumulator >= tuning.fixedStep) {
                stepWorld(this.world, input, tuning.fixedStep);
                this.accumulator -= tuning.fixedStep;
            }
            this.drainEvents();
            this.saveElapsed += dt;
            if (this.saveElapsed >= 1) { this.checkpoint(); this.saveElapsed = 0; }
        }
        this.hudElapsed += dt;
        if (this.hudElapsed >= .08 || dt === 0) {
            this.updateHud(input);
            this.hudElapsed = 0;
        }
        this.renderer.draw(this.world, input, !this.hasSession, dt || 1 / 60);
        if (this.animating) this.browserWindow.requestAnimationFrame(time => this.frame(time));
    }
}

// Load gameplay independently from analytics so a blocked external SDK cannot prevent local play.
if (typeof document !== 'undefined' && document.getElementById('flightCanvas')) {
    try { new ConquestApp(); }
    catch (error) {
        console.error('[orbital conquest] Startup failed.', error);
        const warning = document.getElementById('storageWarning');
        warning.textContent = 'The galaxy could not start. Reload in a current browser with JavaScript and canvas enabled.';
        warning.hidden = false;
    }
}
