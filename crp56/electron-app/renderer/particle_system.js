/* particle_system.js */
(() =>
{
    const ParticleFX =
        {
        canvas: null,
        ctx: null,
        rafId: null,
        running: false,
        enabled: true,
        html: document.documentElement,
        particles: [],
        gravityWaves: [],
        colors: ['#ffd400', '#ffea72', '#fff9d6', '#ffbf2f'],
        resizeQueued: false,
        pulseTick: 0,
        config: {
            solarDust: { countBase: 42, countDiv: 36, speed: 0.14, speedJitter: 0.12, radiusMin: 0.7, radiusMax: 1.9, alphaMin: 0.16, alphaMax: 0.48, linkDistance: 112, linkAlpha: 0.06 },
            carreraBurst: { countBase: 20, countDiv: 80, speed: 0.45, speedJitter: 0.62, radiusMin: 0.9, radiusMax: 2.8, alphaMin: 0.35, alphaMax: 0.95, linkDistance: 82, linkAlpha: 0.04 },
            gravityFlicker: { countBase: 8, countDiv: 140, speed: 0.18, speedJitter: 0.18, radiusMin: 1.3, radiusMax: 2.8, alphaMin: 0.12, alphaMax: 0.24, linkDistance: 120, linkAlpha: 0.05 }
        }
    };

    function clamp(n, min, max)
    {
        return Math.max(min, Math.min(max, n));
    }

    function hexToRgba(input, alpha)
    {
        const c = String(input).replace('#', '');
        const normalized = c.length === 3 ? c.split('').map(ch => ch + ch).join('') : c;
        const bigint = parseInt(normalized, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function accentColors()
    {
        if (ParticleFX.html?.dataset?.theme === 'hellflare-gold')
        {
            return ['#ffca28', '#ffd95e', '#fff6c7', '#ff9f1c'];
        }

        return ['#ffd400', '#ffea72', '#fff9d6', '#ffbf2f'];
    }

    function initCanvas(canvasOrId)
    {
        const canvas = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
        if (!canvas) return false;
        ParticleFX.canvas = canvas;
        ParticleFX.ctx = canvas.getContext('2d');
        ParticleFX.colors = accentColors();
        return !!ParticleFX.ctx;
    }

    function countFor(cfg)
    {
        return Math.max(cfg.countBase, Math.floor(window.innerWidth / cfg.countDiv));
    }

    function makeParticle(kind)
    {
        const cfg = ParticleFX.config[kind];
        const colors = accentColors();
        const angle = Math.random() * Math.PI * 2;
        const speed = cfg.speed + Math.random() * cfg.speedJitter;
        const w = window.innerWidth;
        const h = window.innerHeight;
        const cx = w / 2;
        const cy = h / 2;
        const burst = kind === 'carreraBurst';
        const flicker = kind === 'gravityFlicker';
        const radial = flicker ? Math.random() * Math.max(w, h) * 0.25 : 0;

        return {
            kind,
            x: flicker ? cx + Math.cos(angle) * radial : Math.random() * w,
            y: flicker ? cy + Math.sin(angle) * radial : Math.random() * h,
            r: Math.random() * (cfg.radiusMax - cfg.radiusMin) + cfg.radiusMin,
            vx: Math.cos(angle) * speed + (Math.random() - 0.5) * speed * 0.4,
            vy: Math.sin(angle) * speed + (Math.random() - 0.5) * speed * 0.4,
            alpha: Math.random() * (cfg.alphaMax - cfg.alphaMin) + cfg.alphaMin,
            twinkle: Math.random() * Math.PI * 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            streak: burst && Math.random() < 0.35,
            burst: burst && Math.random() < 0.18,
            seedAngle: angle,
            seedOrbit: radial,
            life: Math.random() * 1 + 0.2
        };
    }

    function seedParticles()
    {
        const canvas = ParticleFX.canvas;
        const ctx = ParticleFX.ctx;
        if (!canvas || !ctx) return;

        ParticleFX.colors = accentColors();
        ParticleFX.particles = [
            ...Array.from({ length: countFor(ParticleFX.config.solarDust) }, () => makeParticle('solarDust')),
            ...Array.from({ length: countFor(ParticleFX.config.carreraBurst) }, () => makeParticle('carreraBurst')),
            ...Array.from({ length: countFor(ParticleFX.config.gravityFlicker) }, () => makeParticle('gravityFlicker'))
        ];

        ParticleFX.gravityWaves = Array.from({ length: 3 }, (_, i) => ({radius: 120 + i * 85, speed: 0.14 + i * 0.03, alpha: 0.08 + i * 0.03, offset: i * 1.7}));
    }

    function resizeCanvas()
    {
        const canvas = ParticleFX.canvas;
        const ctx = ParticleFX.ctx;
        if (!canvas || !ctx) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 1.8);
        canvas.width = Math.floor(window.innerWidth * ratio);
        canvas.height = Math.floor(window.innerHeight * ratio);
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        seedParticles();
    }

    function queueResize()
    {
        if (ParticleFX.resizeQueued) return;
        ParticleFX.resizeQueued = true;
        requestAnimationFrame(() => {ParticleFX.resizeQueued = false;resizeCanvas();});
    }

    function updateParticle(p, i)
    {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const cx = w / 2;
        const cy = h / 2;
        const pulse = (Math.sin(p.twinkle) + 1) / 2;

        if (p.kind === 'solarDust')
        {
            p.x += p.vx * 0.55;
            p.y += p.vy * 0.55;
            p.vx += Math.sin(p.twinkle + i) * 0.0006;
            p.vy += Math.cos(p.twinkle + i) * 0.0006;
        }

        if (p.kind === 'carreraBurst')
        {
            p.x += p.vx * 1.25;
            p.y += p.vy * 1.25;
            p.vx += Math.cos(p.seedAngle + p.twinkle) * 0.0035;
            p.vy += Math.sin(p.seedAngle + p.twinkle) * 0.0035;
            if (p.burst && pulse > 0.66)
            {
                p.vx += (Math.random() - 0.5) * 0.03;
                p.vy += (Math.random() - 0.5) * 0.03;
            }
        }

        if (p.kind === 'gravityFlicker')
        {
            const dx = cx - p.x;
            const dy = cy - p.y;
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const pull = 0.0045;
            p.vx += (dx / dist) * pull * dist * 0.008;
            p.vy += (dy / dist) * pull * dist * 0.008;
            p.vx += Math.sin(p.twinkle * 0.8 + i) * 0.0017;
            p.vy += Math.cos(p.twinkle * 0.8 + i) * 0.0017;
            p.x += p.vx;
            p.y += p.vy;
        }

        const limit = p.kind === 'carreraBurst' ? 1.8 : p.kind === 'gravityFlicker' ? 0.85 : 0.45;
        p.vx = clamp(p.vx, -limit, limit);
        p.vy = clamp(p.vy, -limit, limit);

        p.twinkle += p.kind === 'carreraBurst' ? 0.06 : p.kind === 'gravityFlicker' ? 0.032 : 0.02;
        p.life += 0.01;

        if (p.x < -40) p.x = w + 40;
        if (p.x > w + 40) p.x = -40;
        if (p.y < -40) p.y = h + 40;
        if (p.y > h + 40) p.y = -40;

        return pulse;
    }

    function drawWaves(ctx, framePulse)
    {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        ParticleFX.gravityWaves.forEach((wave, i) =>
        {
            const radius = wave.radius + Math.sin(ParticleFX.pulseTick * wave.speed + wave.offset) * (10 + i * 3);
            ctx.beginPath();
            ctx.strokeStyle = hexToRgba('#ffea00', wave.alpha + framePulse * 0.04);
            ctx.lineWidth = 1 + i * 0.3;
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();
        });
    }

    function drawParticles()
    {
        const canvas = ParticleFX.canvas;
        const ctx = ParticleFX.ctx;
        if (!canvas || !ctx) return;

        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

        if (!ParticleFX.enabled)
        {
            ParticleFX.rafId = requestAnimationFrame(drawParticles);
            return;
        }

        ctx.globalCompositeOperation = 'lighter';
        ParticleFX.pulseTick += 1;

        const particles = ParticleFX.particles;
        const framePulse = (Math.sin(ParticleFX.pulseTick * 0.02) + 1) / 2;
        drawWaves(ctx, framePulse);

        for (let i = 0; i < particles.length; i++)
        {
            const p = particles[i];
            const pulse = updateParticle(p, i);
            const radius = p.r + pulse * (p.kind === 'carreraBurst' ? 2.2 : 1.2);
            const coreAlpha = p.kind === 'carreraBurst' ? 0.26 : p.kind === 'gravityFlicker' ? 0.16 : 0.14;
            const glowAlpha = p.kind === 'carreraBurst' ? 0.38 : p.kind === 'gravityFlicker' ? 0.22 : 0.18;

            if (p.kind === 'carreraBurst')
            {
                ctx.strokeStyle = hexToRgba(p.color, 0.2 + pulse * 0.35);
                ctx.lineWidth = p.burst ? 2.2 : 1.1;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x - p.vx * 14, p.y - p.vy * 14);
                ctx.stroke();
            }

            ctx.beginPath();
            ctx.fillStyle = hexToRgba('#ffffff', coreAlpha);
            ctx.arc(p.x, p.y, radius + 1.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.fillStyle = hexToRgba(p.color, glowAlpha + pulse * p.alpha * 0.7);
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fill();

            if (p.kind === 'carreraBurst' && p.burst && pulse > 0.56)
            {
                ctx.beginPath();
                ctx.strokeStyle = hexToRgba('#fff9c4', 0.16);
                ctx.lineWidth = 1.3;
                ctx.arc(p.x, p.y, radius * 2.1, 0, Math.PI * 2);
                ctx.stroke();
            }

            if (p.kind === 'gravityFlicker' && pulse > 0.72)
            {
                ctx.beginPath();
                ctx.strokeStyle = hexToRgba('#ffea00', 0.06);
                ctx.lineWidth = 1;
                ctx.arc(p.x, p.y, radius * 3.2, 0, Math.PI * 2);
                ctx.stroke();
            }

            for (let j = i + 1; j < particles.length; j++)
            {
                const q = particles[j];
                const dx = p.x - q.x;
                const dy = p.y - q.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const linkDistance = p.kind === 'carreraBurst' ? 84 : p.kind === 'gravityFlicker' ? 118 : 104;

                if (dist < linkDistance)
                {
                    const linkAlpha = p.kind === 'carreraBurst' ? 0.04 : p.kind === 'gravityFlicker' ? 0.05 : 0.06;
                    ctx.strokeStyle = hexToRgba('#ffd95e', (1 - dist / linkDistance) * linkAlpha);
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(q.x, q.y);
                    ctx.stroke();
                }
            }
        }

        ctx.globalCompositeOperation = 'source-over';
        ParticleFX.rafId = requestAnimationFrame(drawParticles);
    }

    function start()
    {
        if (ParticleFX.running) return;
        if (!ParticleFX.canvas || !ParticleFX.ctx) return;
        ParticleFX.running = true;
        cancelAnimationFrame(ParticleFX.rafId);
        seedParticles();
        drawParticles();
    }

    function stop()
    {
        ParticleFX.running = false;
        cancelAnimationFrame(ParticleFX.rafId);
        ParticleFX.rafId = null;
    }

    function setEnabled(enabled)
    {
        ParticleFX.enabled = !!enabled;
    }

    function attach()
    {
        window.addEventListener('resize', queueResize);
        resizeCanvas();
        start();
    }

    window.ParticleFX = {initCanvas, attach, start, stop, setEnabled, seedParticles, resizeCanvas, queueResize};
})();