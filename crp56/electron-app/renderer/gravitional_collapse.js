/* ============================================================
   GRAVITY COLLAPSE — renderer logic
   - Singularity / accretion-disk canvas with full collapse + explosion sequence
   - Lock state machine (target -> password -> COLLAPSE -> arm -> execute)
   - IPC bridge to Electron main (window.collapseAPI)
   - Degrades to DEMO mode in a plain browser (no real deletion)
   ============================================================ */
(() => {
    "use strict";

    /* ---------- config ---------- */
    const CONFIRM_PHRASE = "COLLAPSE";
    const HAS_API = typeof window !== "undefined" && !!window.collapseAPI;

    /* ---------- element refs ---------- */
    const $ = (id) => document.getElementById(id);
    const stage          = $("collapseStage");
    const readoutPhase   = $("readoutPhase");
    const readoutSub     = $("readoutSub");
    const pathEl         = $("selectedTargetPath");
    const targetCard     = $("targetCard");
    const targetWarning  = $("targetWarning");
    const targetMeta     = $("targetMeta");
    const tmType         = $("tmType");
    const tmItems        = $("tmItems");
    const tmSize         = $("tmSize");

    const pickFolderBtn  = $("pickFolderBtn");
    const pickDriveBtn   = $("pickDriveBtn");
    const clearBtn       = $("clearTargetBtn");

    const wipeMode       = $("wipeMode");
    const pwInput        = $("collapsePassword");
    const confirmInput   = $("collapseConfirm");
    const armBtn         = $("armBtn");
    const executeBtn     = $("executeBtn");
    const abortBtn       = $("abortBtn");

    const progressWrap   = $("collapseProgress");
    const cpFill         = $("cpFill");
    const cpLabel        = $("cpLabel");
    const cpPct          = $("cpPct");
    const cpFile         = $("cpFile");

    const threatFill     = $("threatFill");
    const threatLevel    = $("threatLevel");
    const armChip        = $("armChip");
    const guardChip      = $("guardChip");
    const collapseStatus = $("collapseStatus");

    const stTarget   = $("stTarget");
    const stArm      = $("stArm");
    const stCollapse = $("stCollapse");

    const sealDialog       = $("collapseSealDialog");
    const sealTargetPath   = $("sealTargetPath");
    const sealTargetType   = $("sealTargetType");
    const sealTargetMode   = $("sealTargetMode");
    const sealAcknowledge  = $("sealAcknowledge");
    const sealConfirmBtn   = $("sealConfirmBtn");

    /* ---------- state ---------- */
    const state = {
        target:      null,
        armed:       false,
        collapsing:  false,
        pwVerified:  false,
        pwChecking:  false,
    };

    /* ============================================================
       SINGULARITY CANVAS
       Phases: idle | charge | implode | crush | explode | settle
       ============================================================ */
    const canvas = $("singularityCanvas");
    const ctx    = canvas ? canvas.getContext("2d") : null;
    const DPR    = Math.min(window.devicePixelRatio || 1, 2);
    const MAX_CANVAS_DIM = 8192;

    let cw = 0, ch = 0, raf = 0, intensity = 0.18;
    let ro = null;

    const particles  = [];
    const debris     = [];
    const shockwaves = [];

    /* ---------- sequence state machine ---------- */
    const seq = {
        phase:         "idle",
        phaseStart:    0,
        flash:         0,
        shake:         0,
        manualIntensity: 0.18,
        autoResetAt:   0,
    };

    /* ---------- math helpers ---------- */
    function nowMs()         { return performance.now(); }
    function clamp(v, a, b)  { return Math.max(a, Math.min(b, v)); }
    function lerp(a, b, t)   { return a + (b - a) * clamp(t, 0, 1); }
    function easeOutCubic(t) { t = clamp(t,0,1); return 1 - Math.pow(1-t, 3); }
    function easeInCubic(t)  { t = clamp(t,0,1); return t*t*t; }
    function easeInOut(t)    { t = clamp(t,0,1); return t < 0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
    function rand(a, b)      { return a + Math.random() * (b - a); }
    function center()        { return { cx: cw * 0.5, cy: ch * 0.46 }; }

    /* ---------- canvas resize ---------- */
    function resize()
    {
        if (!canvas || !ctx || !stage) return;

        const r = stage.getBoundingClientRect();
        const nextCw = Math.max(1, Math.floor(r.width));

        let nextCh = Math.floor(r.height);
        if (!Number.isFinite(nextCh) || nextCh <= 0 || nextCh > window.innerHeight * 1.5)
        {
            nextCh = Math.floor(window.innerHeight * 0.62);
        }
        nextCh = Math.max(320, Math.min(nextCh, 900));

        if (nextCw === cw && nextCh === ch) return;

        cw = nextCw;
        ch = nextCh;

        canvas.style.width = cw + "px";
        canvas.style.height = ch + "px";
        canvas.width = Math.floor(cw * DPR);
        canvas.height = Math.floor(ch * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    /* ---------- particle spawners ---------- */
    function spawn(n, bias = 1)
    {
        const { cx, cy } = center();
        const maxR = Math.min(cw, ch) * (0.22 + 0.20 * bias);
        for (let i = 0; i < n; i++)
        {
            const a = Math.random() * Math.PI * 2;
            particles.push({
                x: cx + Math.cos(a) * rand(24, maxR),
                y: cy + Math.sin(a) * rand(24, maxR),
                vx: rand(-0.35, 0.35), vy: rand(-0.35, 0.35),
                life: rand(100, 320), size: rand(0.8, 2.8),
                hue: rand(44, 58), orbit: rand(0.002, 0.01),
            });
        }

    }

    function spawnDebris(count, power = 1)
    {
        const { cx, cy } = center();

        for (let i = 0; i < count; i++)
        {
            const a = Math.random() * Math.PI * 2;
            const speed = rand(2.5, 8.5) * power;
            debris.push({
                x: cx, y: cy,
                vx: Math.cos(a) * speed,
                vy: Math.sin(a) * speed * rand(0.7, 1.15),
                drag: rand(0.965, 0.985),
                size: rand(1.2, 4.2), life: rand(24, 60),
                hue: rand(42, 56), alpha: rand(0.65, 1.0),
            });
        }

    }

    function addShockwave(power = 1)
    {
        shockwaves.push({r: 12, width:  10 + power * 12, alpha:  0.82, speed:  11 + power * 9, max:    Math.max(cw, ch) * (0.62 + power * 0.16),});
    }

    /* ---------- sequence control API (called by UI code) ---------- */

    function resetSequence(toIntensity = 0.18)
    {
        seq.phase = "idle";
        seq.phaseStart = nowMs();
        seq.flash = 0; seq.shake = 0;
        seq.manualIntensity = toIntensity;
        seq.autoResetAt = 0;
    }

    function playCollapseSequence()
    {
        seq.phase = "charge";
        seq.phaseStart = nowMs();
        seq.flash = 0; seq.shake = 0.4;
        seq.autoResetAt = 0;
        if (particles.length < 90) spawn(40, 1.2);
    }

    function holdCrush(progressPct)
    {
        if (seq.phase === "explode" || seq.phase === "settle") {return;}

        const pct = clamp((progressPct || 0) / 100, 0, 1);
        const now = nowMs();

        const inChargeRange = pct < 0.22;
        const inImplodeRange = pct >= 0.22 && pct < 0.62;

        let nextPhase = "crush";

        if (inChargeRange)
        {
            nextPhase = "charge";
        } else if (inImplodeRange)
        {
            nextPhase = "implode";
        }

        if (seq.phase !== nextPhase)
        {
            seq.phase = nextPhase;
            seq.phaseStart = now;
        }
    }

    function triggerExplosion()
    {
        seq.phase = "explode";
        seq.phaseStart = nowMs();
        seq.flash = 1.0; seq.shake = 1.0;
        addShockwave(1.2);
        addShockwave(0.75);
        setTimeout(() => addShockwave(0.55), 120);
        spawnDebris(140, 1.2);
    }

    function playFailureRecover()
    {
        seq.phase = "settle";
        seq.phaseStart = nowMs();
        seq.flash = 0; seq.shake = 0.18;
        seq.autoResetAt = nowMs() + 1400;
    }

    function phaseT(durationMs)
    {
        return clamp((nowMs() - seq.phaseStart) / durationMs, 0, 1);
    }

    function phaseIntensity()
    {
        switch (seq.phase)
        {
            case "idle":    return seq.manualIntensity;
            case "charge":  return lerp(seq.manualIntensity, 0.95, easeInOut(phaseT(900)));
            case "implode": return lerp(0.95, 1.22, easeInCubic(phaseT(700)));
            case "crush":   return 1.26;
            case "explode": return lerp(1.30, 0.88, easeOutCubic(phaseT(700)));
            case "settle":  return lerp(0.82, 0.18, easeOutCubic(phaseT(1700)));
            default:        return seq.manualIntensity;
        }
    }

    function updateSequence()
    {
        switch (seq.phase)
        {
            case "charge":
                if (phaseT(900) >= 1) { seq.phase = "implode"; seq.phaseStart = nowMs(); }
                break;
            case "implode":
                if (phaseT(700) >= 1) { seq.phase = "crush";   seq.phaseStart = nowMs(); }
                break;
            case "explode":
                if (phaseT(700) >= 1)
                {
                    seq.phase = "settle"; seq.phaseStart = nowMs();
                    seq.shake = 0.22;
                }
                break;
            case "settle":
                if (phaseT(1700) >= 1) resetSequence(0.18);
                break;
        }
        if (seq.autoResetAt && nowMs() >= seq.autoResetAt) resetSequence(0.18);

        seq.flash = Math.max(0, seq.flash * 0.88);
        seq.shake = Math.max(0, seq.shake * 0.91);
    }

    function drawBackdrop(cx, cy, v)
    {
        const isExploding = seq.phase === "explode";
        const bg = ctx.createRadialGradient(cx, cy, 16, cx, cy, Math.max(cw, ch) * 0.65);
        bg.addColorStop(0,    `rgba(255,238,150,${0.08 + v * 0.18})`);
        bg.addColorStop(0.18, `rgba(255,196,40,${0.09 + v * (isExploding ? 0.28 : 0.14)})`);
        bg.addColorStop(0.42, "rgba(70,52,8,0.24)");
        bg.addColorStop(0.78, "rgba(10,8,2,0.10)");
        bg.addColorStop(1,    "rgba(0,0,0,0)");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, cw, ch);

        if (seq.phase === "implode" || seq.phase === "crush")
        {
            const vig = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(cw, ch) * 0.52);
            vig.addColorStop(0,    "rgba(0,0,0,0)");
            vig.addColorStop(0.42, "rgba(0,0,0,0.14)");
            vig.addColorStop(1,    "rgba(0,0,0,0.58)");
            ctx.fillStyle = vig;
            ctx.fillRect(0, 0, cw, ch);
        }
    }

    function drawRings(cx, cy, t, v)
    {
        let implodeBias = 0;

        if (seq.phase === "implode" || seq.phase === "crush")
        {
            implodeBias = 1;
        }

        let explodeT = 0;
        if (seq.phase === "explode")
        {
            explodeT = easeOutCubic(phaseT(600));
        }

        for (let i = 0; i < 6; i++)
        {
            const baseR     = Math.min(cw, ch) * (0.10 + i * 0.074);
            const collapse  = 1 - v * 0.16 - implodeBias * 0.26;
            const expand    = 1 + explodeT * (0.12 + i * 0.04);
            const wobble    = 1 + Math.sin(t * (0.9 + i * 0.18)) * (0.008 + v * 0.006);
            const r         = baseR * collapse * expand * wobble;

            const alphaBase = 0.14 + i * 0.055 + v * 0.13;
            const arcStart  = t * (0.16 + i * 0.03) * (1 + v * 2.2);
            const arcLen    = Math.PI * (1.12 + i * 0.17 + implodeBias * 0.22);

            ctx.beginPath();
            ctx.strokeStyle = `rgba(${235+i*4},${190+i*10},${40+i*14},${alphaBase})`;
            ctx.lineWidth   = 1 + i * 1.25 + v * 0.7;
            ctx.shadowBlur  = 18 + i * 6 + v * 26;
            ctx.shadowColor = explodeT > 0.05 ? "rgba(255,244,150,0.65)" : "rgba(255,210,60,0.34)";
            ctx.arc(cx, cy, r, arcStart, arcStart + arcLen);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
    }

    function drawCore(cx, cy, t, v)
    {
        const pulse        = 0.5 + Math.sin(t * (2.2 + v * 3)) * 0.18;
        const implodeBoost = (seq.phase === "implode" || seq.phase === "crush") ? 0.44 : 0;
        const explodeBoost = seq.phase === "explode" ? 0.88 * (1 - phaseT(500)) : 0;
        const coreR        = Math.min(cw, ch) * (0.068 + pulse * 0.010) * (1 + v * 0.32 + implodeBoost + explodeBoost);

        const grad = ctx.createRadialGradient(cx - 16, cy - 16, 2, cx, cy, coreR * 3.9);
        grad.addColorStop(0,    "rgba(255,255,255,0.97)");
        grad.addColorStop(0.05, "rgba(255,250,210,0.94)");
        grad.addColorStop(0.16, "rgb(255 207 74 / 0.97)");
        grad.addColorStop(0.34, "rgba(255,176,20,0.18)");
        grad.addColorStop(1,    "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * 2.9, 0, Math.PI * 2);
        ctx.fill();

        const holeScale = (seq.phase === "implode" || seq.phase === "crush") ? 1.28 : 0.94;
        ctx.fillStyle = "rgba(0,0,0,0.97)";
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * holeScale, 0, Math.PI * 2);
        ctx.fill();
    }

    function updateAndDrawParticles(cx, cy, v)
    {
        const spawnRate = 0.12 + v * 0.46 + (seq.phase === "charge" ? 0.22 : 0);
        if (Math.random() < spawnRate && particles.length < 270) spawn(1 + Math.floor(v * 4), 1.2);

        const strongPull  = seq.phase === "implode" || seq.phase === "crush";
        const explodePush = seq.phase === "explode";
        const explodePct  = explodePush ? (1 - phaseT(500)) : 0;

        for (let i = particles.length - 1; i >= 0; i--)
        {
            const p  = particles[i];
            const dx = cx - p.x, dy = cy - p.y;
            const d  = Math.max(16, Math.hypot(dx, dy));
            const nx = dx / d, ny = dy / d;

            if (strongPull)
            {
                const f  = 0.10 + v * 0.18;
                const tg = p.orbit * 40;
                p.vx += nx * f + (-ny * tg);
                p.vy += ny * f + ( nx * tg);
            } else if (explodePush)
            {
                p.vx -= nx * explodePct * 0.9;
                p.vy -= ny * explodePct * 0.9;
            } else
            {
                const f = (0.018 + v * 0.08) / d * 28;
                p.vx += nx * f; p.vy += ny * f;
            }

            p.vx *= strongPull ? 0.988 : 0.993;
            p.vy *= strongPull ? 0.988 : 0.993;
            p.x  += p.vx; p.y += p.vy;
            p.life -= strongPull ? 1.9 : 1;

            const alpha = Math.max(0, p.life / 300);
            ctx.beginPath();
            ctx.fillStyle  = `hsla(${p.hue},100%,72%,${alpha})`;
            ctx.shadowBlur = strongPull ? 18 : 10;
            ctx.shadowColor = strongPull ? "rgba(255,228,120,0.95)" : "rgba(255,210,80,0.80)";
            ctx.arc(p.x, p.y, p.size * (strongPull ? 1.18 : 1), 0, Math.PI * 2);
            ctx.fill();

            if (p.life <= 0 || d < 8) particles.splice(i, 1);
        }
        ctx.shadowBlur = 0;
    }

    function updateAndDrawShockwaves(cx, cy)
    {
        for (let i = shockwaves.length - 1; i >= 0; i--) {
            const s = shockwaves[i];
            s.r     += s.speed;
            s.alpha *= 0.954;
            s.width *= 0.992;

            ctx.beginPath();
            ctx.arc(cx, cy, s.r, 0, Math.PI * 2);
            ctx.lineWidth   = s.width;
            ctx.strokeStyle = `rgba(255,238,150,${s.alpha})`;
            ctx.shadowBlur  = 26;
            ctx.shadowColor = `rgba(255,224,110,${s.alpha * 0.9})`;
            ctx.stroke();

            if (s.alpha < 0.025 || s.r > s.max) shockwaves.splice(i, 1);
        }
        ctx.shadowBlur = 0;
    }

    function updateAndDrawDebris()
    {
        for (let i = debris.length - 1; i >= 0; i--) {
            const d = debris[i];
            d.vx *= d.drag; d.vy *= d.drag;
            d.x  += d.vx;  d.y  += d.vy;
            d.life  -= 1;
            d.alpha *= 0.972;

            ctx.beginPath();
            ctx.fillStyle   = `hsla(${d.hue},100%,65%,${d.alpha})`;
            ctx.shadowBlur  = 13;
            ctx.shadowColor = `rgba(255,200,80,${d.alpha})`;
            ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
            ctx.fill();

            if (d.life <= 0 || d.alpha < 0.025) debris.splice(i, 1);
        }
        ctx.shadowBlur = 0;
    }

    function drawFlash()
    {
        if (seq.flash < 0.01) return;
        ctx.fillStyle = `rgba(255,250,224,${seq.flash * 0.86})`;
        ctx.fillRect(0, 0, cw, ch);
    }

    /* ---------- main draw loop ---------- */
    function draw()
    {
        if (!ctx) return;
        updateSequence();

        const t  = performance.now() * 0.001;
        const { cx, cy } = center();
        const v  = phaseIntensity();
        const sx = seq.shake > 0.01 ? rand(-5, 5) * seq.shake : 0;
        const sy = seq.shake > 0.01 ? rand(-5, 5) * seq.shake : 0;

        ctx.clearRect(0, 0, cw, ch);
        ctx.save();
        ctx.translate(sx, sy);

        drawBackdrop(cx, cy, v);
        drawRings(cx, cy, t, v);
        drawCore(cx, cy, t, v);
        updateAndDrawParticles(cx, cy, v);
        updateAndDrawShockwaves(cx, cy);
        updateAndDrawDebris();
        drawFlash();

        ctx.restore();
        raf = requestAnimationFrame(draw);
    }

    function setIntensity(v)
    {
        intensity = clamp(v, 0, 1);
        if (seq.phase === "idle") seq.manualIntensity = intensity;
    }

    if (canvas && stage)
    {
        ro = new ResizeObserver(resize);
        ro.observe(stage);
        window.addEventListener("resize", resize);
        resize();
        spawn(48, 1.2);
        resetSequence(0.18);
        draw();
    }

    /* ============================================================
       UI HELPERS
       ============================================================ */
    function setStageState(s) { if (stage) stage.dataset.state = s; }
    function setReadout(phase, sub)
    {
        if (readoutPhase) readoutPhase.textContent = phase;
        if (sub != null && readoutSub) readoutSub.textContent = sub;
    }
    function setStatusCard(card, ok, detail)
    {
        if (!card) return;
        card.dataset.ok = ok ? "true" : "false";
        const d = card.querySelector(".status-detail");
        if (d && detail) d.textContent = detail;
    }
    function setThreat(level, label)
    {
        if (threatFill)  threatFill.style.width = level + "%";
        if (threatLevel) threatLevel.textContent = label;
    }
    function fmtBytes(n)
    {
        if (n == null) return "—";
        const u = ["B","KB","MB","GB","TB"]; let i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return n.toFixed(n < 10 && i > 0 ? 1 : 0) + " " + u[i];
    }

    /* ============================================================
       TARGET HANDLING
       ============================================================ */
    function renderTarget()
    {
        const tg = state.target;
        if (!tg)
        {
            pathEl.textContent = "No target selected";
            targetCard.dataset.blocked = "false";
            targetWarning.dataset.blocked = "false";
            targetWarning.textContent = "Collapse is irreversible. The system drive, the app drive, and protected roots are blocked by the gravity guard.";
            targetMeta.hidden = true;
            setStatusCard(stTarget, false, "Pending");
            setReadout("CORE IDLE", "Select a target to charge the singularity.");
            setStageState("idle");
            setThreat(6, "IDLE");
            setIntensity(0.18);
            updateLockUI();
            return;
        }

        pathEl.textContent    = tg.path;

        if (tg.type === "drive")
        {
            tmType.textContent = "Drive";
        } else
        {
            tmType.textContent = "Folder";
        }

        if (tg.items == null)
        {
            tmItems.textContent = "— items";
        } else
        {
            tmItems.textContent = tg.items + " items";
        }

        if (tg.size == null)
        {
            tmSize.textContent = "— size";
        } else
        {
            tmSize.textContent = fmtBytes(tg.size);
        }

        targetMeta.hidden = false;

        if (tg.blocked)
        {
            targetCard.dataset.blocked    = "true";
            targetWarning.dataset.blocked = "true";
            targetWarning.textContent     = "⛔ Guard blocked this target: " + (tg.reason || "protected path") + ". Pick a folder or a non-system drive.";
            setStatusCard(stTarget, false, "Blocked");
            setReadout("TARGET REJECTED", tg.reason || "Protected path.");
            setStageState("idle");
            setThreat(6, "BLOCKED");
            setIntensity(0.18);
        } else
        {
            targetCard.dataset.blocked    = "false";
            targetWarning.dataset.blocked = "false";
            targetWarning.textContent     = "⚠ This target will be permanently destroyed. There is no recovery.";
            setStatusCard(stTarget, true, "Locked");
            setReadout("TARGET LOCKED", tg.path);
            setStageState("charged");
            setThreat(45, "CHARGED");
            setIntensity(0.45);
        }
        updateLockUI();
    }

    async function pickTarget(kind)
    {
        if (state.collapsing) return;
        let picked = null;

        if (HAS_API)
        {
            picked = await window.collapseAPI.selectTarget(kind);
        } else
        {
            const demo    = kind === "drive" ? "E:\\" : "C:\\Users\\Izm\\Desktop\\DemoFolder";
            const blocked = /^[A-Za-z]:\\?$/.test(demo) && demo.toUpperCase().startsWith("C");
            picked = { path: demo, type: kind, items: 1284, size: 5.4 * 1024 ** 3, blocked, reason: blocked ? "System drive (demo)" : "" };
        }

        if (!picked) return;
        state.target = picked;
        state.armed  = false;
        renderTarget();
    }

    /* ============================================================
       LOCK STATE MACHINE
       ============================================================ */
    function lockSatisfied()
    {
        if (!state.target) return false;
        if (state.target.blocked) return false;
        if (!state.pwVerified) return false;
        return confirmInput.value.trim().toUpperCase() === CONFIRM_PHRASE;


    }

    let pwDebounce = null;
    function scheduleVerify()
    {
        state.pwVerified = false;
        clearTimeout(pwDebounce);
        const candidate = pwInput.value;
        if (!candidate) { updateLockUI(); return; }
        pwDebounce = setTimeout(async () =>
        {
            state.pwChecking = true;
            let ok = false;
            try {
                ok = HAS_API ? await window.collapseAPI.verifyPassword(candidate) : candidate.length > 0;
            } catch { ok = false; }
            state.pwChecking = false;
            if (pwInput.value === candidate) {
                state.pwVerified = !!ok;
                if (!ok) flash(pwInput);
                updateLockUI();
            }
        }, 250);
    }

    function updateLockUI()
    {
        const ready = lockSatisfied();
        armBtn.disabled     = !ready || state.collapsing || state.armed;
        executeBtn.disabled = !state.armed || state.collapsing;

        if (state.collapsing)
        {
            collapseStatus.textContent = "Collapsing target…";
            return;
        }
        if (state.armed)
        {
            armChip.textContent = "ARMED";
            armChip.classList.add("danger-chip");
            armChip.dataset.armed = "true";
            setStatusCard(stArm, true, "Armed");
            setStageState("armed");
            setThreat(92, "MAX");
            setIntensity(0.8);
            setReadout("SEQUENCE ARMED", "Execute to begin the collapse.");
            collapseStatus.textContent = "Armed — awaiting execute";
        } else
        {
            armChip.textContent   = ready ? "Ready to arm" : "Disarmed";
            armChip.dataset.armed = "false";
            setStatusCard(stArm, false, ready ? "Ready" : "Disarmed");
            if (state.target && !state.target.blocked)
            {
                setStageState("charged");
                setThreat(ready ? 60 : 45, ready ? "PRIMED" : "CHARGED");
                setIntensity(ready ? 0.55 : 0.45);
            }
            collapseStatus.textContent = state.target ? (state.target.blocked ? "Target blocked" : "Target locked") : "Awaiting target";
        }
    }

    function arm()
    {
        if (!lockSatisfied()) { flash(armBtn); return; }
        state.armed = true;
        abortBtn.hidden = false;
        updateLockUI();
    }

    function abort()
    {
        state.armed = false;
        abortBtn.hidden = true;
        if (state.collapsing) playFailureRecover();
        if (HAS_API && state.collapsing) window.collapseAPI.abort();
        updateLockUI();
    }

    function flash(el)
    {
        if (!el) return;
        el.animate([{ outline: "2px solid #ffd11a" }, { outline: "2px solid transparent" }], { duration: 500, iterations: 2 });
    }

    /* ============================================================
       EXECUTE COLLAPSE
       ============================================================ */
    function openFinalSeal(tg)
    {
        return new Promise((resolve) =>
        {
            if (!sealDialog)
            {
                resolve(true);
                return;
            }

            sealTargetPath.textContent = tg?.path || "No target selected";
            sealTargetType.textContent = tg?.type === "drive" ? "Drive target" : "Folder target";
            sealTargetMode.textContent = "Mode: " + wipeMode.value.toUpperCase();
            sealAcknowledge.checked = false;
            sealConfirmBtn.disabled = true;

            const onCheck = () => {sealConfirmBtn.disabled = !sealAcknowledge.checked;};

            const onClose = () =>
            {
                sealAcknowledge.removeEventListener("change", onCheck);
                sealDialog.removeEventListener("close", onClose);
                resolve(sealDialog.returnValue === "confirm" && sealAcknowledge.checked);
            };

            sealAcknowledge.addEventListener("change", onCheck);
            sealDialog.addEventListener("close", onClose, { once: true });

            if (typeof sealDialog.showModal === "function")
            {
                sealDialog.showModal();
            } else
            {
                resolve(window.confirm("Final seal: release the collapse?"));
            }
        });
    }

    async function execute()
    {
        if (!state.armed || state.collapsing) return;
        const tg = state.target;
        if (!tg || tg.blocked) return;

        let ok = true;
        if (HAS_API)
        {
            ok = await window.collapseAPI.confirmDestroy(tg.path, wipeMode.value);
        } else
        {
            ok = window.confirm(`DEMO: permanently collapse "${tg.path}"?\n(No files are touched in browser preview.)`);
        }
        if (!ok) return;

        const finalSealOk = await openFinalSeal(tg);
        if (!finalSealOk)
        {
            flash(executeBtn);
            return;
        }

        state.collapsing = true;
        abortBtn.hidden = false;
        setStageState("collapsing");
        setReadout("COLLAPSING", "Field pressure rising…");
        setThreat(100, "CRITICAL");
        setIntensity(1);
        progressWrap.hidden = false;
        playCollapseSequence();
        updateLockUI();
        setStatusCard(stCollapse, false, "Collapsing");

        try
        {
            if (HAS_API)
            {
                await window.collapseAPI.run({ path: tg.path, type: tg.type, mode: wipeMode.value, password: pwInput.value }, onProgress);
            } else
            {
                await demoRun();
            }
            onDone(true);
        } catch (err)
        {
            onDone(false, err && err.message ? err.message : String(err));
        }
    }

    function onProgress(p)
    {
        const pct = Math.round(p.pct != null ? p.pct : (p.total ? (p.done / p.total) * 100 : 0));
        cpFill.style.width = pct + "%";
        cpPct.textContent  = pct + "%";
        if (p.phase)   cpLabel.textContent = p.phase;
        if (p.current) cpFile.textContent  = p.current;
        holdCrush(pct);
        setReadout("COLLAPSING", (p.phase || "Crushing") + " · " + pct + "%");
    }

    function onDone(success, errMsg)
    {
        state.collapsing = false;
        state.armed      = false;
        abortBtn.hidden  = true;

        if (success)
        {
            triggerExplosion();

            cpFill.style.width = "100%";
            cpPct.textContent  = "100%";
            cpLabel.textContent = "Collapse complete";
            cpFile.textContent  = state.target ? state.target.path + " erased" : "";

            setStageState("done");
            setReadout("SINGULARITY STABLE", "Target erased. Field collapsed.");
            setStatusCard(stCollapse, true, "Erased");
            setThreat(0, "EMPTY");
            setIntensity(0.25);
            collapseStatus.textContent = "Collapse complete";
            state.target = null;

            setTimeout(() => { progressWrap.hidden = true; renderTarget(); }, 2600);
        } else
        {
            playFailureRecover();

            setStageState("charged");
            setReadout("COLLAPSE FAILED", errMsg || "Aborted.");
            setStatusCard(stCollapse, false, "Failed");
            cpLabel.textContent    = "Failed: " + (errMsg || "aborted");
            collapseStatus.textContent = "Collapse failed";
            setTimeout(() => { progressWrap.hidden = true; }, 2600);
        }
        updateLockUI();
    }

    function demoRun()
    {
        return new Promise((resolve) =>
        {
            let pct = 0;
            const phases = ["Sealing field", "Overwriting", "Crushing", "Erasing"];
            const id = setInterval(() =>
            {
                pct += rand(2, 7);
                if (pct >= 100) { pct = 100; clearInterval(id); resolve(); }
                onProgress({
                    pct,
                    phase:   phases[Math.min(phases.length - 1, Math.floor(pct / 26))],
                    current: "demo/file_" + Math.floor(pct) + ".bin",
                });
            }, 180);
        });
    }

    /* ============================================================
       WIRE EVENTS
       ============================================================ */
    pickFolderBtn && pickFolderBtn.addEventListener("click", () => pickTarget("folder"));
    pickDriveBtn  && pickDriveBtn.addEventListener("click", () => pickTarget("drive"));
    clearBtn      && clearBtn.addEventListener("click", () => {state.target = null; state.armed = false; renderTarget();});

    pwInput && pwInput.addEventListener("input", () => {state.armed = false; armChip.dataset.armed = "false"; scheduleVerify();});
    confirmInput && confirmInput.addEventListener("input", () => {state.armed = false; armChip.dataset.armed = "false"; updateLockUI();});
    wipeMode && wipeMode.addEventListener("change", updateLockUI);

    armBtn     && armBtn.addEventListener("click", arm);
    executeBtn && executeBtn.addEventListener("click", execute);
    abortBtn   && abortBtn.addEventListener("click", abort);

    if (HAS_API && window.collapseAPI.guardStatus)
    {
        window.collapseAPI.guardStatus().then((on) =>
        {
            guardChip.textContent  = "System guard: " + (on ? "ON" : "OFF");
            guardChip.dataset.guard = on ? "on" : "off";
        }).catch(() => {});
    } else
    {
        guardChip.textContent   = HAS_API ? "System guard: ON" : "Demo mode (no IPC)";
        if (!HAS_API) guardChip.dataset.guard = "off";
    }

    renderTarget();
    window.addEventListener("beforeunload", () =>
    {
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        window.removeEventListener("resize", resize);
    });

})();