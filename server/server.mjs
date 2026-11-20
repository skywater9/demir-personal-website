import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { bodies, territoryBodies } from '../public/scripts/conquestPhysics.mjs';
import { GameRoom, playerLimit } from './room.mjs';
import { GalaxyStore } from './persistence.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(projectRoot, 'public');
const mimeTypes = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const emptyInput = { burn: false, fire: false, rcsX: 0, rcsY: 0, aimAngle: 0 };

// Build a plain-HTTP service; Caddy supplies public TLS, redirects, WebSocket forwarding, and CORS.
export async function createGameServer({ dataFile = resolve(projectRoot, 'server/.runtime/galaxy.json'),
    allowedOrigins = ['https://demir-personal-website.web.app', 'https://demir-personal-website.firebaseapp.com'],
    now = () => Date.now(), timers = true } = {}) {
    dataFile = resolve(dataFile);
    if (dataFile === publicRoot || dataFile.startsWith(`${publicRoot}${sep}`)) throw new Error('Runtime data cannot be stored under public assets.');
    const store = new GalaxyStore(dataFile);
    const room = new GameRoom(await store.load(), now());
    const clients = new Map();
    let busy = false, closing = false, queued = 0, lastSave = now(), lastBroadcast = 0;
    let queue = Promise.resolve();
    const server = createServer(async (request, response) => {
        try {
            if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
            const pathname = decodeURIComponent(new URL(request.url, 'http://service.invalid').pathname);
            if (pathname === '/health') {
                response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                response.end(JSON.stringify({ ok: true, room: 'galaxy', rules: 'planet-services-v2', capacity: playerLimit, online: clients.size })); return;
            }
            const file = resolve(publicRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
            if (!file.startsWith(`${publicRoot}${sep}`) || !mimeTypes[extname(file)]) { response.writeHead(404); response.end(); return; }
            let body = await readFile(file);
            if (file === resolve(publicRoot, 'index.html')) body = Buffer.from(body.toString().replace('name="game-server" content=""', 'name="game-server" content="same-origin"'));
            response.writeHead(200, { 'Content-Type': `${mimeTypes[extname(file)]}; charset=utf-8`, 'Cache-Control': 'no-cache',
                'X-Content-Type-Options': 'nosniff' });
            response.end(request.method === 'HEAD' ? undefined : body);
        } catch { response.writeHead(404); response.end(); }
    });
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });

    // Bound output buffering so a slow client cannot accumulate unlimited shared-server memory.
    function send(socket, message) {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 131072) { socket.close(1013, 'Connection too slow.'); return; }
        socket.send(JSON.stringify(message));
    }

    // Commit durable state before publishing critical action outcomes.
    async function checkpoint() { await store.save(room.saved()); lastSave = now(); }

    // Deliver only this pilot's state and relevant remote ships, never reconnect credentials or hidden code.
    function snapshots() {
        for (const [id, client] of clients) send(client.socket, { type: 'state', world: room.view(id) });
        lastBroadcast = now();
    }

    // Broadcast server activity without retaining chat text, credentials, or personal information.
    function announce(text, color) {
        for (const client of clients.values()) send(client.socket, { type: 'announcement', text, color });
    }

    // Emit confirmed actor outcomes only to their owner, with public capture announcements separately.
    function events() {
        for (const event of room.world.events.splice(0)) {
            const actor = room.world.players[event.playerId];
            if (clients.has(event.playerId)) send(clients.get(event.playerId).socket, { type: 'event', event });
            if (event.type === 'turretDestroyed') {
                for (const [id, client] of clients) if (id !== event.playerId) {
                    send(client.socket, { type: 'event', event });
                }
            }
            if (event.type === 'turretDestroyed' && event.allTurretsDown === true) {
                const owner = room.world.planets[event.bodyId]?.owner;
                const ownerClient = clients.get(owner);
                if (ownerClient && owner !== event.playerId) {
                    const name = territoryBodies.find(body => body.id === event.bodyId)?.name || 'Your territory';
                    send(ownerClient.socket, { type: 'alert', bodyId: event.bodyId, kind: event.type,
                        text: `${name}: all turrets destroyed! Repairs unlock after their cooldowns.` });
                }
            }
            if (event.type === 'died' && actor) {
                const victim = actor.player;
                const attacker = room.world.players[event.attackerId]?.player;
                const text = attacker ? `${attacker.label}${event.source === 'turret' ? "'s turret" : ''} destroyed ${victim.label}.`
                    : event.reason?.startsWith('Self-destruct') ? `${victim.label} self-destructed.` : `${victim.label} was destroyed.`;
                announce(text, attacker?.color || victim.color);
                for (const [id, client] of clients) {
                    const viewer = room.world.players[id]?.player;
                    if (id !== victim.id && viewer && Math.hypot(viewer.x - victim.x, viewer.y - victim.y) <= 2400) {
                        send(client.socket, { type: 'death', id: victim.id, x: victim.x, y: victim.y });
                    }
                }
            }
            if (event.type === 'captured' && actor) {
                const planet = room.world.planets[event.bodyId];
                const previousOwner = clients.get(event.previousOwner);
                if (previousOwner && event.previousOwner !== event.playerId) {
                    const name = territoryBodies.find(body => body.id === event.bodyId)?.name || 'Your territory';
                    send(previousOwner.socket, { type: 'alert', kind: 'territoryLost', bodyId: event.bodyId,
                        text: `${actor.player.label} captured ${name}.` });
                }
                for (const client of clients.values()) send(client.socket, { type: 'capture', bodyId: event.bodyId,
                    label: actor.player.label, color: actor.player.color, owner: planet.owner });
            }
        }
        for (const notice of room.notices.splice(0)) announce(notice.text, notice.color);
    }

    // Stop accepting gameplay if durable saves fail, rather than confirming ownership that can be lost.
    function fail() {
        closing = true;
        console.error('[game] Durable state unavailable; service stopped accepting gameplay.');
        server.emit('gameFatal');
        for (const client of clients.values()) client.socket.close(1011, 'State unavailable. Reconnect shortly.');
        server.close();
        if (tickTimer) clearInterval(tickTimer);
        if (heartbeat) clearInterval(heartbeat);
    }

    // Serialize mutations across sockets; a failed operation cannot bypass the shared transaction order.
    function enqueue(action, priority = false) {
        if (queued >= 128 && !priority) return;
        queued++;
        queue = queue.then(async () => {
            if (closing) return;
            busy = true;
            try { await action(); } finally { busy = false; }
        }).catch(fail).finally(() => { queued--; });
    }

    // Reject unknown origins at handshake without adding proxy-owned CORS response headers.
    server.on('upgrade', (request, socket, head) => {
        const pathname = new URL(request.url, 'http://service.invalid').pathname;
        if (closing || queued >= 128 || sockets.clients.size >= 32 || pathname !== '/game' || !allowedOrigins.includes(request.headers.origin)) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
        }
        sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection));
    });
    sockets.on('connection', socket => {
        let playerId = null, joining = false, sequence = -1, count = 0, actionCount = 0, windowAt = now(), chatAt = 0;
        socket.alive = true;
        const joinDeadline = setTimeout(() => { if (!playerId) socket.close(1008, 'Join timed out.'); }, 5000);
        socket.on('pong', () => { socket.alive = true; });
        socket.on('error', () => {});
        socket.on('message', (bytes, binary) => {
            if (now() - windowAt >= 1000) { windowAt = now(); count = 0; actionCount = 0; }
            if (binary || ++count > 90) { socket.close(1008, 'Message limit.'); return; }
            let message;
            try { message = JSON.parse(bytes.toString()); } catch { socket.close(1008, 'Invalid message.'); return; }
            if (!message || typeof message !== 'object' || Array.isArray(message)) { socket.close(1008, 'Invalid message.'); return; }
            if (message.type === 'hello' && !playerId && !joining) {
                joining = true;
                enqueue(async () => {
                    if (socket.readyState !== WebSocket.OPEN || playerId) return;
                    try {
                        const joined = room.join(message.token, now());
                        const previous = clients.get(joined.playerId);
                        if (previous) previous.socket.close(1000, 'Replaced by a new connection.');
                        playerId = joined.playerId;
                        clients.set(playerId, { socket }); clearTimeout(joinDeadline);
                        await checkpoint();
                        send(socket, { type: 'welcome', ...joined, lastActionId: room.sessions[playerId].lastActionId || 0, world: room.view(playerId) });
                        events(); snapshots();
                    } catch (error) {
                        if (error.message === 'Room full. Try again shortly.' || error.message === 'No free home planet.') {
                            send(socket, { type: 'unavailable', reason: error.message }); socket.close(1013, 'Room full.');
                        } else throw error;
                    }
                }); return;
            }
            if (!playerId || !Number.isSafeInteger(message.sequence) || message.sequence <= sequence) return;
            sequence = message.sequence;
            if (message.type === 'input') {
                if (clients.get(playerId)?.socket !== socket) return;
                if (!room.setInput(playerId, message.input, now())) send(socket, { type: 'error', reason: 'Invalid controls.' });
                return;
            }
            if (message.type === 'action' && ++actionCount > 15) return;
            enqueue(async () => {
                if (clients.get(playerId)?.socket !== socket || !room.sessions[playerId]?.connected) return;
                if (message.type === 'chat') {
                    if (typeof message.text !== 'string' || message.text.length > 160 || now() - chatAt < 700) return;
                    const text = message.text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
                    if (!text) return;
                    chatAt = now();
                    const p = room.world.players[playerId].player;
                    for (const client of clients.values()) send(client.socket, { type: 'chat', text, label: p.label, color: p.color });
                    return;
                }
                if (message.type === 'leave') {
                    room.leave(playerId); clients.delete(playerId); await checkpoint();
                    send(socket, { type: 'left' }); socket.close(1000, 'Left galaxy.'); events(); snapshots(); return;
                }
                if (message.type !== 'action' || !Number.isSafeInteger(message.actionId) || message.actionId < 1) return;
                if (message.actionId <= (room.sessions[playerId].lastActionId || 0)) {
                    send(socket, { type: 'result', actionId: message.actionId, action: message.action,
                        result: { ok: false, reason: 'Duplicate action ignored.' }, world: room.view(playerId) }); return;
                }
                room.sessions[playerId].lastActionId = message.actionId;
                // Number entry and capture initiation must preserve cursor targeting and moving-flight controls.
                if (!['interact', 'digit', 'capturePress', 'planetUpgrade', 'rocketUpgrade', 'weaponUpgrade', 'repairTurret', 'repairTurrets'].includes(message.action)) {
                    room.setInput(playerId, { ...emptyInput, aimAngle: room.world.players[playerId].player.aimAngle }, now());
                }
                const result = room.action(playerId, message);
                await checkpoint();
                send(socket, { type: 'result', actionId: message.actionId, action: message.action, result, world: room.view(playerId) });
                events(); snapshots();
            });
        });
        socket.on('close', () => {
            clearTimeout(joinDeadline);
            enqueue(async () => {
                if (!playerId || clients.get(playerId)?.socket !== socket) return;
                clients.delete(playerId); room.disconnect(playerId, now()); await checkpoint(); events(); snapshots();
            }, true);
        });
    });
    const tickTimer = timers ? setInterval(() => {
        if (busy || closing || !Object.keys(room.sessions).length) return;
        enqueue(async () => {
            const count = Object.keys(room.sessions).length;
            room.tick(1 / 60, now());
            const critical = room.world.events.some(event => ['captured', 'died', 'cargoPickedUp', 'upgraded', 'rocketUpgraded', 'weaponUpgraded', 'turretDestroyed', 'turretRepaired'].includes(event.type));
            if (critical || now() - lastSave >= 1000 || count !== Object.keys(room.sessions).length) await checkpoint();
            events();
            if (now() - lastBroadcast >= 50) snapshots();
        });
    }, 1000 / 60) : null;
    const heartbeat = timers ? setInterval(() => {
        for (const socket of sockets.clients) {
            if (!socket.alive) { socket.terminate(); continue; }
            socket.alive = false; socket.ping();
        }
    }, 10000) : null;

    // Finish the last state write on controlled shutdown while preserving connected-player restart grace.
    async function close({ save = true } = {}) {
        closing = true;
        if (tickTimer) clearInterval(tickTimer);
        if (heartbeat) clearInterval(heartbeat);
        await queue;
        if (save) await checkpoint();
        for (const socket of sockets.clients) socket.terminate();
        await new Promise(resolveClose => server.close(resolveClose));
        sockets.close();
    }
    return { server, room, close, checkpoint };
}

