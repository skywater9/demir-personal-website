import {
    bodies, systems, tuning, stationFor, dockingPoint, stationGeometry, targetFor, nearestBody, nearestRelay, dockingStatus
} from './conquestPhysics.mjs?v=20261119-feedback';

const fullCircle = Math.PI * 2;
const neutralColor = '#87949f';
const ownColor = '#8cdeb0';
const targetColor = '#ffce72';
const speedZoomFloor = 0.28;
const speedZoomScale = 420;
const ownerColors = ['#ee8ca3', '#8dbbff', '#c8a0f3', '#edaa7d', '#8cdce0', '#d5d88e', '#e687d2'];

// Render the open galaxy in the original rocket game's procedural pixel-art style.
export class ConquestRenderer {
    // Keep effects and navigation entirely local so drawing never changes simulation state.
    constructor(canvas, mapCanvas) {
        this.canvas = canvas;
        this.context = canvas.getContext('2d', { alpha: false });
        this.mapCanvas = mapCanvas;
        this.mapContext = mapCanvas.getContext('2d', { alpha: false });
        this.camera = { x: 0, y: -420, zoom: 0.8 };
        this.cameraReady = false;
        this.visualTime = 0;
        this.dockingEffect = null;
        this.captureEffects = [];
        this.networkPoses = new Map();
        this.remoteExhaustCarry = new Map();
        this.remoteDeaths = [];
        this.particles = [];
        this.exhaustCarry = new Map();
        this.particleSerial = 0;
        this.ownerPalette = new Map();
        this.lastWorld = null;
        this.lastElapsed = 0;
        this.wasDead = false;
        this.deathPosition = null;
        this.deathTime = 0;
        this.motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
        this.reducedMotion = this.motionQuery?.matches || false;
        this.starBodies = systems.flatMap(system => system.stars || [system]);
        this.backgroundStars = Array.from({ length: 200 }, (_, index) => ({
            x: this.random(index * 3 + 1), y: this.random(index * 3 + 2),
            bright: this.random(index * 3 + 3) > 0.9
        }));
    }

    // Repeat scenery noise so moving the camera never regenerates planet textures.
    random(seed) {
        const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
        return value - Math.floor(value);
    }

    // Give arbitrary owner IDs a stable, readable color without inventing enemy ships.
    ownerColor(owner, player) {
        if (!owner) return neutralColor;
        if (owner === player.id) return player.color || ownColor;
        if (this.ownerPalette.has(owner)) return this.ownerPalette.get(owner);
        let hash = 0;
        for (const letter of String(owner)) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
        const usedColors = new Set(this.ownerPalette.values());
        let color = ownerColors[hash % ownerColors.length];
        for (let offset = 1; usedColors.has(color) && offset < ownerColors.length; offset++) {
            color = ownerColors[(hash + offset) % ownerColors.length];
        }
        if (usedColors.has(color)) color = `hsl(${(hash * 137.5) % 360} 70% 72%)`;
        this.ownerPalette.set(owner, color);
        return color;
    }

