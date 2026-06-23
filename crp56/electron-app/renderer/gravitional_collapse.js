(() => {
    const canvas = document.getElementById('singularityCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, raf = 0;
    const particles = [];
    const sparks = [];

    function resize() {
        const rect = canvas.getBoundingClientRect();
        w = Math.max(1, Math.floor(rect.width));
        h = Math.max(1, Math.floor(rect.height));
        canvas.width = Math.floor(w * DPR);
        canvas.height = Math.floor(h * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    function rand(min, max) {
        return min + Math.random() * (max - min);
    }

    function spawnParticle() {
        const a = Math.random() * Math.PI * 2;
        const r = rand(20, Math.min(w, h) * 0.38);
        particles.push({
            x: w * 0.5 + Math.cos(a) * r,
            y: h * 0.5 + Math.sin(a) * r,
            vx: rand(-0.25, 0.25),
            vy: rand(-0.25, 0.25),
            life: rand(140, 320),
            size: rand(0.8, 2.3),
            hue: rand(20, 55)
        });
    }

    function spawnSpark() {
        const a = Math.random() * Math.PI * 2;
        sparks.push({
            angle: a,
            radius: rand(70, Math.min(w, h) * 0.35),
            speed: rand(0.006, 0.018) * (Math.random() > 0.5 ? 1 : -1),
            life: rand(50, 120),
            size: rand(1, 2.6)
        });
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        const cx = w * 0.5;
        const cy = h * 0.48;
        const t = performance.now() * 0.001;

        const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.55);
        bg.addColorStop(0, 'rgba(255, 209, 126, 0.10)');
        bg.addColorStop(0.18, 'rgba(194, 88, 30, 0.10)');
        bg.addColorStop(0.42, 'rgba(40, 18, 8, 0.22)');
        bg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        for (let i = 0; i < 5; i++) {
            const r = Math.min(w, h) * (0.10 + i * 0.085) * (1 + Math.sin(t * (0.8 + i * 0.12)) * 0.008);
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${160 + i * 18}, ${90 + i * 18}, ${40 + i * 10}, ${0.18 + i * 0.07})`;
            ctx.lineWidth = 1 + i * 1.3;
            ctx.shadowBlur = 16 + i * 5;
            ctx.shadowColor = 'rgba(255, 170, 80, 0.28)';
            ctx.arc(cx, cy, r, t * (0.12 + i * 0.03), t * (1.2 + i * 0.18) + Math.PI * 1.7);
            ctx.stroke();
        }

        ctx.shadowBlur = 0;
        const corePulse = 0.5 + Math.sin(t * 2.2) * 0.18;
        const coreR = Math.min(w, h) * (0.075 + corePulse * 0.008);
        const core = ctx.createRadialGradient(cx - 18, cy - 18, 2, cx, cy, coreR * 3.6);
        core.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        core.addColorStop(0.08, 'rgba(255, 244, 210, 0.86)');
        core.addColorStop(0.22, 'rgba(255, 180, 92, 0.26)');
        core.addColorStop(0.42, 'rgba(190, 72, 28, 0.12)');
        core.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * 2.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(0,0,0,0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * 0.9, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 205, 130, 0.12)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 12; i++) {
            const a = t * 0.4 + i * (Math.PI * 2 / 12);
            const x1 = cx + Math.cos(a) * coreR * 1.25;
            const y1 = cy + Math.sin(a) * coreR * 1.25;
            const x2 = cx + Math.cos(a) * (coreR * 2.1 + 12 * Math.sin(t * 3 + i));
            const y2 = cy + Math.sin(a) * (coreR * 2.1 + 12 * Math.cos(t * 2 + i));
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

        if (Math.random() < 0.22 && particles.length < 120) spawnParticle();
        if (Math.random() < 0.06 && sparks.length < 42) spawnSpark();

        particles.forEach((p, idx) => {
            const dx = cx - p.x;
            const dy = cy - p.y;
            const d = Math.max(35, Math.hypot(dx, dy));
            const pull = 0.03 / d;
            p.vx += dx * pull;
            p.vy += dy * pull;
            p.vx *= 0.992;
            p.vy *= 0.992;
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 1;
            ctx.beginPath();
            ctx.fillStyle = `hsla(${p.hue}, 100%, 72%, ${Math.max(0, p.life / 320)})`;
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(255, 190, 90, 0.8)';
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            if (p.life <= 0 || p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) particles.splice(idx, 1);
        });

        sparks.forEach((s, idx) => {
            s.angle += s.speed;
            s.life -= 1;
            const x = cx + Math.cos(s.angle) * s.radius;
            const y = cy + Math.sin(s.angle) * s.radius;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(255, ${190 + (idx % 20)}, 120, ${Math.max(0, s.life / 120)})`;
            ctx.lineWidth = s.size;
            ctx.shadowBlur = 14;
            ctx.shadowColor = 'rgba(255, 165, 74, 0.9)';
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(s.angle + 0.16) * 10, y + Math.sin(s.angle + 0.16) * 10);
            ctx.stroke();
            if (s.life <= 0) sparks.splice(idx, 1);
        });

        ctx.globalCompositeOperation = 'screen';
        const halo = ctx.createRadialGradient(cx, cy, coreR, cx, cy, coreR * 8);
        halo.addColorStop(0, 'rgba(255, 170, 78, 0.10)');
        halo.addColorStop(0.2, 'rgba(255, 120, 40, 0.08)');
        halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        raf = requestAnimationFrame(draw);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    draw();
})();