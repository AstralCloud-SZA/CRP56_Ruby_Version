const output = document.getElementById('output');
const themeStylesheet = document.getElementById('themeStylesheet');
const themeName = document.getElementById('themeName');
const themeNameCard = document.getElementById('themeNameCard');
const themeToggle = document.getElementById('themeToggle');
const progressFill = document.querySelector('.progress-fill');
const html = document.documentElement;
const body = document.body;

const ENCRYPTED_EXTENSION = '.crp56';
const THEME_STORAGE_KEY = 'crp56-theme';
const PARTICLE_STORAGE_KEY = 'crp56-particles';
const SFX_VOL_STORAGE_KEY = 'crp56-sfx-volume';
const MUSIC_VOL_STORAGE_KEY = 'crp56-music-volume';

// State for File/Folder selections
let selectedFiles = [];
let selectedFolder = null;

// Progress bar state
let progressResetTimer = null;

// Particle state
let particlesEnabled = true;

/* --- SOUND EFFECTS HELPER --- */
// Safe trigger: no-op if the FMOD bridge isn't present, plus a small per-category
// throttle so machine-gun clicks don't stack a wall of overlapping sounds.
const SFX_THROTTLE_MS = 60;
const lastSfxAt = {};
function sfx(category)
{
    if (!window.sfx || typeof window.sfx.play !== 'function') return;
    const now = Date.now();
    if (now - (lastSfxAt[category] || 0) < SFX_THROTTLE_MS) return;
    lastSfxAt[category] = now;
    window.sfx.play(category);
}

const THEMES = {
    'primordial-gold': {
        label: 'Primordial Gold',
        href: './primordial_gold.css'
    },
    'hellflare-gold': {
        label: 'Hellflare Gold',
        href: './hellflare_gold.css'
    }
};

/* --- BACKGROUND SLIDE SYSTEM --- */

const BG_IMAGES = {
    'primordial-gold': [
        '../BG_images/bg1.jpg',
        '../BG_images/bg3.jpg',
        '../BG_images/bg5.jpg',
        '../BG_images/bg7.jpg'
    ],
    'hellflare-gold': [
        '../BG_images/bg2.jpg',
        '../BG_images/bg4.png',
        '../BG_images/bg6.jpg'
    ]
};

const BG_INTERVAL_MS = 12000;

let bgSlidesHost = null;
let bgCurrentIndex = -1;
let bgTimerId = null;

function initBackgroundHost()
{
    bgSlidesHost = document.querySelector('.bg-slides');
}

function showNextSlide(theme)
{
    if (!bgSlidesHost) return;

    const list = BG_IMAGES[theme] || [];
    if (!list.length) return;

    bgCurrentIndex = (bgCurrentIndex + 1) % list.length;
    const url = list[bgCurrentIndex];

    const slide = document.createElement('div');
    slide.className = 'bg-slide';
    slide.style.backgroundImage = `url("${url}")`;
    bgSlidesHost.appendChild(slide);

    // Trigger fade-in on next paint
    requestAnimationFrame(() =>
    {
        requestAnimationFrame(() => slide.classList.add('visible'));
    });

    // Fade out and remove all older slides
    bgSlidesHost.querySelectorAll('.bg-slide').forEach((el) =>
    {
        if (el === slide) return;
        el.classList.remove('visible');
        el.addEventListener('transitionend', () =>
        {
            if (el.parentNode === bgSlidesHost) el.remove();
        }, { once: true });
    });
}

function startBackgroundLoop(theme)
{
    if (bgTimerId)
    {
        clearInterval(bgTimerId);
        bgTimerId = null;
    }

    bgCurrentIndex = -1;
    showNextSlide(theme);

    bgTimerId = setInterval(() =>
    {
        showNextSlide(html.dataset.theme || theme);
    }, BG_INTERVAL_MS);
}

/* --- END BACKGROUND SLIDE SYSTEM --- */

function log(...args)
{
    console.log('[CRP56 renderer]', ...args);
}