    // Keep the main field at half resolution and the map at its displayed pixel size.
    resize() {
        const width = Math.max(1, Math.floor((this.canvas.clientWidth || this.canvas.width * 2) / 2));
        const height = Math.max(1, Math.floor((this.canvas.clientHeight || this.canvas.height * 2) / 2));
        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== height) this.canvas.height = height;
        const mapWidth = Math.max(1, Math.round(this.mapCanvas.clientWidth || this.mapCanvas.width));
        const mapHeight = Math.max(1, Math.round(this.mapCanvas.clientHeight || this.mapCanvas.height));
        if (this.mapCanvas.width !== mapWidth) this.mapCanvas.width = mapWidth;
        if (this.mapCanvas.height !== mapHeight) this.mapCanvas.height = mapHeight;
        this.context.imageSmoothingEnabled = false;
        this.mapContext.imageSmoothingEnabled = false;
    }

    // Convert world meters to coordinates in the half-resolution flight canvas.
    screen(x, y) {
        return {
            x: Math.round((x - this.camera.x) * this.camera.zoom / 2 + this.canvas.width / 2),
            y: Math.round((y - this.camera.y) * this.camera.zoom / 2 + this.canvas.height / 2)
        };
    }

    // Invert the actual canvas bounds so aiming stays accurate after resizing or CSS scaling.
    aimAt(clientX, clientY, player) {
        const bounds = this.canvas.getBoundingClientRect();
        if (!(bounds.width > 0 && bounds.height > 0) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            return Number.isFinite(player.aimAngle) ? player.aimAngle : player.angle - Math.PI / 2;
        }
        const x = (clientX - bounds.left) / bounds.width * this.canvas.width;
        const y = (clientY - bounds.top) / bounds.height * this.canvas.height;
        const worldX = this.camera.x + (x - this.canvas.width / 2) * 2 / this.camera.zoom;
        const worldY = this.camera.y + (y - this.canvas.height / 2) * 2 / this.camera.zoom;
        const distance = Math.hypot(worldX - player.x, worldY - player.y);
        if (distance * this.camera.zoom / 2 < 3) return player.angle - Math.PI / 2;
        return Math.atan2(worldY - player.y, worldX - player.x);
    }

    // Show requested heading with a small cursor and dashed guide independently of the lagging hull.
    drawAimGuide(player, cursor, elapsed = this.lastElapsed) {
        if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return;
        const point = this.screen(player.x, player.y);
        const x = cursor.x * this.canvas.width;
        const y = cursor.y * this.canvas.height;
        const ctx = this.context;
        ctx.save();
        ctx.strokeStyle = '#a9e9de';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.65;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(x, y); ctx.stroke();
        ctx.setLineDash([]);
        const cooldown = Math.max(0, Math.min(1, ((player.gunOverheatedUntil || 0) - elapsed) / tuning.gunOverheatDuration));
        ctx.globalAlpha = cooldown > 0 && !this.reducedMotion ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.visualTime * 14)) : 1;
        ctx.strokeStyle = cooldown > 0 ? '#ff9379' : '#a9e9de';
        if (cooldown > 0) {
            ctx.fillStyle = '#ff8068';
            ctx.beginPath(); ctx.moveTo(x, y);
            ctx.arc(x, y, 9, -Math.PI / 2, -Math.PI / 2 + fullCircle * cooldown);
            ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.arc(x, y, 10, 0, fullCircle); ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(x - 4, y); ctx.lineTo(x - 1, y);
        ctx.moveTo(x + 1, y); ctx.lineTo(x + 4, y);
        ctx.moveTo(x, y - 4); ctx.lineTo(x, y - 1);
        ctx.moveTo(x, y + 1); ctx.lineTo(x, y + 4);
        ctx.stroke();
        ctx.restore();
    }

    // Use one continuous world projection so crossing system boundaries never jumps the map.
    mapCoordinates(x, y) {
        return { x, y };
    }

    // Keep the player at the map center and use the same zoom for drawing and map selection.
    mapLayout(world = this.lastMapWorld || { player: { x: 0, y: 0 } }) {
        const width = this.mapCanvas.width;
        const height = this.mapCanvas.height;
        const center = this.mapCoordinates(world.player.x, world.player.y);
        const scale = Math.min(width, height) * 0.44 / 8000;
        return { width, height, scale, centerX: center.x, centerY: center.y };
    }

    // Project a world point through the same fixed galaxy bounds used for map hit testing.
    mapPoint(x, y, layout) {
        const point = this.mapCoordinates(x, y);
        return {
            x: layout.width / 2 + (point.x - layout.centerX) * layout.scale,
            y: layout.height / 2 + (point.y - layout.centerY) * layout.scale
        };
    }

    // Pick the closest planet marker within ten displayed pixels, including scaled map canvases.
    mapTarget(clientX, clientY) {
        if (!this.lastMapWorld) return null;
        const bounds = this.mapCanvas.getBoundingClientRect();
        if (!(bounds.width > 0 && bounds.height > 0) || !Number.isFinite(clientX) || !Number.isFinite(clientY)
            || clientX < bounds.left || clientY < bounds.top
            || clientX > bounds.left + bounds.width || clientY > bounds.top + bounds.height) return null;
        const layout = this.mapLayout(this.lastMapWorld);
        let nearest = null;
        let nearestDistance = 10;
        for (const body of bodies) {
            const point = this.mapPoint(body.x, body.y, layout);
            const x = bounds.left + point.x / layout.width * bounds.width;
            const y = bounds.top + point.y / layout.height * bounds.height;
            const distance = Math.hypot(clientX - x, clientY - y);
            if (distance <= nearestDistance) {
                nearest = body;
                nearestDistance = distance;
            }
        }
        return nearest ? { bodyId: nearest.id } : null;
    }

    // Skip expensive world geometry when its complete screen footprint is outside the viewport.
    inView(point, radius = 0, margin = 24) {
        return point.x + radius >= -margin && point.y + radius >= -margin
            && point.x - radius <= this.canvas.width + margin
            && point.y - radius <= this.canvas.height + margin;
    }

    // Put a measured dark backing behind small high-contrast instrument labels.
    label(text, x, y, color = '#c0d4d8', align = 'left', clamp = false, fontSize = 7) {
        const ctx = this.context;
        ctx.font = `${fontSize}px monospace`;
        const width = ctx.measureText(text).width;
        if (clamp) {
            if (width > this.canvas.width - 8) x = this.canvas.width / 2;
            else x = Math.max(width / 2 + 4, Math.min(this.canvas.width - width / 2 - 4, x));
            y = Math.max(10, Math.min(this.canvas.height - 4, y));
        }
        const left = x - (align === 'center' ? width / 2 : align === 'right' ? width : 0);
        ctx.fillStyle = '#071018';
        ctx.fillRect(Math.floor(left) - 2, Math.floor(y) - fontSize, Math.ceil(width) + 4, fontSize + 3);
        ctx.textAlign = align;
        ctx.fillStyle = color;
        ctx.fillText(text, Math.round(x), Math.round(y));
    }

    // Paint the original subdued grid and deterministic parallax star field.
    drawSpace() {
        const ctx = this.context;
        const { width, height } = this.canvas;
        ctx.fillStyle = '#080f19';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#101c29';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const offsetX = ((-this.camera.x * 0.025) % 48 + 48) % 48;
        const offsetY = ((-this.camera.y * 0.025) % 48 + 48) % 48;
        for (let x = offsetX; x < width; x += 48) { ctx.moveTo(Math.floor(x), 0); ctx.lineTo(Math.floor(x), height); }
        for (let y = offsetY; y < height; y += 48) { ctx.moveTo(0, Math.floor(y)); ctx.lineTo(width, Math.floor(y)); }
        ctx.stroke();
        for (const star of this.backgroundStars) {
            const x = Math.floor(((star.x * width - this.camera.x * 0.012) % width + width) % width);
            const y = Math.floor(((star.y * height - this.camera.y * 0.012) % height + height) % height);
            ctx.fillStyle = star.bright ? '#8fadb9' : '#344856';
            ctx.fillRect(x, y, 1, 1);
            if (star.bright) {
                ctx.fillStyle = '#263d4c';
                ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3);
            }
        }
    }

    // Distinguish solid lethal system stars from decorative background pixels.
    drawStar(star) {
        const ctx = this.context;
        const center = this.screen(star.x, star.y);
        const radius = Math.max(1, star.radius * this.camera.zoom / 2);
        if (!this.inView(center, radius + 60)) return;
        ctx.save();
        ctx.fillStyle = star.color || '#fff0a6';
        ctx.shadowColor = star.color || '#fff0a6'; ctx.shadowBlur = 35;
        ctx.globalAlpha = 0.2;
        ctx.beginPath(); ctx.arc(center.x, center.y, radius + 30, 0, fullCircle); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, fullCircle); ctx.fill();
        ctx.save();
        ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, fullCircle); ctx.clip();
        for (let index = 0; index < 65; index++) {
            ctx.fillStyle = index % 2 ? '#fffbe1' : '#ffd368';
            const x = center.x + (this.random(index + 991) * 2 - 1) * radius;
            const y = center.y + (this.random(index + 772) * 2 - 1) * radius;
            ctx.fillRect(Math.round(x), Math.round(y), Math.max(2, radius / 8), 2 + index % 4);
        }
        ctx.restore();
        ctx.strokeStyle = '#ffe5ad'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, fullCircle); ctx.stroke();
        ctx.restore();
        this.label(`${star.name.toUpperCase()} / LETHAL STAR`, center.x, center.y - radius - 10, '#ffcf85', 'center');
    }

    // Expand the newly owned shield in the conqueror's color without changing simulation state.
    beginCapture(bodyId, color) {
        this.captureEffects.push({ bodyId, color, startedAt: this.visualTime });
    }

    // Fade capture rings after a short expansion, respecting reduced-motion preferences.
    drawCaptureEffects() {
        this.captureEffects = this.captureEffects.filter(effect => this.visualTime - effect.startedAt < 1);
        if (this.reducedMotion) return;
        const ctx = this.context;
        for (const effect of this.captureEffects) {
            const body = bodies.find(body => body.id === effect.bodyId);
            if (!body) continue;
            const progress = Math.max(0, this.visualTime - effect.startedAt);
            const center = this.screen(body.x, body.y);
            const radius = (body.radius + tuning.smallShieldAltitude) * this.camera.zoom / 2;
            ctx.save(); ctx.strokeStyle = effect.color; ctx.fillStyle = effect.color;
            ctx.lineWidth = 3; ctx.globalAlpha = (1 - progress) * .6;
            ctx.beginPath(); ctx.arc(center.x, center.y, radius * (1 - (1 - progress) ** 3), 0, fullCircle); ctx.stroke();
            ctx.globalAlpha = (1 - progress) * .12; ctx.fill(); ctx.restore();
        }
    }

    // Show ownership and the distinct weak field, bullet barrier, outer field, or home shield.
    drawShields(body, world) {
        const state = world.planets[body.id];
        if (!state?.owner) return;
        const ctx = this.context;
        const center = this.screen(body.x, body.y);
        const scale = this.camera.zoom / 2;
        const home = world.player.homeId === body.id || Boolean(state.home);
        const smallRadius = body.radius + (home ? tuning.homeShieldAltitude : tuning.smallShieldAltitude);
        const outerRadius = body.radius + tuning.outerFieldAltitude;
        const maxRadius = (state.level >= 3 ? outerRadius : smallRadius) * scale;
        if (!this.inView(center, maxRadius)) return;
        const color = this.ownerColor(state.owner, world.player);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.045;
        ctx.beginPath(); ctx.arc(center.x, center.y, smallRadius * scale, 0, fullCircle); ctx.fill();
        ctx.globalAlpha = home ? 0.95 : state.level >= 1 ? 0.8 : 0.4;
        ctx.lineWidth = home ? 2 : 1;
        if (!home && state.level === 0) ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(center.x, center.y, smallRadius * scale, 0, fullCircle); ctx.stroke();
        ctx.setLineDash([]);
        if (home) {
            ctx.globalAlpha = 0.4;
            ctx.beginPath(); ctx.arc(center.x, center.y, smallRadius * scale + 3, 0, fullCircle); ctx.stroke();
        }
        if (state.level >= 3) {
            ctx.globalAlpha = 0.35;
            ctx.setLineDash([6, 5]);
            ctx.beginPath(); ctx.arc(center.x, center.y, outerRadius * scale, 0, fullCircle); ctx.stroke();
        }
        ctx.restore();
    }

    // Preserve the textured planet and upright pad sprite while labeling the local economy.
    drawBody(body, world) {
        const ctx = this.context;
        const center = this.screen(body.x, body.y);
        const scale = this.camera.zoom / 2;
        const radius = Math.max(1, Math.round(body.radius * scale));
        if (!this.inView(center, radius, 75)) return;
        const state = world.planets[body.id] || { owner: null, level: 0, stock: 0 };
        const color = this.ownerColor(state.owner, world.player);
        if (body.gas) {
            ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = body.color;
            ctx.beginPath(); ctx.arc(center.x, center.y, radius + 55 * scale, 0, fullCircle); ctx.fill(); ctx.restore();
        }
        ctx.save();
        ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, fullCircle); ctx.clip();
        ctx.fillStyle = body.color;
        ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
        for (let index = 0; index < 110; index++) {
            const x = center.x - radius + Math.floor(this.random(index + body.radius) * radius * 2);
            const y = center.y - radius + Math.floor(this.random(index + body.radius + 88) * radius * 2);
            ctx.fillStyle = index % 3 ? body.land || '#677b83' : '#ffffff1a';
            if (body.gas) ctx.fillRect(center.x - radius, y, radius * 2, 1 + index % 5);
            else ctx.fillRect(x, y, 3 + index % 12, 2 + index % 7);
        }
        ctx.fillStyle = '#030b2344';
        ctx.beginPath(); ctx.arc(center.x + radius * 1.1, center.y + radius * 0.3, radius * 1.4, 0, fullCircle); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = body.color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(center.x, center.y, radius + 1, 0, fullCircle); ctx.stroke();
        const pad = this.screen(body.x, body.y - body.radius);
        const half = Math.max(3, Math.round(tuning.padHalfWidth * scale));
        ctx.fillStyle = '#1a3039'; ctx.fillRect(pad.x - half, pad.y - 3, half * 2, 5);
        ctx.fillStyle = '#d5e0cc'; ctx.fillRect(pad.x - half, pad.y - 4, half * 2, 2);
        ctx.fillStyle = targetColor;
        for (let x = -half; x < half; x += 5) ctx.fillRect(pad.x + x, pad.y - 2, 2, 2);
        ctx.fillStyle = color;
        ctx.fillRect(pad.x - half, pad.y - 8, 2, 3); ctx.fillRect(pad.x + half - 2, pad.y - 8, 2, 3);
        if (body.gas) {
            ctx.fillStyle = '#4e626b'; ctx.fillRect(pad.x - half + 2, pad.y + 3, 3, 8); ctx.fillRect(pad.x + half - 5, pad.y + 3, 3, 8);
        }
        const home = body.id === world.player.homeId || Boolean(state.home);
        if (home) {
            this.label(`⌂ HOME BASE — ${body.name.toUpperCase()}`, pad.x, pad.y + 32, color, 'center');
        } else {
            const status = !state.owner ? 'NEUTRAL / HACK RELAY'
                : `${state.owner === world.player.id ? 'OWN' : 'HOSTILE'} / L${state.level} / ${Math.floor(state.stock)} CARGO`;
            this.label(`${body.name.toUpperCase()} PAD`, pad.x, pad.y + 21, color, 'center');
            this.label(status, pad.x, pad.y + 32, color, 'center');
        }
        if (state.owner && state.level >= 2) this.drawTurret(body, world, color);
    }

    // Draw the fixed planetary turret with its barrel tracking the nearby pilot.
    drawTurret(body, world, color) {
        const ctx = this.context;
        const turret = { x: body.x, y: body.y - body.radius - 26 };
        const point = this.screen(turret.x, turret.y);
        const hostile = world.planets[body.id]?.owner !== world.player.id;
        const angle = hostile ? Math.atan2(world.player.y - turret.y, world.player.x - turret.x) : -Math.PI / 2;
        ctx.save(); ctx.translate(point.x, point.y); ctx.scale(Math.max(0.6, this.camera.zoom), Math.max(0.6, this.camera.zoom));
        ctx.fillStyle = '#253e4a'; ctx.fillRect(-7, -3, 14, 7);
        ctx.fillStyle = color; ctx.fillRect(-4, -5, 8, 5);
        ctx.rotate(angle); ctx.fillRect(0, -2, 12, 4);
        ctx.restore();
    }

    // Draw station geometry at its physical scale, its receiver, and the turret refuge boundary.
    drawStation(body, world) {
        if (body.id === world.player.homeId || world.planets[body.id]?.home) return;
        const ctx = this.context;
        const station = stationFor(body);
        const point = this.screen(station.x, station.y);
        const dock = dockingPoint(body);
        const receiver = this.screen(dock.x, dock.y);
        const refugeRadius = tuning.refugeRadius * this.camera.zoom / 2;
        if (!this.inView(receiver, refugeRadius, 50)) return;
        const selected = world.target?.bodyId === body.id && world.target.type !== 'planet';
        const color = selected ? targetColor : this.ownerColor(world.planets[body.id]?.owner, world.player);
        ctx.save();
        ctx.strokeStyle = '#8cbdcc'; ctx.globalAlpha = 0.65; ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(receiver.x, receiver.y, refugeRadius, 0, fullCircle); ctx.stroke();
        ctx.restore();
        ctx.save(); ctx.translate(point.x, point.y);
        ctx.scale(this.camera.zoom, this.camera.zoom);
        for (const part of stationGeometry) {
            ctx.fillStyle = part.color;
            ctx.fillRect(part.left / 2, part.top / 2, (part.right - part.left) / 2, (part.bottom - part.top) / 2);
        }
        ctx.fillStyle = '#42728b';
        for (let y = -35; y < 37; y += 5) {
            if (y > -16 && y < 16) continue;
            ctx.fillRect(-12, y, 10, 2); ctx.fillRect(2, y, 10, 2);
        }
        ctx.restore();
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.strokeRect(receiver.x - 3, receiver.y - 6, 6, 12);
        this.label(`${body.name.toUpperCase()} RELAY`, point.x, point.y - Math.max(12, 44 * this.camera.zoom), color, 'center');
        this.label('TURRET REFUGE', receiver.x, receiver.y + refugeRadius + 11, '#9dc4cd', 'center');
    }

    // Show cargo orbiting near planetary surfaces and swept-looking shot trails.
    drawObjects(world) {
        const ctx = this.context;
        for (const pickup of world.pickups || []) {
            const point = this.screen(pickup.x, pickup.y);
            if (!this.inView(point, 5)) continue;
            const phase = this.random(Math.floor(pickup.x * 0.013 + pickup.y * 0.017)) * fullCircle;
            const pulse = 1 + Math.sin(this.visualTime * 5 + phase) * 0.18;
            ctx.save();
            ctx.translate(point.x, point.y);
            ctx.scale(pulse, pulse);
            ctx.globalAlpha = 0.85 + (pulse - 0.82) * 0.5;
            ctx.shadowColor = '#e8c57b';
            ctx.shadowBlur = 7 + pulse * 5;
            ctx.fillStyle = '#283f43'; ctx.fillRect(-4, -4, 9, 9);
            ctx.strokeStyle = '#e8c57b'; ctx.lineWidth = 1; ctx.strokeRect(-3, -3, 7, 7);
            ctx.fillStyle = '#f4d997'; ctx.fillRect(-1, -1, 3, 3);
            ctx.restore();
        }
        for (const shot of world.projectiles || []) {
            const point = this.screen(shot.x, shot.y);
            if (!this.inView(point, 12)) continue;
            const speed = Math.hypot(shot.vx, shot.vy);
            const length = Math.min(9, speed * this.camera.zoom * 0.014);
            const dx = speed ? shot.vx / speed * length : 0;
            const dy = speed ? shot.vy / speed * length : 0;
            ctx.strokeStyle = (shot.kind || shot.source) === 'turret' ? '#ff947b' : shot.owner === world.player.id ? '#b9f5dc' : '#f3acb9';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(point.x - dx, point.y - dy); ctx.lineTo(point.x, point.y); ctx.stroke();
            ctx.fillStyle = '#fff4d1'; ctx.fillRect(point.x - 1, point.y - 1, 2, 2);
        }
    }

    // Render main thrust and braking plumes without visual jets for mouse steering.
    exhaustJets(player, input, dead) {
        if (dead || player.docked || player.fuel <= 0) return [];
        const jets = [];
        if (input.burn) jets.push({ id: 'main', x: 0, y: 10, dx: 0, dy: 1, kind: 'main' });
        const braking = input.rcsY > 0;
        const noseSpeed = Math.abs(player.vx * Math.sin(player.angle) - player.vy * Math.cos(player.angle));
        const power = braking ? Math.min(6, noseSpeed / 50) : 0;
        const diagonal = Math.SQRT1_2;
        if (braking && power > 0) {
            jets.push({ id: 'frontLeft', x: -6, y: -8, dx: -diagonal, dy: -diagonal, kind: 'attitude', power });
        }
        if (braking && power > 0) {
            jets.push({ id: 'frontRight', x: 6, y: -8, dx: diagonal, dy: -diagonal, kind: 'attitude', power });
        }
        return jets;
    }

    // Emit centered world-space pixels from the sprite, inheriting the pilot's current velocity.
    emitJet(player, jet, count) {
        const cosine = Math.cos(player.angle);
        const sine = Math.sin(player.angle);
        const nozzleScale = 2 * Math.max(0.65, this.camera.zoom) / this.camera.zoom;
        const dx = jet.dx * cosine - jet.dy * sine;
        const dy = jet.dx * sine + jet.dy * cosine;
        const x = player.x + (jet.x * cosine - jet.y * sine) * nozzleScale;
        const y = player.y + (jet.x * sine + jet.y * cosine) * nozzleScale;
        const plumeScale = Math.sqrt(jet.power || 1);
        for (let index = 0; index < count; index++) {
            const seed = ++this.particleSerial;
            const brakePower = jet.kind === 'main' ? 0 : jet.power || 0;
            const spreadRange = jet.kind === 'main' ? 12 : 18 + brakePower * 35;
            const spread = (this.random(seed * 7) - 0.5) * spreadRange;
            const speedVariation = jet.kind === 'main' ? 0.08 : Math.min(0.5, 0.12 + brakePower * 0.06);
            const speed = (jet.kind === 'main' ? 220 : 85 * plumeScale)
                * (1 + (this.random(seed * 13) - 0.5) * 2 * speedVariation);
            const lifetime = jet.kind === 'main' ? 0.45 + this.random(seed * 11) * 0.4
                : (0.14 + this.random(seed * 11) * 0.22) * plumeScale;
            this.particles.push({ x, y, vx: player.vx + dx * speed - dy * spread,
                vy: player.vy + dy * speed + dx * spread, life: lifetime, lifetime,
                kind: jet.kind, size: 3 * plumeScale });
        }
    }

    // Leak a short burst of white fuel particles from the hull only after real damage events.
    damageBurst(world, event) {
        if (this.reducedMotion) return;
        const player = world.player;
        const x = Number.isFinite(event.x) ? event.x : player.x;
        const y = Number.isFinite(event.y) ? event.y : player.y;
        for (let index = 0; index < 26; index++) {
            const seed = ++this.particleSerial;
            const angle = this.random(seed * 7) * fullCircle;
            const speed = 35 + this.random(seed * 13) * 75;
            const lifetime = 0.5 + this.random(seed * 11) * 0.4;
            this.particles.push({ x, y, vx: player.vx + Math.cos(angle) * speed,
                vy: player.vy + Math.sin(angle) * speed, life: lifetime, lifetime,
                kind: 'damage', size: 2 + this.random(seed * 17) * 2.5 });
        }
        if (this.particles.length > 360) this.particles.splice(0, this.particles.length - 360);
    }

    // Age bounded particles independently of simulation state and stop emission in menus.
    updateExhaust(world, input, dt, menu, dead) {
        const player = world.player;
        if (menu || this.reducedMotion) {
            this.particles = [];
            this.exhaustCarry.clear();
            return;
        }
        for (const particle of this.particles) {
            particle.life -= dt;
            const damping = Math.exp(-dt * 1.8);
            particle.vx *= damping; particle.vy *= damping;
            particle.x += particle.vx * dt; particle.y += particle.vy * dt;
        }
        this.particles = this.particles.filter(particle => particle.life > 0);
        const jets = this.exhaustJets(player, input, dead);
        const activeIds = new Set(jets.map(jet => jet.id));
        for (const id of this.exhaustCarry.keys()) if (!activeIds.has(id)) this.exhaustCarry.delete(id);
        for (const jet of jets) {
            const emissionRate = jet.kind === 'main' ? 95 : 45 * (jet.power || 0);
            const count = (this.exhaustCarry.get(jet.id) || 0) + dt * emissionRate;
            const emitted = Math.floor(count);
            this.exhaustCarry.set(jet.id, count - emitted);
            this.emitJet(player, jet, emitted);
        }
        if (this.particles.length > 360) this.particles.splice(0, this.particles.length - 360);
    }

    // Paint each fading square around its trajectory so exhaust never shifts to one side.
    drawExhaust() {
        const ctx = this.context;
        ctx.save();
        for (const particle of this.particles) {
            const point = this.screen(particle.x, particle.y);
            if (!this.inView(point, 4)) continue;
            const age = 1 - particle.life / particle.lifetime;
            const colors = particle.kind === 'damage' ? ['#ffffff', '#f2f5fa', '#d5dfeb', '#9aaabb']
                : particle.kind === 'main' ? ['#fff0b2', '#edb264', '#cb7041', '#724c3d']
                : ['#f4fff9', '#c9fff2', '#79d6cf', '#40858c'];
            ctx.globalAlpha = Math.max(0, 1 - age);
            ctx.fillStyle = colors[Math.min(colors.length - 1, Math.floor(age * colors.length))];
            const size = Math.max(1, Math.round(particle.size * (1 - age) * this.camera.zoom));
            if (particle.kind === 'damage') {
                ctx.shadowColor = '#eaf6ff';
                ctx.shadowBlur = 5 * this.camera.zoom;
            }
            ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
            ctx.shadowBlur = 0;
        }
        ctx.restore();
    }

    // Preserve the familiar rocket hull and add cargo plus a gun that aims independently.
    drawRocket(player, elapsed = this.lastElapsed) {
        const ctx = this.context;
        const point = this.screen(player.x, player.y);
        const scale = Math.max(0.65, this.camera.zoom);
        ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(player.angle); ctx.scale(scale, scale);
        ctx.fillStyle = '#627b83'; ctx.fillRect(-8, 3, 3, 7); ctx.fillRect(5, 3, 3, 7);
        ctx.fillStyle = '#bcc9c4'; ctx.fillRect(-5, -9, 10, 16);
        ctx.fillStyle = '#e2e5d5'; ctx.fillRect(-3, -13, 6, 5); ctx.fillRect(-1, -16, 2, 3);
        ctx.fillStyle = '#83999a'; ctx.fillRect(2, -8, 3, 14);
        ctx.fillStyle = '#153546'; ctx.fillRect(-3, -7, 5, 4);
        ctx.fillStyle = player.color || ownColor; ctx.fillRect(-5, 2, 10, 3);
        ctx.fillStyle = player.cargo > 0 ? '#e8c57b' : '#4c6671'; ctx.fillRect(5, -3, 3, 5);
        ctx.fillStyle = '#303d48'; ctx.fillRect(-3, 7, 6, 3);
        ctx.restore();
        ctx.save(); ctx.translate(point.x, point.y);
        ctx.rotate(Number.isFinite(player.aimAngle) ? player.aimAngle : player.angle - Math.PI / 2);
        ctx.scale(scale, scale);
        for (const offset of ((player.rocketTier || 0) >= 2 ? [-5, 5] : [0])) {
        ctx.save(); ctx.translate(0, offset);
        ctx.fillStyle = '#112331'; ctx.fillRect(-3, -3, 14, 6);
        ctx.fillStyle = '#e3dbc5'; ctx.fillRect(1, -1, 11, 2);
        ctx.fillStyle = player.color || ownColor; ctx.fillRect(-2, -2, 4, 4);
        const heat = Math.max(0, Math.min(1, Number(player.gunHeat) || 0));
        const orangeBlend = Math.min(1, heat / 0.68);
        const whiteBlend = Math.max(0, (heat - 0.68) / 0.32);
        const tipRed = Math.round(227 + 28 * orangeBlend);
        const tipGreen = Math.round(219 - 113 * orangeBlend + 149 * whiteBlend);
        const tipBlue = Math.round(197 - 161 * orangeBlend + 196 * whiteBlend);
        const muzzleColor = `rgb(${tipRed} ${tipGreen} ${tipBlue})`;
        if (heat > 0.08) {
            ctx.globalAlpha = heat * 0.62;
            ctx.fillStyle = '#ff6426';
            ctx.fillRect(-3, -3, 14, 6);
            ctx.globalAlpha = whiteBlend * 0.34;
            ctx.fillStyle = '#fff0c4';
            ctx.fillRect(-3, -3, 14, 6);
            ctx.globalAlpha = 1;
        }
        ctx.fillStyle = muzzleColor;
        ctx.shadowColor = heat > 0.68 ? '#fff0c4' : heat > 0.08 ? '#ff5b20' : 'transparent';
        ctx.shadowBlur = heat > 0.08 ? 2 + heat * 9 : 0;
        ctx.fillRect(11, -1, 3, 2);
        ctx.shadowBlur = 0;
        if (heat > 0.68) {
            ctx.globalAlpha = whiteBlend;
            ctx.fillStyle = '#fffef0';
            ctx.fillRect(12, -0.5, 2, 1);
            ctx.globalAlpha = 1;
        }
        ctx.restore();
        }
        ctx.restore();
        if (elapsed < (player.damageFlashUntil || 0)) {
            ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(player.angle); ctx.scale(scale, scale);
            ctx.globalAlpha = 0.85 * Math.min(1, (player.damageFlashUntil - elapsed) / 0.15);
            ctx.fillStyle = '#ff4545'; ctx.shadowColor = '#ff4545'; ctx.shadowBlur = 8;
            ctx.fillRect(-5, -9, 10, 19); ctx.fillRect(-3, -13, 6, 5);
            ctx.fillRect(-8, 3, 3, 7); ctx.fillRect(5, 3, 3, 7);
            ctx.restore();
        }
    }

    // Show a short pixel explosion at the death location until the pilot respawns at home.
    drawExplosion() {
        const progress = Math.min(1, (this.visualTime - this.deathTime) / tuning.respawnDelay);
        const ctx = this.context;
        const point = this.screen(this.deathPosition.x, this.deathPosition.y);
        const spread = this.reducedMotion ? 8 : 5 + progress * 28;
        const colors = ['#fff2b0', '#ffc36b', '#e77d43', '#a94c36', '#5d4a45'];
        for (let index = 0; index < 28; index++) {
            const angle = this.random(index + 400) * fullCircle;
            const radius = spread * (0.3 + this.random(index + 500) * 0.7);
            const size = Math.max(1, Math.round((1 - progress) * (3 + index % 4)));
            ctx.fillStyle = colors[Math.min(colors.length - 1, Math.floor(progress * 4) + index % 2)];
            ctx.fillRect(Math.round(point.x + Math.cos(angle) * radius) - size / 2,
                Math.round(point.y + Math.sin(angle) * radius) - size / 2, size, size);
        }
        this.label('SHIP LOST / RESPAWNING AT HOME', this.canvas.width / 2, this.canvas.height - 14, '#ffbd85', 'center', true);
    }

    // Capture the attach transition independently of mutable simulation player objects.
    beginDocking(fromPlayer, toPlayer) {
        this.dockingEffect = {
            from: { x: fromPlayer.x, y: fromPlayer.y, angle: fromPlayer.angle },
            to: { x: toPlayer.x, y: toPlayer.y, angle: toPlayer.angle },
            startedAt: this.visualTime
        };
    }

    // Interpolate only the displayed hull over the quick attach animation.
    dockingVisualPlayer(player) {
        const effect = this.dockingEffect;
        if (!effect) return player;
        const progress = Math.min(1, Math.max(0, (this.visualTime - effect.startedAt) / 0.14));
        if (this.reducedMotion || !player.docked || progress >= 1) {
            this.dockingEffect = null;
            return player;
        }
        const difference = effect.to.angle - effect.from.angle;
        const angle = Math.atan2(Math.sin(difference), Math.cos(difference));
        return { ...player,
            x: effect.from.x + (effect.to.x - effect.from.x) * progress,
            y: effect.from.y + (effect.to.y - effect.from.y) * progress,
            angle: effect.from.angle + angle * progress };
    }

    // Project the right bay using the same minimum sprite scale as the visible rocket.
    rocketBay(player) {
        const point = this.screen(player.x, player.y);
        const scale = Math.max(0.65, this.camera.zoom);
        return {
            x: point.x + (7 * Math.cos(player.angle) + 0.5 * Math.sin(player.angle)) * scale,
            y: point.y + (7 * Math.sin(player.angle) - 0.5 * Math.cos(player.angle)) * scale
        };
    }

    // Guide any nearby undocked pilot to the nearest relay without duplicating readiness text.
    drawDockingGuide(world, cursor) {
        const player = world.player;
        if (player.docked || player.deadUntil > world.elapsed) return;
        const body = nearestRelay(player, world);
        const status = dockingStatus(world, body.id);
        if (status.distance > tuning.dockingAssistDistance) return;
        const dock = dockingPoint(body);
        const ghost = { ...player, x: dock.x, y: dock.y, angle: 0 };
        const point = this.screen(dock.x, dock.y);
        const color = status.ready ? ownColor : neutralColor;
        const ctx = this.context;
        ctx.save();
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = 0.22;
        ctx.beginPath(); ctx.arc(point.x, point.y, tuning.dockingDistance * this.camera.zoom / 2, 0, fullCircle); ctx.stroke();
        const from = this.rocketBay(player);
        const to = this.rocketBay(ghost);
        ctx.globalAlpha = 0.65; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = this.reducedMotion ? 0.4 : 0.3 + 0.25 * (1 + Math.sin(this.visualTime * 8)) / 2;
        this.drawRocket(ghost);
        ctx.restore();

    }

    // Keep the selected relay or pad visible through distance labels and an edge direction arrow.
    drawGuidance(world) {
        const player = world.player;
        const target = targetFor(world);
        if (!target) return;
        const point = this.screen(target.x, target.y);
        const distance = Math.hypot(player.x - target.x, player.y - target.y);
        const distanceText = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
        const relay = target.type === 'relay' || target.type === 'station';
        const moonRelay = relay && target.body.id === 'moon';
        const explainCargo = moonRelay && world.stats.captures === 0;
        const text = `${target.body.name.toUpperCase()} ${relay ? 'RELAY' : 'PAD'} / ${distanceText}`;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const visible = point.x >= 22 && point.x <= width - 22 && point.y >= 28 && point.y <= height - 28;
        const color = targetColor;
        const ctx = this.context;
        ctx.save();
        ctx.globalAlpha = this.reducedMotion ? 1 : .45 + .55 * Math.abs(Math.sin(this.visualTime * 4));
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        let captionX, captionY;
        if (visible) {
            const size = relay ? 14 : 18;
            ctx.strokeRect(point.x - size, point.y - size, size * 2, size * 2);
            ctx.fillStyle = color; ctx.beginPath();
            const arrowHalfWidth = moonRelay ? 14 : 7;
            ctx.moveTo(point.x, point.y - size - 18); ctx.lineTo(point.x - arrowHalfWidth, point.y - size - 18 - arrowHalfWidth * 1.6);
            ctx.lineTo(point.x + arrowHalfWidth, point.y - size - 18 - arrowHalfWidth * 1.6); ctx.fill();
            captionX = point.x; captionY = point.y + size + 20;
            this.label(text, point.x, point.y - size - 6, color, 'center', true);
            if (!relay && distance < 300) {
                this.label('LAND UPRIGHT / LOW SPEED', point.x, point.y + size + 12, color, 'center', true);
            }
        } else {
            const centerX = width / 2;
            const centerY = height / 2;
            const dx = point.x - centerX;
            const dy = point.y - centerY;
            const factor = Math.max(0, Math.min((width / 2 - 22) / Math.max(1, Math.abs(dx)), (height / 2 - (explainCargo ? 65 : 30)) / Math.max(1, Math.abs(dy))));
            const x = centerX + dx * factor;
            const y = centerY + dy * factor;
            ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx));
            const arrowSize = moonRelay ? 20 : 10;
            ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(arrowSize, 0); ctx.lineTo(-arrowSize * .6, -arrowSize * .6); ctx.lineTo(-arrowSize * .6, arrowSize * .6); ctx.fill(); ctx.restore();
            captionX = x; captionY = y + 28;
            this.label(text, x, y - 12, color, 'center', true);
        }
        if (explainCargo) {
            const lines = width >= 320 ? ['CAPTURE PLANETS TO GAIN CARGO'] : ['CAPTURE PLANETS', 'TO GAIN CARGO'];
            for (let index = 0; index < lines.length; index++) {
                this.label(lines[index], captionX, Math.min(height - 6 - (lines.length - 1) * 15, captionY) + index * 15,
                    '#fff0b1', 'center', true, 12);
            }
        }
        ctx.restore();
    }

    // Draw all three scattered systems with ownership, target, home, and the pilot's bearing.
    drawMap(world) {
        const ctx = this.mapContext;
        this.lastMapWorld = world;
        const layout = this.mapLayout(world);
        const { width, height } = layout;
        ctx.fillStyle = '#0c1620'; ctx.fillRect(0, 0, width, height);
        ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.lineWidth = 1;
        for (const system of systems) {
            const point = this.mapPoint(system.x, system.y, layout);
            const members = bodies.filter(body => body.systemId === system.id);
            const radius = Math.max(1, ...members.map(body => Math.hypot(body.x - system.x, body.y - system.y))) * layout.scale;
            ctx.strokeStyle = '#263e4c'; ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, fullCircle); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#aabec7';
            ctx.fillText(system.name.toUpperCase(), Math.max(20, Math.min(width - 20, point.x)), Math.max(9, Math.min(height - 4, point.y - radius - 5)));
        }
        for (const star of this.starBodies) {
            const point = this.mapPoint(star.x, star.y, layout);
            ctx.save(); ctx.fillStyle = star.color || '#fff0a6';
            ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(4, star.radius * layout.scale), 0, fullCircle); ctx.fill(); ctx.restore();
        }
        const player = this.mapPoint(world.player.x, world.player.y, layout);
        for (const body of bodies) {
            const point = this.mapPoint(body.x, body.y, layout);
            const x = Math.round(point.x);
            const y = Math.round(point.y);
            const owner = world.planets[body.id]?.owner;
            ctx.fillStyle = this.ownerColor(owner, world.player);
            ctx.beginPath(); ctx.arc(x, y, Math.max(3, body.radius * layout.scale), 0, fullCircle); ctx.fill();
            if (body.id === world.player.homeId || world.planets[body.id]?.home) {
                const homeColor = this.ownerColor(owner, world.player);
                ctx.strokeStyle = homeColor; ctx.beginPath(); ctx.moveTo(x - 4, y - 5); ctx.lineTo(x, y - 9); ctx.lineTo(x + 4, y - 5); ctx.stroke();
                ctx.fillStyle = homeColor; ctx.fillText('H', x + 9, y + 3);
            }
        }
        for (const other of world.others || []) if (!other.deadUntil) {
            const point = this.mapPoint(other.x, other.y, layout);
            ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(other.angle);
            ctx.fillStyle = other.color; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-4, 5); ctx.lineTo(4, 5); ctx.closePath(); ctx.fill(); ctx.restore();
        }
        const x = width / 2;
        const y = height / 2;
        const playerColor = world.player.color || ownColor;
        ctx.save(); ctx.translate(x, y); ctx.rotate(world.player.angle);
        ctx.strokeStyle = '#f4fff9'; ctx.lineWidth = 2.5; ctx.fillStyle = playerColor;
        ctx.shadowColor = '#f4fff9'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(-7, 8); ctx.lineTo(0, 5); ctx.lineTo(7, 8); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.restore();
    }

    // Ease from precise surface flight to a wide travel view, snapping only for a new world or respawn.
    updateCamera(player, near, dt, menu, respawned) {
        const speed = Math.hypot(player.vx, player.vy);
        const altitude = Math.max(0, near.altitude);
        const surfaceBlend = altitude / (altitude + 600);
        const idleZoom = 0.95 + (0.58 - 0.95) * surfaceBlend;
        // Every increase in speed widens the view, approaching the minimum without threshold jumps.
        const desiredZoom = player.docked || player.landedOn ? 0.95
            : speedZoomFloor + (idleZoom - speedZoomFloor) / (1 + speed / speedZoomScale);
        const lookX = Math.max(-this.canvas.width * 0.4 / desiredZoom, Math.min(this.canvas.width * 0.4 / desiredZoom, player.vx * 0.7));
        const lookY = Math.max(-this.canvas.height * 0.4 / desiredZoom, Math.min(this.canvas.height * 0.4 / desiredZoom, player.vy * 0.6));
        const desiredX = player.x + (menu ? -180 : lookX);
        const desiredY = player.y + (menu ? -60 : lookY - 75);
        const distance = Math.hypot(this.camera.x - player.x, this.camera.y - player.y);
        if (!this.cameraReady || respawned) {
            this.camera.x = desiredX; this.camera.y = desiredY; this.camera.zoom = desiredZoom;
            this.cameraReady = true;
        } else {
            const zoomSmoothing = 1 - Math.exp(-dt * 4);
            const recenter = distance > Math.max(this.canvas.width, this.canvas.height) * 4 / this.camera.zoom;
            const positionSmoothing = this.reducedMotion || recenter ? 1 : zoomSmoothing;
            this.camera.x += (desiredX - this.camera.x) * positionSmoothing;
            this.camera.y += (desiredY - this.camera.y) * positionSmoothing;
            // Recenter position when needed, but keep zoom easing to avoid visible scale steps.
            this.camera.zoom += (desiredZoom - this.camera.zoom) * zoomSmoothing;
        }
    }

    // Keep a short public explosion for a nearby pilot without showing their private death notice.
    beginRemoteDeath(point) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
        this.remoteDeaths.push({ x: point.x, y: point.y, at: this.visualTime });
        if (this.remoteDeaths.length > 32) this.remoteDeaths.shift();
    }

    // Paint bounded pixel bursts at server-confirmed death positions.
    drawRemoteDeaths() {
        this.remoteDeaths = this.remoteDeaths.filter(effect => this.visualTime - effect.at < .9);
        const ctx = this.context;
        for (const effect of this.remoteDeaths) {
            const point = this.screen(effect.x, effect.y);
            const progress = (this.visualTime - effect.at) / .9;
            ctx.save(); ctx.globalAlpha = 1 - progress;
            for (let index = 0; index < 18; index++) {
                const angle = index / 18 * fullCircle;
                const spread = this.reducedMotion ? 2 : progress * 36 * this.camera.zoom;
                const size = Math.max(1, 4 * (1 - progress));
                ctx.fillStyle = index % 3 ? '#f9b85b' : '#fff4d1';
                ctx.fillRect(point.x + Math.cos(angle) * spread, point.y + Math.sin(angle) * spread, size, size);
            }
            ctx.restore();
        }
    }

    // Emit visible remote engines without receiving hidden pilot controls.
    updateRemoteExhaust(world, dt, menu) {
        const active = new Set();
        if (!menu && !this.reducedMotion) for (const player of world.others || []) {
            if (player.deadUntil) continue;
            const jets = this.exhaustJets(player, { burn: player.thrusting, rcsY: player.braking ? 1 : 0 }, false);
            for (const jet of jets) {
                const id = `${player.id}:${jet.id}`; active.add(id);
                const count = (this.remoteExhaustCarry.get(id) || 0) + dt * (jet.kind === 'main' ? 95 : 45 * jet.power);
                this.emitJet(player, jet, Math.floor(count)); this.remoteExhaustCarry.set(id, count % 1);
            }
        }
        for (const id of this.remoteExhaustCarry.keys()) if (!active.has(id)) this.remoteExhaustCarry.delete(id);
        if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
    }

    // Smooth server poses for display only; authoritative coordinates remain untouched.
    networkPose(player, dt) {
        let pose = this.networkPoses.get(player.id);
        if (!pose || Math.hypot(player.x - pose.x, player.y - pose.y) > 1000 || this.reducedMotion) {
            pose = { x: player.x, y: player.y, angle: player.angle };
            this.networkPoses.set(player.id, pose);
        } else {
            const blend = 1 - Math.exp(-dt * 20);
            pose.x += (player.x - pose.x) * blend; pose.y += (player.y - pose.y) * blend;
            pose.angle += Math.atan2(Math.sin(player.angle - pose.angle), Math.cos(player.angle - pose.angle)) * blend;
        }
        return { ...player, ...pose };
    }

    // Compose a complete local conquest frame without creating bots or mutating world state.
    draw(world, input = {}, menu = false, dt = 1 / 60) {
        const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(0.05, dt)) : 1 / 60;
        this.visualTime += elapsed;
        if (world.ownerColors) {
            this.ownerPalette.clear();
            for (const [id, color] of Object.entries(world.ownerColors)) this.ownerPalette.set(id, color);
        }
        this.reducedMotion = this.motionQuery?.matches || false;
        this.resize();
        const player = world.player;
        const dead = player.deadUntil > world.elapsed;
        const newWorld = this.lastWorld !== world || world.elapsed < this.lastElapsed;
        if (newWorld) {
            this.captureEffects = [];
            this.networkPoses.clear();
            this.remoteExhaustCarry.clear();
            this.remoteDeaths = [];
            this.particles = [];
            this.exhaustCarry.clear();
            this.cameraReady = false;
            this.wasDead = false;
        }
        if (dead && !this.wasDead) {
            this.deathPosition = { x: player.x, y: player.y };
            this.deathTime = this.visualTime;
            this.exhaustCarry.clear();
        }
        const near = nearestBody(player);
        const respawned = !dead && this.wasDead;
        if (respawned) {
            this.particles = [];
            this.exhaustCarry.clear();
        }
        if (!dead || !this.cameraReady) this.updateCamera(player, near, elapsed, menu, respawned);
        this.updateExhaust(world, input, elapsed, menu, dead);
        this.updateRemoteExhaust(world, elapsed, menu);
        this.drawSpace();
        for (const star of this.starBodies) this.drawStar(star);
        for (const body of bodies) this.drawShields(body, world);
        for (const body of bodies) this.drawBody(body, world);
        for (const body of bodies) this.drawStation(body, world);
        this.drawObjects(world);
        this.drawExhaust();
        this.drawRemoteDeaths();
        for (const other of world.others || []) if (!other.deadUntil) {
            const pose = this.networkPose(other, elapsed);
            this.drawRocket(pose, world.elapsed);
            const point = this.screen(pose.x, pose.y);
            if (this.inView(point, 24)) this.label(other.label, point.x, point.y - 18, other.color, 'center');
        }
        const liveIds = new Set([player.id, ...(world.others || []).map(other => other.id)]);
        for (const id of this.networkPoses.keys()) if (!liveIds.has(id)) this.networkPoses.delete(id);
        if (!dead) this.drawRocket(this.dockingVisualPlayer(world.others ? this.networkPose(player, elapsed) : player), world.elapsed);
        else if (this.deathPosition) this.drawExplosion();
        if (!menu && !dead) this.drawGuidance(world);
        this.drawCaptureEffects();

        if (!menu && !dead && !respawned) this.drawAimGuide(player, input.aimCursor, world.elapsed);
        if (!menu && !dead) this.drawDockingGuide(world, input.aimCursor);
        this.drawMap(world);
        this.wasDead = dead;
        this.lastWorld = world;
        this.lastElapsed = world.elapsed;
    }
}
