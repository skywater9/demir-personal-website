import { gameServerUrl } from './multiplayerConfig.mjs?v=20261118-multiplayer';

// Resolve an explicit public endpoint, a local testing URL, or the class server's own hosted frontend.
export function multiplayerUrl(page, browserWindow) {
    const location = browserWindow?.location;
    const configured = page?.querySelector?.('meta[name="game-server"]')?.content;
    const requested = new URLSearchParams(location?.search || '').get('server');
    const value = requested || (configured === 'same-origin' ? location?.origin : configured) || gameServerUrl;
    if (!value) return '';
    const url = new URL(value);
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid game server URL.');
    if (url.protocol === 'http:' || url.protocol === 'ws:') {
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use secure WebSockets for public gameplay.');
        url.protocol = 'ws:';
    } else url.protocol = 'wss:';
    if (url.pathname === '/') url.pathname = '/game';
    url.search = ''; url.hash = '';
    return url.href;
}

// Keep credentials private and send only bounded controls and requested actions to the shared server.
export class MultiplayerClient {
    // Inject transport and callbacks so reconnect and command behavior can be checked independently.
    constructor({ url, storage, WebSocketClass = globalThis.WebSocket, onWorld = () => {}, onEvent = () => {},
        onChat = () => {}, onAnnouncement = () => {}, onCapture = () => {}, onDeath = () => {}, onStatus = () => {} }) {
        this.url = url; this.storage = storage; this.WebSocketClass = WebSocketClass;
        this.onWorld = onWorld; this.onEvent = onEvent; this.onChat = onChat; this.onAnnouncement = onAnnouncement; this.onCapture = onCapture; this.onDeath = onDeath; this.onStatus = onStatus;
        this.pending = new Map(); this.sequence = 0; this.actionId = 0; this.connected = false;
        this.connecting = null; this.socket = null; this.stopped = false; this.lastInputAt = -Infinity;
        this.key = `orbital.multiplayer.${new URL(url).origin}`;
        try { this.token = storage?.getItem(this.key) || ''; } catch { this.token = ''; }
    }

    // Open one connection, authenticate with an opaque token, and restore an unexpired server reservation.
    connect() {
        if (this.connected) return Promise.resolve();
        if (this.connecting) return this.connecting;
        this.stopped = false;
        this.connecting = new Promise((resolve, reject) => {
            const socket = this.socket = new this.WebSocketClass(this.url);
            let welcomed = false;
            const timeout = setTimeout(() => { socket.close(); reject(new Error('Server did not respond. Try again.')); }, 8000);
            socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'hello', token: this.token })));
            socket.addEventListener('message', event => {
                if (this.socket !== socket) return;
                let message;
                try { message = JSON.parse(event.data); } catch { return; }
                if (message.type === 'welcome') {
                    welcomed = true; clearTimeout(timeout);
                    this.connected = true; this.sequence = 0; this.token = message.token;
                    this.actionId = Math.max(this.actionId, message.lastActionId || 0);
                    let storageUnavailable = false;
                    try { this.storage?.setItem(this.key, this.token); } catch { storageUnavailable = true; }
                    this.onWorld(message.world, { joined: true, resumed: message.resumed });
                    this.onStatus('connected');
                    if (storageUnavailable) this.onStatus('Reconnect storage unavailable. Keep this tab open to retain your pilot.');
                    resolve();
                } else if (message.type === 'state' && message.world) this.onWorld(message.world);
                else if (message.type === 'event') this.onEvent(message.event);
                else if (message.type === 'chat') this.onChat(message);
                else if (message.type === 'announcement') this.onAnnouncement(message);
                else if (message.type === 'capture') this.onCapture(message);
                else if (message.type === 'death') this.onDeath(message);
                else if (message.type === 'result') {
                    if (message.world) this.onWorld(message.world);
                    const pending = this.pending.get(message.actionId);
                    if (pending) { clearTimeout(pending.timeout); this.pending.delete(message.actionId); pending.resolve(message.result); }
                } else if (message.type === 'unavailable') { this.stopped = true; clearTimeout(timeout); reject(new Error(message.reason)); }
                else if (message.type === 'error') this.onStatus(message.reason || 'Server rejected input.');
                else if (message.type === 'left') socket.close();
            });
            socket.addEventListener('error', () => { if (!welcomed) reject(new Error('Cannot reach the game server.')); });
            socket.addEventListener('close', event => {
                if (this.socket !== socket) { clearTimeout(timeout); return; }
                clearTimeout(timeout); this.connected = false;
                for (const pending of this.pending.values()) {
                    clearTimeout(pending.timeout); pending.resolve({ ok: false, reason: 'Connection lost.' });
                }
                this.pending.clear();
                if (event.code === 1000 && event.reason === 'Replaced by a new connection.') {
                    this.stopped = true; this.token = '';
                    try { this.storage?.removeItem(this.key); } catch { /* The stale in-memory credential is already cleared. */ }
                    this.onStatus('replaced');
                }
                if (!welcomed) reject(new Error('Connection closed before joining.'));
                if (!this.stopped) {
                    this.onStatus('reconnecting');
                    setTimeout(() => { if (!this.stopped) this.connect().catch(() => {}); }, 1000);
                }
            });
        }).finally(() => { this.connecting = null; });
        return this.connecting;
    }

    // Keep message sequencing and buffer bounds independent from the game's presentation frame rate.
    send(message) {
        if (!this.connected || this.socket?.readyState !== 1 || this.socket.bufferedAmount > 65536) return false;
        this.socket.send(JSON.stringify({ ...message, sequence: ++this.sequence })); return true;
    }

    // Send controls at 20 Hz while the page is active; missing input expires server-side.
    input(value, now) {
        if (now - this.lastInputAt < 50) return;
        this.lastInputAt = now;
        this.send({ type: 'input', input: { burn: Boolean(value.burn), fire: Boolean(value.fire),
            rcsX: value.rcsX || 0, rcsY: Math.max(0, value.rcsY || 0), aimAngle: Number.isFinite(value.aimAngle) ? value.aimAngle : null } });
    }

    // Resolve each requested action once, only after the server responds to its unique command ID.
    action(action, details = {}) {
        const actionId = ++this.actionId;
        return new Promise(resolve => {
            const timeout = setTimeout(() => { this.pending.delete(actionId); resolve({ ok: false, reason: 'Server response timed out.' }); }, 5000);
            this.pending.set(actionId, { resolve, timeout });
            if (!this.send({ type: 'action', action, actionId, ...details })) {
                clearTimeout(timeout); this.pending.delete(actionId); resolve({ ok: false, reason: 'Not connected.' });
            }
        });
    }

    // Room chat is transient and never routed through analytics or local game snapshots.
    chat(text) { return this.send({ type: 'chat', text: text.slice(0, 160) }); }

    // Explicitly release territory and forget the reconnect credential without replacing the shared world.
    leave() {
        this.stopped = true; this.send({ type: 'leave' }); this.token = '';
        this.connected = false;
        const socket = this.socket;
        try { this.storage?.removeItem(this.key); } catch { /* Memory-only credentials are already cleared. */ }
        setTimeout(() => socket?.close(), 1000);
    }

    // A hidden or closing page disconnects, invoking the server's 30-second reservation window.
    suspend() { this.stopped = true; this.connected = false; this.socket?.close(); }
}