function show(data)
{
    if (!output) return;
    output.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function baseName(fullPath)
{
    return String(fullPath).split(/[\\/]/).pop();
}

function ensureCrp56Extension(filePath)
{
    if (!filePath) return filePath;
    return filePath.toLowerCase().endsWith(ENCRYPTED_EXTENSION) ? filePath : filePath + ENCRYPTED_EXTENSION;
}

function toCrp56Name(fileName)
{
    const name = String(fileName);
    const stem = name.replace(/\.[^./\\]+$/, '');
    return `${stem || name}${ENCRYPTED_EXTENSION}`;
}

function setTheme(theme)
{
    if (!THEMES[theme]) return;
    html.dataset.theme = theme;
    if (themeStylesheet) themeStylesheet.setAttribute('href', THEMES[theme].href);
    if (themeName) themeName.textContent = THEMES[theme].label;
    if (themeNameCard) themeNameCard.textContent = THEMES[theme].label;
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (_) {}
    seedParticles();
    startBackgroundLoop(theme); // restarts the slideshow with the correct image set
}

function savedTheme()
{
    try
    {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored && THEMES[stored]) return stored;
    } catch (_) {}
    return null;
}

/* --- REAL PROGRESS BAR --- */

function setProgress(percent)
{
    if (!progressFill) return;
    const clamped = Math.max(0, Math.min(100, percent));
    progressFill.style.width = `${clamped}%`;
}

function startProgress(label = '')
{
    if (progressResetTimer)
    {
        clearTimeout(progressResetTimer);
        progressResetTimer = null;
    }

    if (progressFill) progressFill.style.opacity = '1';
    setProgress(2);
    show({ status: label ? `Running ${label}...` : 'Working...' });
}

function finishProgress()
{
    setProgress(100);
    progressResetTimer = setTimeout(() =>
    {
        setProgress(0);
        if (progressFill) progressFill.style.opacity = '0.18';
        progressResetTimer = null;
    }, 750);
}

function bindProgressEvents()
{
    if (!window.crp56 || typeof window.crp56.onProgress !== 'function') return;

    window.crp56.onProgress((msg) =>
    {
        if (!msg || msg.event !== 'progress' || !msg.total) return;
        const percent = Math.round((msg.current / msg.total) * 100);
        setProgress(percent);

        const detail = msg.detail ? ` — ${msg.detail}` : '';
        show({ status: `${msg.stage}: ${msg.current}/${msg.total} (${percent}%)${detail}` });
    });
}

async function runAction(label, fn)
{
    try
    {
        log('Running action:', label);
        startProgress(label);
        const result = await fn();
        show(result);
        // Audio feedback for EVERY operation flowing through here:
        // failure -> error tone, otherwise -> confirm tone.
        sfx(result && result.ok === false ? 'error' : 'confirm');
        return result;
    } catch (err)
    {
        const payload = { ok: false, error: `${err.name}: ${err.message}` };
        show(payload);
        sfx('error');
        return payload;
    } finally
    {
        finishProgress();
    }
}

function bindThemeToggle()
{
    if (!themeToggle) return;
    themeToggle.addEventListener('click', () =>
    {
        sfx('confirm');
        const next = html.dataset.theme === 'primordial-gold' ? 'hellflare-gold' : 'primordial-gold';
        setTheme(next);
    });
}

function bindTabButtons()
{
    document.querySelectorAll('[data-tab-target]').forEach((btn) =>
    {
        btn.addEventListener('click', () =>
        {
            sfx('cursor');
            const target = btn.dataset.tabTarget;
            document.querySelectorAll('[data-tab-target]').forEach((item) =>
            {
                item.classList.toggle('active', item === btn);
            });

            document.querySelectorAll('[data-tab-panel]').forEach((panel) =>
            {
                panel.classList.toggle('hidden', panel.dataset.tabPanel !== target);
            });
        });
    });
}

