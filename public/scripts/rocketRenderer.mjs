import { bodies, route, stationFor, targetFor, nearestBody, tuning } from './rocketPhysics.mjs';

// Paint low-resolution procedural sprites and a camera-following world without downloaded assets.
export class RocketRenderer {
    // Keep the scene and navigation map independent from the accessible HTML instruments.
    constructor(canvas, mapCanvas) {
        this.canvas = canvas;
        this.context = canvas.getContext('2d', { alpha: false });
        this.mapCanvas = mapCanvas;
        this.mapContext = mapCanvas.getContext('2d', { alpha: false });
        this.camera = { x: 0, y: -420, zoom: 0.8 };
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
        ctx.fillStyle = '#223b53'; ctx.fillRect(-14, -37, 28, 21); ctx.fillRect(-14, 16, 28, 21);
        ctx.fillStyle = '#42728b';
        for (let y = -35; y < 37; y += 5) {
            if (y > -16 && y < 16) continue;
            ctx.fillRect(-12, y, 10, 2); ctx.fillRect(2, y, 10, 2);
        }
        ctx.fillStyle = '#75868b'; ctx.fillRect(-3, -18, 6, 36);
        ctx.fillStyle = '#c6cebf'; ctx.fillRect(-15, -10, 30, 20);
        ctx.fillStyle = '#96ada9'; ctx.fillRect(-9, -14, 18, 4); ctx.fillRect(-9, 10, 18, 4);
        ctx.fillStyle = '#16303e'; ctx.fillRect(-10, -6, 7, 12); ctx.fillRect(3, -6, 7, 12);
        ctx.fillStyle = '#dda456'; ctx.fillRect(-22, -7, 7, 3); ctx.fillRect(-22, 4, 7, 3);
        ctx.fillStyle = '#81ccb4'; ctx.fillRect(-22, -3, 3, 6);
        ctx.fillStyle = '#b4c2c0'; ctx.fillRect(15, -1, 10, 2); ctx.fillRect(24, -8, 2, 16);
        ctx.restore();
        const current = run.phase === 'station' && body.id === route[run.routeIndex];
        this.label(`${body.name.toUpperCase()} RELAY`, point.x, point.y - Math.round(44 * scale), current ? '#e9b16a' : '#839aa8', 'center');
    }

    // Draw the rocket upright at zero angle, with a right-side bay and input-driven engine plumes.
    drawRocket(run, input) {
        const ctx = this.context;
        const position = this.screen(run.x, run.y);
        ctx.save(); ctx.translate(position.x, position.y); ctx.rotate(run.angle);
        const scale = Math.max(0.65, this.camera.zoom);
        ctx.scale(scale, scale);
        if (input.burn && run.throttle > 0 && run.status === 'active') {
            const length = 5 + run.throttle * 12 + Math.floor(run.elapsed * 20) % 4;
            ctx.fillStyle = '#d07238'; ctx.fillRect(-3, 8, 6, length);
            ctx.fillStyle = '#f2b967'; ctx.fillRect(-2, 8, 4, length - 3);
            ctx.fillStyle = '#f5e3a5'; ctx.fillRect(-1, 8, 2, length * 0.55);
        }
        ctx.fillStyle = '#627b83'; ctx.fillRect(-8, 3, 3, 7); ctx.fillRect(5, 3, 3, 7);
        ctx.fillStyle = '#bcc9c4'; ctx.fillRect(-5, -9, 10, 16);
        ctx.fillStyle = '#e2e5d5'; ctx.fillRect(-3, -13, 6, 5); ctx.fillRect(-1, -16, 2, 3);
        ctx.fillStyle = '#83999a'; ctx.fillRect(2, -8, 3, 14);
        ctx.fillStyle = '#153546'; ctx.fillRect(-3, -7, 5, 4);
        ctx.fillStyle = '#dba363'; ctx.fillRect(-5, 2, 10, 3);
        ctx.fillStyle = run.payload ? '#92ceab' : '#4c6671'; ctx.fillRect(5, -3, 3, 5);
        ctx.fillStyle = '#303d48'; ctx.fillRect(-3, 7, 6, 3);
        ctx.fillStyle = '#a5e5df';
        if (input.rcsX < 0) ctx.fillRect(8, -5, 5, 2);
        if (input.rcsX > 0) ctx.fillRect(-13, -5, 5, 2);
        if (input.rcsY < 0) ctx.fillRect(-6, 9, 2, 5);
        if (input.rcsY > 0) ctx.fillRect(-6, -12, 2, 5);
        ctx.restore();
    }

    // Keep the target direction visible at the edge when its physical sprite is off-screen.
    drawGuidance(run) {
        const ctx = this.context;
        const target = targetFor(run);
        const point = this.screen(target.x, target.y);
        const width = this.canvas.width;
        const height = this.canvas.height;
        const visible = point.x >= 25 && point.x <= width - 25 && point.y >= 30 && point.y <= height - 25;
        ctx.strokeStyle = '#dfae68'; ctx.lineWidth = 1;
        if (visible) {
            const size = target.type === 'station' ? 11 : 15;
            ctx.strokeRect(point.x - size, point.y - size, size * 2, size * 2);
            ctx.fillStyle = '#dfae68'; ctx.fillRect(point.x - 1, point.y - 1, 2, 2);
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
            ctx.fillStyle = '#dfae68'; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.fill(); ctx.restore();
            this.label(target.type === 'station' ? 'RELAY' : target.body.name.toUpperCase(), Math.max(30, Math.min(width - 30, x)), y - 10, '#dfae68', 'center');
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
    draw(run, input = {}, menu = false, dt = 1 / 60) {
        this.resize();
        const near = nearestBody(run);
        const speed = Math.hypot(run.vx, run.vy);
        const zoom = near.altitude < 550 && speed < 70 ? 0.95 : 0.62;
        const smoothing = 1 - Math.exp(-dt * 4);
        const desiredX = run.x + (menu ? -220 : run.vx * 0.8 + 40);
        const desiredY = run.y + (menu ? -80 : run.vy * 0.6 - 90);
        this.camera.x += (desiredX - this.camera.x) * smoothing;
        this.camera.y += (desiredY - this.camera.y) * smoothing;
        this.camera.zoom += (zoom - this.camera.zoom) * smoothing;
        this.drawSpace();
        for (const body of bodies) this.drawBody(body, run);
        for (const body of bodies) this.drawStation(body, run);
        if (!menu) this.drawGuidance(run);
        this.drawRocket(run, input);
        if (near.body.gas && near.altitude < 200) {
            const opacity = Math.max(0, Math.min(0.46, (200 - near.altitude) / 430));
            this.context.fillStyle = `rgba(117, 135, 146, ${opacity})`;
            this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.label(near.body.id === 'jupiter' ? 'ATMOSPHERE / LOW VIS / WIND' : 'ATMOSPHERE / LOW VIS', this.canvas.width / 2, this.canvas.height - 14, '#eee3bf', 'center');
        }
        this.drawMap(run);
    }
}
