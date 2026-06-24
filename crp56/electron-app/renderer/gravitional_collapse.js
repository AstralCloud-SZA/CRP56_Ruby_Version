
(() => {
    "use strict";

    /* ---------- config ---------- */
    const PASSWORD = "carrera";          // change to taste, or wire to settings
    const CONFIRM_PHRASE = "COLLAPSE";

    const HAS_API = typeof window !== "undefined" && !!window.collapseAPI;

    /* ---------- element refs ---------- */
    const $ = (id) => document.getElementById(id);
    const stage         = $("collapseStage");
    const readoutPhase  = $("readoutPhase");
    const readoutSub    = $("readoutSub");
    const pathEl        = $("selectedTargetPath");
    const targetCard    = $("targetCard");
    const targetWarning = $("targetWarning");
    const targetMeta    = $("targetMeta");
    const tmType        = $("tmType");
    const tmItems       = $("tmItems");
    const tmSize        = $("tmSize");

    const pickFolderBtn = $("pickFolderBtn");
    const pickDriveBtn  = $("pickDriveBtn");
    const clearBtn      = $("clearTargetBtn");

    const wipeMode      = $("wipeMode");
    const pwInput       = $("collapsePassword");
    const confirmInput  = $("collapseConfirm");
    const armBtn        = $("armBtn");
    const executeBtn    = $("executeBtn");
    const abortBtn      = $("abortBtn");

    const progressWrap  = $("collapseProgress");
    const cpFill        = $("cpFill");
    const cpLabel       = $("cpLabel");
    const cpPct         = $("cpPct");
    const cpFile        = $("cpFile");

    const threatFill    = $("threatFill");
    const threatLevel   = $("threatLevel");
    const armChip       = $("armChip");
    const guardChip     = $("guardChip");
    const collapseStatus= $("collapseStatus");

    const stTarget   = $("stTarget");
    const stArm      = $("stArm");
    const stCollapse = $("stCollapse");

    /* ---------- state ---------- */
    const state = {
        target: null,      // { path, type:'folder'|'drive', items, size, blocked, reason }
        armed: false,
        collapsing: false,
    };

    /* ============================================================
       SINGULARITY CANVAS
       ============================================================ */
    const canvas = $("singularityCanvas");
    const ctx = canvas ? canvas.getContext("2d") : null;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let cw = 0, ch = 0, raf = 0, intensity = 0.18; // 0..1 collapse intensity
    const particles = [];

    function resize() {
        if (!canvas) return;
        const r = canvas.getBoundingClientRect();
        cw = Math.max(1, Math.floor(r.width));
        ch = Math.max(1, Math.floor(r.height));
        canvas.width = Math.floor(cw * DPR);
        canvas.height = Math.floor(ch * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    const rand = (a, b) => a + Math.random() * (b - a);

    function spawn(n) {
        const cx = cw * 0.5, cy = ch * 0.46;
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const rad = rand(20, Math.min(cw, ch) * 0.42);
            particles.push({
                x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad,
                vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3),
                life: rand(120, 300), size: rand(0.8, 2.4), hue: rand(18, 52),
            });
        }
    }

    function draw() {
        if (!ctx) return;
        ctx.clearRect(0, 0, cw, ch);
        const cx = cw * 0.5, cy = ch * 0.46, t = performance.now() * 0.001;
        const pull = 0.025 + intensity * 0.12;

        // backdrop glow
        const bg = ctx.createRadialGradient(cx, cy, 16, cx, cy, Math.max(cw, ch) * 0.55);
        bg.addColorStop(0, `rgba(255,209,126,${0.08 + intensity * 0.12})`);
        bg.addColorStop(0.18, "rgba(194,88,30,0.10)");
        bg.addColorStop(0.42, "rgba(40,18,8,0.22)");
        bg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);

        // accretion rings
        for (let i = 0; i < 5; i++) {
            const baseR = Math.min(cw, ch) * (0.10 + i * 0.085);
            const r = baseR * (1 - intensity * 0.18) * (1 + Math.sin(t * (0.8 + i * 0.12)) * 0.008);
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${160 + i * 18},${90 + i * 18},${40 + i * 10},${0.18 + i * 0.07 + intensity * 0.1})`;
            ctx.lineWidth = 1 + i * 1.3;
            ctx.shadowBlur = 16 + i * 5 + intensity * 20;
            ctx.shadowColor = "rgba(255,170,80,0.28)";
            const spin = (1.2 + i * 0.18) * (1 + intensity * 2);
            ctx.arc(cx, cy, r, t * (0.12 + i * 0.03) * (1 + intensity * 3), t * spin + Math.PI * 1.7);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;

        // core
        const pulse = 0.5 + Math.sin(t * 2.2) * 0.18;
        const coreR = Math.min(cw, ch) * (0.07 + pulse * 0.008) * (1 + intensity * 0.4);
        const core = ctx.createRadialGradient(cx - 16, cy - 16, 2, cx, cy, coreR * 3.6);
        core.addColorStop(0, "rgba(255,255,255,0.9)");
        core.addColorStop(0.08, "rgba(255,244,210,0.86)");
        core.addColorStop(0.22, "rgba(255,180,92,0.26)");
        core.addColorStop(0.42, "rgba(190,72,28,0.12)");
        core.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, coreR * 2.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.95)"; ctx.beginPath(); ctx.arc(cx, cy, coreR * 0.9, 0, Math.PI * 2); ctx.fill();

        // particles
        const spawnRate = 0.18 + intensity * 0.6;
        if (Math.random() < spawnRate && particles.length < 200) spawn(1 + Math.floor(intensity * 3));
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            const dx = cx - p.x, dy = cy - p.y;
            const d = Math.max(30, Math.hypot(dx, dy));
            const f = pull / d;
            p.vx += dx * f; p.vy += dy * f;
            p.vx *= 0.992; p.vy *= 0.992;
            p.x += p.vx; p.y += p.vy; p.life -= 1;
            ctx.beginPath();
            ctx.fillStyle = `hsla(${p.hue},100%,72%,${Math.max(0, p.life / 300)})`;
            ctx.shadowBlur = 10; ctx.shadowColor = "rgba(255,190,90,0.8)";
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
            if (p.life <= 0 || d < coreR * 0.9) particles.splice(i, 1);
        }
        ctx.shadowBlur = 0;
        raf = requestAnimationFrame(draw);
    }

    function setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); }

    if (canvas) {
        const ro = new ResizeObserver(resize);
        ro.observe(canvas);
        resize();
        spawn(40);
        draw();
    }

    /* ============================================================
       UI HELPERS
       ============================================================ */
    function setStageState(s) { if (stage) stage.dataset.state = s; }
    function setReadout(phase, sub) {
        if (readoutPhase) readoutPhase.textContent = phase;
        if (sub != null && readoutSub) readoutSub.textContent = sub;
    }
    function setStatusCard(card, ok, detail) {
        if (!card) return;
        card.dataset.ok = ok ? "true" : "false";
        const d = card.querySelector(".status-detail");
        if (d && detail) d.textContent = detail;
    }
    function setThreat(level, label) {
        if (threatFill) threatFill.style.width = level + "%";
        if (threatLevel) threatLevel.textContent = label;
    }
    function fmtBytes(n) {
        if (n == null) return "—";
        const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return n.toFixed(n < 10 && i > 0 ? 1 : 0) + " " + u[i];
    }

    /* ============================================================
       TARGET HANDLING
       ============================================================ */
    function renderTarget() {
        const tg = state.target;
        if (!tg) {
            pathEl.textContent = "No target selected";
            targetCard.dataset.blocked = "false";
            targetWarning.dataset.blocked = "false";
            targetWarning.textContent =
                "Collapse is irreversible. The system drive, the app drive, and protected roots are blocked by the gravity guard.";
            targetMeta.hidden = true;
            setStatusCard(stTarget, false, "Pending");
            setReadout("CORE IDLE", "Select a target to charge the singularity.");
            setStageState("idle");
            setThreat(6, "IDLE");
            setIntensity(0.18);
            updateLockUI();
            return;
        }

        pathEl.textContent = tg.path;
        tmType.textContent = tg.type === "drive" ? "Drive" : "Folder";
        tmItems.textContent = tg.items != null ? tg.items + " items" : "— items";
        tmSize.textContent = tg.size != null ? fmtBytes(tg.size) : "— size";
        targetMeta.hidden = false;

        if (tg.blocked) {
            targetCard.dataset.blocked = "true";
            targetWarning.dataset.blocked = "true";
            targetWarning.textContent = "⛔ Guard blocked this target: " + (tg.reason || "protected path") +
                ". Pick a folder or a non-system drive.";
            setStatusCard(stTarget, false, "Blocked");
            setReadout("TARGET REJECTED", tg.reason || "Protected path.");
            setStageState("idle");
            setThreat(6, "BLOCKED");
            setIntensity(0.18);
        } else {
            targetCard.dataset.blocked = "false";
            targetWarning.dataset.blocked = "false";
            targetWarning.textContent = "⚠ This target will be permanently destroyed. There is no recovery.";
            setStatusCard(stTarget, true, "Locked");
            setReadout("TARGET LOCKED", tg.path);
            setStageState("charged");
            setThreat(45, "CHARGED");
            setIntensity(0.45);
        }
        updateLockUI();
    }

    async function pickTarget(kind) {
        if (state.collapsing) return;
        let picked = null;

        if (HAS_API) {
            picked = await window.collapseAPI.selectTarget(kind); // {path,type,items,size,blocked,reason} or null
        } else {
            // DEMO mode (plain browser): fake a target so you can preview the UI
            const demo = kind === "drive" ? "E:\\" : "C:\\Users\\Izm\\Desktop\\DemoFolder";
            const blocked = /^[A-Za-z]:\\?$/.test(demo) && demo.toUpperCase().startsWith("C");
            picked = { path: demo, type: kind, items: 1284, size: 5.4 * 1024 ** 3, blocked, reason: blocked ? "System drive (demo)" : "" };
        }

        if (!picked) return;
        state.target = picked;
        state.armed = false;
        renderTarget();
    }

    /* ============================================================
       LOCK STATE MACHINE
       ============================================================ */
    function lockSatisfied() {
        return !!state.target &&
            !state.target.blocked &&
            pwInput.value === PASSWORD &&
            confirmInput.value.trim().toUpperCase() === CONFIRM_PHRASE;
    }

    function updateLockUI() {
        const ready = lockSatisfied();
        armBtn.disabled = !ready || state.collapsing || state.armed;
        executeBtn.disabled = !state.armed || state.collapsing;

        if (state.collapsing) {
            collapseStatus.textContent = "Collapsing target…";
            return;
        }
        if (state.armed) {
            armChip.textContent = "ARMED";
            armChip.classList.add("danger-chip");
            armChip.dataset.armed = "true";
            setStatusCard(stArm, true, "Armed");
            setStageState("armed");
            setThreat(92, "MAX");
            setIntensity(0.8);
            setReadout("SEQUENCE ARMED", "Execute to begin the collapse.");
            collapseStatus.textContent = "Armed — awaiting execute";
        } else {
            armChip.textContent = ready ? "Ready to arm" : "Disarmed";
            armChip.dataset.armed = "false";
            setStatusCard(stArm, false, ready ? "Ready" : "Disarmed");
            if (state.target && !state.target.blocked) {
                setStageState("charged");
                setThreat(ready ? 60 : 45, ready ? "PRIMED" : "CHARGED");
                setIntensity(ready ? 0.55 : 0.45);
            }
            collapseStatus.textContent = state.target
                ? (state.target.blocked ? "Target blocked" : "Target locked")
                : "Awaiting target";
        }
    }

    function arm() {
        if (!lockSatisfied()) { flash(armBtn); return; }
        state.armed = true;
        abortBtn.hidden = false;
        updateLockUI();
    }

    function abort() {
        state.armed = false;
        abortBtn.hidden = true;
        if (HAS_API && state.collapsing) window.collapseAPI.abort();
        updateLockUI();
    }

    function flash(el) {
        if (!el) return;
        el.animate(
            [{ outline: "2px solid #ff5a3c" }, { outline: "2px solid transparent" }],
            { duration: 500, iterations: 2 }
        );
    }

    /* ============================================================
       EXECUTE COLLAPSE
       ============================================================ */
    async function execute() {
        if (!state.armed || state.collapsing) return;
        const tg = state.target;
        if (!tg || tg.blocked) return;

        // Final OS-level confirm (native dialog if available)
        let ok = true;
        if (HAS_API) {
            ok = await window.collapseAPI.confirmDestroy(tg.path, wipeMode.value);
        } else {
            ok = window.confirm(`DEMO: permanently collapse "${tg.path}"?\n(No files are touched in browser preview.)`);
        }
        if (!ok) { return; }

        state.collapsing = true;
        abortBtn.hidden = false;
        setStageState("collapsing");
        setReadout("COLLAPSING", "Field pressure rising…");
        setThreat(100, "CRITICAL");
        setIntensity(1);
        progressWrap.hidden = false;
        updateLockUI();
        setStatusCard(stCollapse, false, "Collapsing");

        try {
            if (HAS_API) {
                await window.collapseAPI.run(
                    { path: tg.path, type: tg.type, mode: wipeMode.value },
                    onProgress
                );
            } else {
                await demoRun();
            }
            onDone(true);
        } catch (err) {
            onDone(false, err && err.message ? err.message : String(err));
        }
    }

    function onProgress(p) {
        // p: { pct, current, done, total, phase }
        const pct = Math.round(p.pct != null ? p.pct : (p.total ? (p.done / p.total) * 100 : 0));
        cpFill.style.width = pct + "%";
        cpPct.textContent = pct + "%";
        if (p.phase) cpLabel.textContent = p.phase;
        if (p.current) cpFile.textContent = p.current;
        setReadout("COLLAPSING", (p.phase || "Crushing") + " · " + pct + "%");
    }

    function onDone(success, errMsg) {
        state.collapsing = false;
        state.armed = false;
        abortBtn.hidden = true;
        if (success) {
            cpFill.style.width = "100%";
            cpPct.textContent = "100%";
            cpLabel.textContent = "Collapse complete";
            cpFile.textContent = state.target ? state.target.path + " erased" : "";
            setStageState("done");
            setReadout("SINGULARITY STABLE", "Target erased. Field collapsed.");
            setStatusCard(stCollapse, true, "Erased");
            setThreat(0, "EMPTY");
            setIntensity(0.25);
            collapseStatus.textContent = "Collapse complete";
            state.target = null;
            setTimeout(() => { progressWrap.hidden = true; renderTarget(); }, 2600);
        } else {
            setStageState("charged");
            setReadout("COLLAPSE FAILED", errMsg || "Aborted.");
            setStatusCard(stCollapse, false, "Failed");
            cpLabel.textContent = "Failed: " + (errMsg || "aborted");
            collapseStatus.textContent = "Collapse failed";
            setTimeout(() => { progressWrap.hidden = true; }, 2600);
        }
        updateLockUI();
    }

    // DEMO fake progress
    function demoRun() {
        return new Promise((resolve) => {
            let pct = 0;
            const phases = ["Sealing field", "Overwriting", "Crushing", "Erasing"];
            const id = setInterval(() => {
                pct += rand(2, 7);
                if (pct >= 100) { pct = 100; clearInterval(id); resolve(); }
                onProgress({ pct, phase: phases[Math.min(phases.length - 1, Math.floor(pct / 26))], current: "demo/file_" + Math.floor(pct) + ".bin" });
            }, 180);
        });
    }

    /* ============================================================
       WIRE EVENTS
       ============================================================ */
    pickFolderBtn && pickFolderBtn.addEventListener("click", () => pickTarget("folder"));
    pickDriveBtn  && pickDriveBtn.addEventListener("click", () => pickTarget("drive"));
    clearBtn      && clearBtn.addEventListener("click", () => { state.target = null; state.armed = false; renderTarget(); });

    [pwInput, confirmInput].forEach((el) => el && el.addEventListener("input", () => { state.armed = false; armChip.dataset.armed = "false"; updateLockUI(); }));
    wipeMode && wipeMode.addEventListener("change", updateLockUI);

    armBtn     && armBtn.addEventListener("click", arm);
    executeBtn && executeBtn.addEventListener("click", execute);
    abortBtn   && abortBtn.addEventListener("click", abort);

    // guard chip reflects whether main reports guard on
    if (HAS_API && window.collapseAPI.guardStatus) {
        window.collapseAPI.guardStatus().then((on) => {
            guardChip.textContent = "System guard: " + (on ? "ON" : "OFF");
            guardChip.dataset.guard = on ? "on" : "off";
        }).catch(() => {});
    } else {
        guardChip.textContent = HAS_API ? "System guard: ON" : "Demo mode (no IPC)";
        if (!HAS_API) guardChip.dataset.guard = "off";
    }

    // init
    renderTarget();
    window.addEventListener("beforeunload", () => raf && cancelAnimationFrame(raf));
})();