function bindSelectionZones()
{
    const fileZone = document.getElementById('file-drop-zone');
    const fileList = document.getElementById('file-list');
    const folderZone = document.getElementById('folder-drop-zone');
    const folderList = document.getElementById('folder-list');
    const isDecryptPage = body?.dataset?.page === 'decrypt';

    if (fileZone)
    {
        fileZone.addEventListener('click', async () =>
        {
            const options = { properties: ['openFile', 'multiSelections'] };

            if (isDecryptPage)
            {
                options.filters = [{ name: 'CRP56 Encrypted', extensions: ['crp56'] }, { name: 'All Files', extensions: ['*'] }];
            }

            const result = await window.crp56.pickFile(options);
            if (result.canceled) return;

            selectedFiles = result.filePaths;
            if (fileList)
            {
                fileList.style.display = 'block';
                fileList.innerHTML = selectedFiles.map(f => `<div>📄 ${f}</div>`).join('');
            }
            sfx('cursor');
            log('Files selected:', selectedFiles);
        });
    }

    if (folderZone)
    {
        folderZone.addEventListener('click', async () =>
        {
            const result = await window.crp56.pickFolder();
            if (result.canceled) return;

            selectedFolder = result.filePaths[0];
            if (folderList)
            {
                folderList.style.display = 'block';
                folderList.innerText = `📂 ${selectedFolder}`;
            }
            sfx('cursor');
            log('Folder selected:', selectedFolder);
        });
    }
}

function bindPageActions()
{
    const btnPing = document.getElementById('btn-ping');
    const btnVersion = document.getElementById('btn-version');
    const btnEncrypt = document.getElementById('btn-encrypt');
    const btnDecrypt = document.getElementById('btn-decrypt');
    const passphraseInput = document.getElementById('passphrase');
    const plainTextInput = document.getElementById('plain-text');

    if (btnPing)
    {
        btnPing.addEventListener('click', async () =>
        {
            await runAction('ping', () => window.crp56.ping());
        });
    }

    if (btnVersion)
    {
        btnVersion.addEventListener('click', async () =>
        {
            await runAction('version', () => window.crp56.version());
        });
    }

    if (btnEncrypt && passphraseInput)
    {
        btnEncrypt.addEventListener('click', async () =>
        {
            const passphrase = passphraseInput.value;
            if (!passphrase) { sfx('error'); return show({ ok: false, error: 'Passphrase is required' }); }

            const activeTab = document.querySelector('.tab-pill.active')?.dataset.tabTarget;

            if (activeTab === 'text' && plainTextInput)
            {
                const text = plainTextInput.value;
                const result = await runAction('encrypt_text', () => window.crp56.encryptText(passphrase, text));
                if (result?.ok && result.result) plainTextInput.value = result.result;
            }
            else if (activeTab === 'file')
            {
                if (selectedFiles.length === 0) { sfx('error'); return show({ ok: false, error: 'No files selected' }); }

                const sourceFile = selectedFiles[0];
                const saveRes = await window.crp56.pickSaveFile({
                    title: 'Save Encrypted File',
                    defaultPath: toCrp56Name(baseName(sourceFile)),
                    filters: [{ name: 'CRP56 Encrypted', extensions: ['crp56'] }]
                });
                if (saveRes.canceled || !saveRes.filePath) return;

                const outputFile = ensureCrp56Extension(saveRes.filePath);
                await runAction('encrypt_file', () => window.crp56.encryptFile(passphrase, sourceFile, outputFile));
            }
            else if (activeTab === 'folder')
            {
                if (!selectedFolder) { sfx('error'); return show({ ok: false, error: 'No folder selected' }); }

                const saveRes = await window.crp56.pickFolder({
                    title: 'Select Output Folder for Encrypted Files',
                    properties: ['openDirectory', 'createDirectory']
                });
                if (saveRes.canceled) return;

                await runAction('encrypt_folder', () => window.crp56.encryptFolder(passphrase, selectedFolder, saveRes.filePaths[0]));
            }
        });
    }

    if (btnDecrypt && passphraseInput)
    {
        btnDecrypt.addEventListener('click', async () =>
        {
            const passphrase = passphraseInput.value;
            if (!passphrase) { sfx('error'); return show({ ok: false, error: 'Passphrase is required' }); }

            const activeTab = document.querySelector('.tab-pill.active')?.dataset.tabTarget;

            if (activeTab === 'text' && plainTextInput)
            {
                const text = plainTextInput.value;
                const result = await runAction('decrypt_text', () => window.crp56.decryptText(passphrase, text));
                if (result?.ok && result.result) plainTextInput.value = result.result;
            }
            else if (activeTab === 'file')
            {
                if (selectedFiles.length === 0) { sfx('error'); return show({ ok: false, error: 'No files selected' }); }

                const sourceFile = selectedFiles[0];
                const destRes = await window.crp56.pickFolder({ title: 'Select Destination Folder for Decrypted File', properties: ['openDirectory', 'createDirectory'] });
                if (destRes.canceled) return;

                await runAction('decrypt_file', () => window.crp56.decryptFile(passphrase, sourceFile, destRes.filePaths[0]));
            }
            else if (activeTab === 'folder')
            {
                if (!selectedFolder) { sfx('error'); return show({ ok: false, error: 'No folder selected' }); }

                const saveRes = await window.crp56.pickFolder({ title: 'Select Output Folder for Decrypted Files', properties: ['openDirectory', 'createDirectory'] });
                if (saveRes.canceled) return;

                await runAction('decrypt_folder', () => window.crp56.decryptFolder(passphrase, selectedFolder, saveRes.filePaths[0]));
            }
        });
    }
}

