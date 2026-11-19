import { bodies, route, stationFor, stationGeometry, targetFor, nearestBody, tuning } from './rocketPhysics.mjs?v=20261118-strong-dash';

// Paint low-resolution procedural sprites and a camera-following world without downloaded assets.
export class RocketRenderer {
    // Keep the scene and navigation map independent from the accessible HTML instruments.
    constructor(canvas, mapCanvas) {
        this.canvas = canvas;
        this.context = canvas.getContext('2d', { alpha: false });
        this.mapCanvas = mapCanvas;
        this.mapContext = mapCanvas.getContext('2d', { alpha: false });
        this.camera = { x: 0, y: -420, zoom: 0.8 };
        this.visualTime = 0;
        this.particles = [];
        this.exhaustCarry = new Map();
        this.exhaustRunId = null;
        this.dashFlash = null;
        this.particleSerial = 0;
        this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
        this.stars = Array.from({ length: 200 }, (_, index) => ({
            x: this.random(index * 3 + 1), y: this.random(index * 3 + 2),
            bright: this.random(index * 3 + 3) > 0.9
        }));
    }

    // Use a repeatable number sequence so scenery stays stable between animation frames.
    random(seed) {
        const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
        return value - Math.floor(value);
    }

    // Match the backing buffer to half the displayed size for intentionally crisp pixel art.
    resize() {
        const width = Math.max(1, Math.floor(this.canvas.clientWidth / 2));
        const height = Math.max(1, Math.floor(this.canvas.clientHeight / 2));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        this.context.imageSmoothingEnabled = false;
    }

    // Convert compressed world meters into the current low-resolution camera buffer.
    screen(x, y) {
        return {
            x: Math.round((x - this.camera.x) * this.camera.zoom / 2 + this.canvas.width / 2),
            y: Math.round((y - this.camera.y) * this.camera.zoom / 2 + this.canvas.height / 2)
        };
    }

    // Draw a tiny monospace label with enough contrast against stars and planet textures.
    label(text, x, y, color = '#aab9c1', align = 'left') {
        const ctx = this.context;
        ctx.font = '7px monospace';
        ctx.textAlign = align;
        ctx.fillStyle = '#071018';
        ctx.fillRect(x - (align === 'center' ? text.length * 2.1 : 0) - 2, y - 7, text.length * 4.2 + 4, 10);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
    }