// Require the assigned environment port and start only the class-box-compatible HTTP listener.
async function main() {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set the assigned PORT before starting.');
    if (process.env.PORT_BASE || process.env.PORT_END) {
        const first = Number(process.env.PORT_BASE), last = Number(process.env.PORT_END);
        if (!Number.isInteger(first) || !Number.isInteger(last) || port < first || port > last) throw new Error('PORT is outside the assigned range.');
    }
    const origins = ['https://demir-personal-website.web.app', 'https://demir-personal-website.firebaseapp.com'];
    if (process.env.STUDENT_URL) origins.push(new URL(process.env.STUDENT_URL).origin);
    if (process.env.GAME_ORIGINS) origins.push(...process.env.GAME_ORIGINS.split(',').map(origin => new URL(origin.trim()).origin));
    const dataFile = resolve(process.env.GAME_DATA_FILE || resolve(projectRoot, 'server/.runtime/galaxy.json'));
    if (!dataFile.startsWith(`${resolve(process.env.HOME)}${sep}`)) throw new Error('Game data must stay inside the assigned HOME.');
    const game = await createGameServer({ dataFile, allowedOrigins: origins });
    game.server.on('gameFatal', () => { process.exitCode = 1; });
    try {
        await new Promise((resolveListen, rejectListen) => {
            game.server.once('error', rejectListen);
            game.server.listen(port, '0.0.0.0', resolveListen);
        });
    } catch (error) { await game.close({ save: false }); throw error; }
    console.info('[game] Shared galaxy ready. Public address is $STUDENT_URL.');
    let stopping = false;
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
        if (stopping) return; stopping = true;
        try { await game.close(); process.exitCode = 0; } catch { process.exitCode = 1; }
    });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch(() => { console.error('[game] Startup failed. Check assigned PORT and private snapshot configuration.'); process.exitCode = 1; });
}