function bindThemeButtons()
{
    document.querySelectorAll('[data-set-theme]').forEach((btn) =>
    {
        btn.addEventListener('click', () => { sfx('confirm'); setTheme(btn.dataset.setTheme); });
    });
}

/* --- NAV RAIL AUDIO --- */
function bindRailAudio()
{
    document.querySelectorAll('.nav-btn').forEach((el) =>
    {
        // Hover blip (skip the already-active page)
        el.addEventListener('mouseenter', () =>
        {
            if (!el.classList.contains('active')) sfx('cursor');
        });
        // Confirm tone when navigating away
        el.addEventListener('click', () =>
        {
            if (!el.classList.contains('active')) sfx('confirm');
        });
    });
}

/* --- PARTICLE TOGGLE (Settings) --- */

function setParticlesEnabled(enabled, { persist = true } = {})
{
    particlesEnabled = !!enabled;

    if (persist)
    {
        try { localStorage.setItem(PARTICLE_STORAGE_KEY, particlesEnabled ? 'on' : 'off'); } catch (_) {}
    }

    const toggle = document.getElementById('particleToggle');
    const status = document.getElementById('particleStatus');
    if (toggle) toggle.textContent = particlesEnabled ? 'Disable particles' : 'Enable particles';
    if (status) status.textContent = particlesEnabled ? 'On' : 'Off';
}

function savedParticlesEnabled()
{
    try
    {
        return localStorage.getItem(PARTICLE_STORAGE_KEY) !== 'off';
    } catch (_)
    {
        return true;
    }
}