    // Fill the flight field with subdued grid lines and deterministic parallax stars.
    drawSpace() {
        const ctx = this.context;
        const width = this.canvas.width;
        const height = this.canvas.height;
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
        for (const star of this.stars) {
            const x = Math.floor(((star.x * width - this.camera.x * 0.012) % width + width) % width);
            const y = Math.floor(((star.y * height - this.camera.y * 0.012) % height + height) % height);
            ctx.fillStyle = star.bright ? '#8fadb9' : '#344856';
            ctx.fillRect(x, y, 1, 1);
            if (star.bright) { ctx.fillStyle = '#263d4c'; ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); }
        }
    }

    // Render a textured planet, its atmosphere or rings, and its upright surface landing pad.
    drawBody(body, run) {
        const ctx = this.context;
        const center = this.screen(body.x, body.y);
        const scale = this.camera.zoom / 2;
        const radius = Math.round(body.radius * scale);
        if (center.x + radius < -80 || center.x - radius > this.canvas.width + 80
            || center.y + radius < -140 || center.y - radius > this.canvas.height + 140) return;
        if (body.gas) {
            ctx.fillStyle = `${body.color}0d`;
            ctx.beginPath(); ctx.arc(center.x, center.y, radius + 75 * scale, 0, Math.PI * 2); ctx.fill();
        }
        if (body.id === 'saturn') {
            ctx.strokeStyle = '#877c67'; ctx.lineWidth = 6;
            ctx.beginPath(); ctx.ellipse(center.x, center.y, radius * 1.55, radius * 0.35, -0.23, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.save();
        ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = body.color;
        ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
        for (let i = 0; i < 160; i += 1) {
            const x = center.x - radius + Math.floor(this.random(i + body.radius) * radius * 2);
            const y = center.y - radius + Math.floor(this.random(i + body.radius + 88) * radius * 2);
            ctx.fillStyle = i % 3 ? body.land : '#ffffff1a';
            if (body.gas) ctx.fillRect(center.x - radius, y, radius * 2, 1 + i % 5);
            else ctx.fillRect(x, y, 3 + i % 12, 2 + i % 7);
        }
        ctx.fillStyle = '#030b2344';
        ctx.beginPath(); ctx.arc(center.x + radius * 1.1, center.y + radius * 0.3, radius * 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = `${body.color}77`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(center.x, center.y, radius + 2, 0, Math.PI * 2); ctx.stroke();
        const pad = this.screen(body.x, body.y - body.radius);
        const half = Math.round(tuning.padHalfWidth * scale);
        ctx.fillStyle = '#1a3039'; ctx.fillRect(pad.x - half, pad.y - 3, half * 2, 5);
        ctx.fillStyle = '#bdd6c6'; ctx.fillRect(pad.x - half, pad.y - 4, half * 2, 2);
        ctx.fillStyle = '#e9b16a';
        for (let x = -half; x < half; x += 5) ctx.fillRect(pad.x + x, pad.y - 2, 2, 2);
        ctx.fillStyle = '#7cc9af'; ctx.fillRect(pad.x - half, pad.y - 8, 2, 3); ctx.fillRect(pad.x + half - 2, pad.y - 8, 2, 3);
        if (body.gas) {
            ctx.fillStyle = '#4e626b'; ctx.fillRect(pad.x - half + 4, pad.y + 3, 4, 8); ctx.fillRect(pad.x + half - 8, pad.y + 3, 4, 8);
            ctx.fillStyle = '#88b6b5'; ctx.fillRect(pad.x - 10, pad.y + 4, 20, 3);
        }
        const expected = targetFor(run);
        const isTarget = expected.type === 'planet' && expected.body.id === body.id;
        this.label(`${body.name.toUpperCase()} / ${body.gravity.toFixed(2)} m/s2`, pad.x, pad.y + 23, isTarget ? '#e9b16a' : '#c0d4d8', 'center');
    }

    // Paint fixed relay stations with a visible left-side payload receiver and solar panels.
    drawStation(body, run) {
        const ctx = this.context;
        const station = stationFor(body);
        const point = this.screen(station.x, station.y);
        if (point.x < -70 || point.x > this.canvas.width + 70 || point.y < -60 || point.y > this.canvas.height + 60) return;
        ctx.save(); ctx.translate(point.x, point.y);
        const scale = Math.max(0.55, this.camera.zoom);
        ctx.scale(scale, scale);
        for (const part of stationGeometry) {
            ctx.fillStyle = part.color;
            ctx.fillRect(part.left / 2, part.top / 2, (part.right - part.left) / 2, (part.bottom - part.top) / 2);
        }
        ctx.fillStyle = '#42728b';
        for (let y = -35; y < 37; y += 5) {
            if (y > -16 && y < 16) continue;
            ctx.fillRect(-12, y, 10, 2); ctx.fillRect(2, y, 10, 2);
        }
        ctx.fillStyle = '#16303e'; ctx.fillRect(-10, -6, 7, 12); ctx.fillRect(3, -6, 7, 12);
        ctx.restore();
        const current = run.phase === 'station' && body.id === route[run.routeIndex];
        this.label(`${body.name.toUpperCase()} RELAY`, point.x, point.y - Math.round(44 * scale), current ? '#e9b16a' : '#839aa8', 'center');
    }

    // Place visible exhaust at the rocket-local nozzles opposite each commanded thrust direction.
    exhaustJets(run, input) {
        if (run.status !== 'active' || run.fuel <= 0) return [];
        const jets = [];
        if (input.burn) {
            jets.push({ id: 'main', x: 0, y: 10, dx: 0, dy: 1, kind: 'main', power: 1 });
        }
        const turn = Math.sign(input.rotate || 0);
        if (turn) {
            jets.push({ id: 'turnTop', x: -6 * turn, y: -8, dx: -turn, dy: 0, kind: 'attitude', power: 1 });
            jets.push({ id: 'turnBottom', x: 6 * turn, y: 6, dx: turn, dy: 0, kind: 'attitude', power: 1 });
        }
        if (input.rcsX) jets.push({ id: 'translateX', x: -Math.sign(input.rcsX) * 7, y: 0,
            dx: -Math.sign(input.rcsX), dy: 0, kind: 'translation', power: 1 });
        if (input.rcsY) jets.push({ id: 'translateY', x: 0, y: -Math.sign(input.rcsY) * 10,
            dx: 0, dy: -Math.sign(input.rcsY), kind: 'translation', power: 1 });
        return jets;
    }

    // Add a brief directional exhaust burst so a dash is visible without changing flight physics.
    dashBurst(run, direction) {
        const directions = { forward: [0, 1], left: [1, 0], backward: [0, -1], right: [-1, 0] };
        const exhaust = Object.hasOwn(directions, direction) ? directions[direction] : null;
        if (!exhaust || run.status !== 'active' || run.fuel <= 0) return;
        if (this.exhaustRunId !== run.id) {
            this.particles = [];
            this.exhaustCarry.clear();
            this.exhaustRunId = run.id;
        }
        const [localX, localY] = exhaust;
        const dx = localX * Math.cos(run.angle) - localY * Math.sin(run.angle);
        const dy = localX * Math.sin(run.angle) + localY * Math.cos(run.angle);
        this.dashFlash = { angle: Math.atan2(-dy, -dx), remaining: 0.45 };
        if (this.reducedMotion) return;
        const nozzleScale = 2 * Math.max(0.65, this.camera.zoom) / this.camera.zoom;
        const offset = (localX ? 7 : 10) * nozzleScale;
        for (let index = 0; index < 18; index++) {
            const seed = ++this.particleSerial;
            const spread = (this.random(seed * 7) - 0.5) * 70;
            const speed = 120 + this.random(seed * 13) * 100;
            const lifetime = 0.18 + this.random(seed * 11) * 0.12;
            this.particles.push({ x: run.x + dx * offset, y: run.y + dy * offset,
                vx: run.vx + dx * speed - dy * spread, vy: run.vy + dy * speed + dx * spread,
                life: lifetime, lifetime, kind: 'dash', size: 4 });
        }
        if (this.particles.length > 360) this.particles.splice(0, this.particles.length - 360);
    }

    // Draw a brief screen-size dash cue above the scene so zoom cannot hide it.
    drawDashFlash(player, dt) {
        const flash = this.dashFlash;
        if (!flash) return;
        flash.remaining = Math.max(0, flash.remaining - Math.max(0, dt));
        if (flash.remaining === 0) { this.dashFlash = null; return; }
        const point = this.screen(player.x, player.y);
        const ctx = this.context;
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.rotate(flash.angle);
        ctx.globalAlpha = Math.min(1, flash.remaining / 0.15);
        ctx.strokeStyle = '#b8fff5';
        ctx.lineWidth = 3;
        for (const offset of [20, 30, 40]) {
            ctx.beginPath();
            ctx.moveTo(-offset, -8);
            ctx.lineTo(-offset + 8, 0);
            ctx.lineTo(-offset, 8);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Keep exhaust in world space so motion, turns, and mild arcade drag create curved trails.
    updateExhaust(run, input, dt, menu = false) {
        const elapsed = Math.max(0, Math.min(0.05, dt));
        if (run.id !== this.exhaustRunId || menu || this.reducedMotion) {
            this.particles = [];
            this.exhaustCarry.clear();
            this.exhaustRunId = run.id;
            if (menu || this.reducedMotion) return;
        }
        for (const particle of this.particles) {
            particle.life -= elapsed;
            const damping = Math.exp(-elapsed * 1.8);
            particle.vx *= damping;
            particle.vy *= damping;
            particle.x += particle.vx * elapsed;
            particle.y += particle.vy * elapsed;
        }
        this.particles = this.particles.filter(particle => particle.life > 0);
        const jets = this.exhaustJets(run, input);
        const activeIds = new Set(jets.map(jet => jet.id));
        for (const id of this.exhaustCarry.keys()) if (!activeIds.has(id)) this.exhaustCarry.delete(id);
        const cosine = Math.cos(run.angle);
        const sine = Math.sin(run.angle);
        // Match particle nozzles to the rocket sprite's local scale at either camera zoom.
        const nozzleScale = 2 * Math.max(0.65, this.camera.zoom) / this.camera.zoom;
        for (const jet of jets) {
            const count = (this.exhaustCarry.get(jet.id) || 0) + elapsed * (jet.kind === 'main' ? 95 * jet.power : 90);
            const emitted = Math.floor(count);
            this.exhaustCarry.set(jet.id, count - emitted);
            const dx = jet.dx * cosine - jet.dy * sine;
            const dy = jet.dx * sine + jet.dy * cosine;
            const x = run.x + (jet.x * cosine - jet.y * sine) * nozzleScale;
            const y = run.y + (jet.x * sine + jet.y * cosine) * nozzleScale;
            for (let index = 0; index < emitted; index++) {
                const seed = ++this.particleSerial;
                const spread = (this.random(seed * 7) - 0.5) * (jet.kind === 'main' ? 12 : 20);
                const speed = jet.kind === 'main' ? 100 + jet.power * 120 : 85;
                const lifetime = jet.kind === 'main' ? 0.45 + this.random(seed * 11) * 0.4 : 0.3 + this.random(seed * 11) * 0.2;
                this.particles.push({ x, y, vx: run.vx + dx * speed - dy * spread,
                    vy: run.vy + dy * speed + dx * spread, life: lifetime, lifetime,
                    kind: jet.kind, size: jet.kind === 'main' ? 3 : 3 });
            }
        }
        // Bound renderer memory even if every control is held or a tab briefly stalls.
        if (this.particles.length > 360) this.particles.splice(0, this.particles.length - 360);
    }

    // Paint fading pixel particles behind the rocket without modifying any flight state.
    drawExhaust() {
        const ctx = this.context;
        ctx.save();
        for (const particle of this.particles) {
            const point = this.screen(particle.x, particle.y);
            if (point.x < -4 || point.y < -4 || point.x > this.canvas.width + 4 || point.y > this.canvas.height + 4) continue;
            const age = 1 - particle.life / particle.lifetime;
            const colors = particle.kind === 'main' ? ['#fff0b2', '#edb264', '#cb7041', '#724c3d'] : ['#d2fff0', '#8edcd4', '#548a92', '#34515e'];
            ctx.globalAlpha = Math.max(0, 1 - age);
            ctx.fillStyle = colors[Math.min(colors.length - 1, Math.floor(age * colors.length))];
            const size = Math.max(1, Math.round(particle.size * (1 - age) * this.camera.zoom));
            // Center each square on its trajectory so its width cannot shift the plume right.
            ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
        }
        ctx.restore();
    }

    // Draw the rocket sprite; all engine and RCS thrust visuals are world-space particles.
    drawRocket(run, input) {
        const ctx = this.context;
        const position = this.screen(run.x, run.y);
        ctx.save(); ctx.translate(position.x, position.y); ctx.rotate(run.angle);
        const scale = Math.max(0.65, this.camera.zoom);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#627b83'; ctx.fillRect(-8, 3, 3, 7); ctx.fillRect(5, 3, 3, 7);
        ctx.fillStyle = '#bcc9c4'; ctx.fillRect(-5, -9, 10, 16);
        ctx.fillStyle = '#e2e5d5'; ctx.fillRect(-3, -13, 6, 5); ctx.fillRect(-1, -16, 2, 3);
        ctx.fillStyle = '#83999a'; ctx.fillRect(2, -8, 3, 14);
        ctx.fillStyle = '#153546'; ctx.fillRect(-3, -7, 5, 4);
        ctx.fillStyle = '#dba363'; ctx.fillRect(-5, 2, 10, 3);
        ctx.fillStyle = run.payload ? '#92ceab' : '#4c6671'; ctx.fillRect(5, -3, 3, 5);
        ctx.fillStyle = '#303d48'; ctx.fillRect(-3, 7, 6, 3);
        ctx.restore();
    }

    // Keep the target direction visible at the edge when its physical sprite is off-screen.
    drawGuidance(run) {
        const ctx = this.context;
        const target = targetFor(run);
        const point = this.screen(target.x, target.y);
        const distance = Math.hypot(run.x - target.x, run.y - target.y);
        const distanceText = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance.toFixed(distance < 100 ? 1 : 0)} m`;
        const targetLabel = `${target.type === 'station' ? 'RELAY' : target.body.name.toUpperCase()} · ${distanceText}`;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const visible = point.x >= 25 && point.x <= width - 25 && point.y >= 30 && point.y <= height - 25;
        const highlight = this.reducedMotion || Math.sin(this.visualTime * Math.PI * 2) >= 0;
        const color = highlight ? '#ffe0a0' : '#b78142';
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        if (visible) {
            const size = target.type === 'station' ? 15 : 19;
            ctx.strokeRect(point.x - size, point.y - size, size * 2, size * 2);
            ctx.fillStyle = color; ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
            this.label(targetLabel, Math.max(48, Math.min(width - 48, point.x)), Math.max(10, point.y - size - 6), color, 'center');
            if (target.type === 'station') this.label('↑ DOCK UPRIGHT / 0°', Math.max(48, Math.min(width - 48, point.x)), Math.min(height - 8, point.y + size + 12), color, 'center');
        } else {
            const ship = this.screen(run.x, run.y);
            const dx = point.x - ship.x;
            const dy = point.y - ship.y;
            const extentX = dx > 0 ? width - 25 - ship.x : ship.x - 25;
            const extentY = dy > 0 ? height - 28 - ship.y : ship.y - 28;
            const factor = Math.max(0, Math.min(extentX / Math.max(1, Math.abs(dx)), extentY / Math.max(1, Math.abs(dy))));
            const x = Math.round(ship.x + dx * factor);
            const y = Math.round(ship.y + dy * factor);
            ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx));
            ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.fill(); ctx.restore();
            this.label(targetLabel, Math.max(48, Math.min(width - 48, x)), y - 15, color, 'center');
        }
    }

    // Replace the failed rocket with a short expanding pixel burst before its result dialog appears.
    drawExplosion(run, progress) {
        const ctx = this.context;
        const position = this.screen(run.x, run.y);
        const spread = this.reducedMotion ? 8 : 5 + progress * 28;
        const colors = ['#fff2b0', '#ffc36b', '#e77d43', '#a94c36', '#5d4a45'];
        for (let index = 0; index < 28; index += 1) {
            const angle = this.random(index + 400) * Math.PI * 2;
            const radius = spread * (0.3 + this.random(index + 500) * 0.7);
            const size = Math.max(1, Math.round((1 - progress) * (3 + index % 4)));
            ctx.fillStyle = colors[Math.min(colors.length - 1, Math.floor(progress * 4) + index % 2)];
            ctx.fillRect(Math.round(position.x + Math.cos(angle) * radius), Math.round(position.y + Math.sin(angle) * radius), size, size);
        }
    }

    // Show every destination and the rocket in a compact, fixed-scale navigation chart.
    drawMap(run) {
        const ctx = this.mapContext;
        const width = this.mapCanvas.width;
        const height = this.mapCanvas.height;
        ctx.fillStyle = '#0c1620'; ctx.fillRect(0, 0, width, height);
        const left = -6000;
        const span = 23500;
        const mapX = x => 12 + (x - left) / span * (width - 24);
        const target = targetFor(run);
        ctx.strokeStyle = '#31444d'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(12, 31); ctx.lineTo(width - 12, 31); ctx.stroke(); ctx.setLineDash([]);
        for (const body of bodies) {
            const x = Math.round(mapX(body.x));
            ctx.fillStyle = body.id === target.body.id ? '#efb868' : body.color;
            ctx.fillRect(x - 2, 28, 5, 5);
            if (body.id === target.body.id) { ctx.strokeStyle = '#efb868'; ctx.strokeRect(x - 5, 25, 11, 11); }
            ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.fillText(body.id === 'moon' ? 'L' : body.name.slice(0, 2).toUpperCase(), x, body.id === 'moon' ? 49 : 17);
        }
        const rocketX = Math.max(6, Math.min(width - 6, mapX(run.x)));
        ctx.fillStyle = '#e3eadf'; ctx.beginPath(); ctx.moveTo(rocketX, 22); ctx.lineTo(rocketX - 3, 18); ctx.lineTo(rocketX + 3, 18); ctx.fill();
        ctx.strokeStyle = '#7cbda9'; ctx.beginPath(); ctx.moveTo(rocketX, 39); ctx.lineTo(mapX(target.body.x), 39); ctx.stroke();
    }

    // Follow the rocket at surface scale, pulling back during fast flight and interplanetary coasts.
    draw(run, input = {}, menu = false, dt = 1 / 60, failureProgress = null) {
        this.visualTime += dt;
        this.resize();
        const near = nearestBody(run);
        const speed = Math.hypot(run.vx, run.vy);
        const zoom = near.altitude < 550 && speed < 70 ? 0.95 : 0.62;
        const smoothing = 1 - Math.exp(-dt * 4);
        const desiredX = run.x + (menu ? -220 : run.vx * 0.8 + 40);
        const desiredY = run.y + (menu ? -80 : run.vy * 0.6 - 90);
        if (run.status !== 'lost' || menu) {
            this.camera.x += (desiredX - this.camera.x) * smoothing;
            this.camera.y += (desiredY - this.camera.y) * smoothing;
            this.camera.zoom += (zoom - this.camera.zoom) * smoothing;
        }
        this.updateExhaust(run, input, dt, menu);
        this.drawSpace();
        for (const body of bodies) this.drawBody(body, run);
        for (const body of bodies) this.drawStation(body, run);
        this.drawExhaust();
        if (!menu) this.drawGuidance(run);
        if (run.status !== 'lost') this.drawRocket(run, input);
        else if (!menu && failureProgress !== null) this.drawExplosion(run, failureProgress);
        if (near.body.gas && near.altitude < 200) {
            const opacity = Math.max(0, Math.min(0.46, (200 - near.altitude) / 430));
            this.context.fillStyle = `rgba(117, 135, 146, ${opacity})`;
            this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.label(near.body.id === 'jupiter' ? 'ATMOSPHERE / LOW VIS / WIND' : 'ATMOSPHERE / LOW VIS', this.canvas.width / 2, this.canvas.height - 14, '#eee3bf', 'center');
        }
        if (menu || run.status !== 'active') this.dashFlash = null;
        else this.drawDashFlash(run, dt);
        this.drawMap(run);
    }
}