function bindParticleToggle()
{
    const toggle = document.getElementById('particleToggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => { sfx('cursor'); setParticlesEnabled(!particlesEnabled); });
}

/* --- VOLUME SLIDERS (Settings) --- */

function bindVolumeSliders()
{
    const sfxSlider = document.getElementById('sfxVolume');
    const sfxLabel = document.getElementById('sfxVolumeLabel');
    const musicSlider = document.getElementById('musicVolume');
    const musicLabel = document.getElementById('musicVolumeLabel');

    const savedSfx = Number(localStorage.getItem(SFX_VOL_STORAGE_KEY) ?? 80);
    const savedMusic = Number(localStorage.getItem(MUSIC_VOL_STORAGE_KEY) ?? 60);

    if (sfxSlider)
    {
        sfxSlider.value = savedSfx;
        if (sfxLabel) sfxLabel.textContent = `${savedSfx}%`;
        sfxSlider.addEventListener('input', () =>
        {
            const pct = Number(sfxSlider.value);
            if (sfxLabel) sfxLabel.textContent = `${pct}%`;
            if (window.sfx) window.sfx.setVolume(pct / 100); // FMOD wants 0..1
            try { localStorage.setItem(SFX_VOL_STORAGE_KEY, String(pct)); } catch (_) {}
        });
        // Play a sample when released so you hear the new level
        sfxSlider.addEventListener('change', () => sfx('cursor'));
    }

    if (musicSlider)
    {
        musicSlider.value = savedMusic;
        if (musicLabel) musicLabel.textContent = `${savedMusic}%`;
        musicSlider.addEventListener('input', () =>
        {
            const pct = Number(musicSlider.value);
            if (musicLabel) musicLabel.textContent = `${pct}%`;
            if (window.sfx) window.sfx.setMusicVolume(pct / 100);
            try { localStorage.setItem(MUSIC_VOL_STORAGE_KEY, String(pct)); } catch (_) {}
        });
    }
}

function applySavedVolumes()
{
    if (!window.sfx) return;
    const sfxVol = Number(localStorage.getItem(SFX_VOL_STORAGE_KEY) ?? 80) / 100;
    const musicVol = Number(localStorage.getItem(MUSIC_VOL_STORAGE_KEY) ?? 60) / 100;
    window.sfx.setVolume(sfxVol);
    window.sfx.setMusicVolume(musicVol);
}

/* --- PARTICLE SYSTEM --- */
const canvas = document.getElementById('particles');
const ctx = canvas ? canvas.getContext('2d') : null;
let particles = [];

function accentColors()
{
    const style = getComputedStyle(document.documentElement);
    return [style.getPropertyValue('--accent').trim() || '#ffea00', style.getPropertyValue('--accent-2').trim() || '#fff9c4'];
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

function seedParticles()
{
    if (!canvas || !ctx) return;
    const count = Math.max(38, Math.floor(window.innerWidth / 32));
    const colors = accentColors();
    particles = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 2.2 + 0.7,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        alpha: Math.random() * 0.55 + 0.18,
        twinkle: Math.random() * Math.PI * 2,
        color: colors[i % colors.length]
    }));
}

function resizeCanvas()
{
    if (!canvas || !ctx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.8);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    seedParticles();
}

function drawParticles()
{
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!particlesEnabled)
    {
        requestAnimationFrame(drawParticles);
        return;
    }

    particles.forEach((p, i) =>
    {
        p.x += p.vx; p.y += p.vy; p.twinkle += 0.03;
        if (p.x < -20) p.x = window.innerWidth + 20;
        if (p.x > window.innerWidth + 20) p.x = -20;
        if (p.y < -20) p.y = window.innerHeight + 20;
        if (p.y > window.innerHeight + 20) p.y = -20;
        const pulse = (Math.sin(p.twinkle) + 1) / 2;
        ctx.beginPath();
        ctx.fillStyle = hexToRgba(p.color, 0.16 + pulse * p.alpha * 0.4);
        ctx.arc(p.x, p.y, p.r + pulse * 1.4, 0, Math.PI * 2);
        ctx.fill();
        for (let j = i + 1; j < particles.length; j++)
        {
            const q = particles[j];
            const dx = p.x - q.x;
            const dy = p.y - q.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 128)
            {
                ctx.strokeStyle = hexToRgba(p.color, (1 - dist / 128) * 0.12);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
                ctx.stroke();
            }
        }
    });
    requestAnimationFrame(drawParticles);
}

window.addEventListener('DOMContentLoaded', () =>
{
    bindThemeToggle();
    bindThemeButtons();
    bindTabButtons();
    bindParticleToggle();
    bindVolumeSliders();
    bindRailAudio();

    initBackgroundHost(); // init before setTheme so the host is ready

    setParticlesEnabled(savedParticlesEnabled(), { persist: false });
    setTheme(savedTheme() || html.dataset.theme || 'primordial-gold'); // also starts bg loop
    resizeCanvas();
    drawParticles();

    // Push saved volumes to FMOD on every page load (not just Settings).
    applySavedVolumes();

    if (!window.crp56)
    {
        show({ ok: false, error: 'window.crp56 is missing.' });
        return;
    }

    bindSelectionZones();
    bindPageActions();
    bindProgressEvents();

    const page = body?.dataset?.page;
    if (page) show({ ok: true, status: `${page.charAt(0).toUpperCase() + page.slice(1)} page ready.` });
});

window.addEventListener('resize', resizeCanvas);