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
const MASTER_VOL_STORAGE_KEY = 'crp56-master-volume';
const MUTE_STORAGE_KEY = 'crp56-muted';

let selectedFiles = [];
let selectedEncryptedFolder = null;
let selectedFolderOutput = null;
let progressResetTimer = null;
let particlesEnabled = true;
let bgMusicStarted = false;
let loadedMusicTracks = [];

const SFX_THROTTLE_MS = 60;
const lastSfxAt = {};

function playSfx(category)
{
    if (!window.sfx || typeof window.sfx.play !== 'function')
    {
        console.warn('[CRP56 sfx] window.sfx bridge missing. Requested:', category);
        return;
    }
    const now = Date.now();
    if (now - (lastSfxAt[category] || 0) < SFX_THROTTLE_MS) return;
    lastSfxAt[category] = now;
    console.log('[CRP56 renderer] sfx:play ->', category);
    window.sfx.play(category);
}

function bindMasterAndMusic()
{
    const masterSlider = document.getElementById('masterVolume');
    const masterLabel = document.getElementById('masterVolumeLabel');
    if (masterSlider)
    {
        masterSlider.disabled = false;
        const savedMaster = Number(localStorage.getItem(MASTER_VOL_STORAGE_KEY) ?? 100);
        masterSlider.value = savedMaster;
        if (masterLabel) masterLabel.textContent = `${savedMaster}%`;
        masterSlider.addEventListener('input', () =>
        {
            const pct = Number(masterSlider.value);
            if (masterLabel) masterLabel.textContent = `${pct}%`;
            console.log('[CRP56 renderer] master volume input ->', pct);
            if (window.sfx) window.sfx.setMasterVolume(pct / 100);
            try { localStorage.setItem(MASTER_VOL_STORAGE_KEY, String(pct)); } catch (_) {}
        });
        masterSlider.addEventListener('change', () => playSfx('cursor'));
    }

    const muteBtn = document.getElementById('muteToggle');
    if (muteBtn)
    {
        let muted = localStorage.getItem(MUTE_STORAGE_KEY) === 'on';
        const render = () => { muteBtn.textContent = muted ? 'Unmute' : 'Mute all'; };
        render();
        if (window.sfx) window.sfx.setMuteAll(muted);
        muteBtn.addEventListener('click', () =>
        {
            muted = !muted;
            console.log('[CRP56 renderer] mute toggle ->', muted);
            if (window.sfx) window.sfx.setMuteAll(muted);
            try { localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'on' : 'off'); } catch (_) {}
            render();
            if (!muted) playSfx('confirm');
        });
    }
}

const THEMES = {
    'primordial-gold': { label: 'Primordial Gold', href: './primordial_gold.css' },
    'hellflare-gold': { label: 'Hellflare Gold', href: './hellflare_gold.css' }
};

const BG_IMAGES = {
    'primordial-gold': ['../BG_images/bg1.jpg', '../BG_images/bg3.jpg', '../BG_images/bg5.jpg', '../BG_images/bg7.jpg'],
    'hellflare-gold': ['../BG_images/bg2.jpg', '../BG_images/bg4.png', '../BG_images/bg6.jpg']
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
    requestAnimationFrame(() => { requestAnimationFrame(() => slide.classList.add('visible')); });
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
    bgTimerId = setInterval(() => { showNextSlide(html.dataset.theme || theme); }, BG_INTERVAL_MS);
}

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
    return String(fullPath).split(/[\/]/).pop();
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
    startBackgroundLoop(theme);
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
    if (!window.crp56 || typeof window.crp56.onProgress !== 'function')
    {
        console.log('[CRP56 renderer] progress bridge missing');
        return;
    }

    console.log('[CRP56 renderer] progress bridge attached');
    window.crp56.onProgress((msg) =>
    {
        console.log('[CRP56 renderer] progress event:', msg);
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
        playSfx(result && result.ok === false ? 'error' : 'confirm');
        return result;
    }
    catch (err)
    {
        const payload = { ok: false, error: `${err.name}: ${err.message}` };
        show(payload);
        playSfx('error');
        return payload;
    }
    finally
    {
        finishProgress();
    }
}

function bindThemeToggle()
{
    if (!themeToggle) return;
    themeToggle.addEventListener('click', () =>
    {
        console.log('[CRP56 renderer] theme toggle');
        playSfx('confirm');
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
            playSfx('cursor');
            const target = btn.dataset.tabTarget;
            document.querySelectorAll('[data-tab-target]').forEach((item) => { item.classList.toggle('active', item === btn); });
            document.querySelectorAll('[data-tab-panel]').forEach((panel) => { panel.classList.toggle('hidden', panel.dataset.tabPanel !== target); });
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
            playSfx('cursor');
            log('Files selected:', selectedFiles);
        });
    }

    if (folderZone)
    {
        folderZone.addEventListener('click', async () =>
        {
            let result;
            if (isDecryptPage)
            {
                result = await window.crp56.pickFile({
                    title: 'Select Encrypted Archive to Extract',
                    properties: ['openFile'],
                    filters: [
                        { name: 'CRP56 Encrypted Archive', extensions: ['crp56'] },
                        { name: 'All Files', extensions: ['*'] }
                    ]
                });
            }
            else
            {
                result = await window.crp56.pickFolder();
            }
            if (result.canceled) return;
            selectedEncryptedFolder = result.filePaths[0];
            if (folderList)
            {
                folderList.style.display = 'block';
                const icon = isDecryptPage ? '🗄️' : '📂';
                folderList.innerText = `${icon} ${selectedEncryptedFolder}`;
            }
            playSfx('cursor');
            log(isDecryptPage ? 'Encrypted archive selected:' : 'Source folder selected:', selectedEncryptedFolder);
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
        btnPing.addEventListener('click', async () => { await runAction('ping', () => window.crp56.ping()); });
    }

    if (btnVersion)
    {
        btnVersion.addEventListener('click', async () => { await runAction('version', () => window.crp56.version()); });
    }

    if (btnEncrypt && passphraseInput)
    {
        btnEncrypt.addEventListener('click', async () =>
        {
            const passphrase = passphraseInput.value;
            if (!passphrase) { playSfx('error'); return show({ ok: false, error: 'Passphrase is required' }); }
            const activeTab = document.querySelector('.tab-pill.active')?.dataset.tabTarget;
            if (activeTab === 'text' && plainTextInput)
            {
                const text = plainTextInput.value;
                const result = await runAction('encrypt_text', () => window.crp56.encryptText(passphrase, text));
                if (result?.ok && result.result) plainTextInput.value = result.result;
            }
            else if (activeTab === 'file')
            {
                if (selectedFiles.length === 0) { playSfx('error'); return show({ ok: false, error: 'No files selected' }); }
                const sourceFile = selectedFiles[0];
                const saveRes = await window.crp56.pickSaveFile({ title: 'Save Encrypted File', defaultPath: toCrp56Name(baseName(sourceFile)), filters: [{ name: 'CRP56 Encrypted', extensions: ['crp56'] }] });
                if (saveRes.canceled || !saveRes.filePath) return;
                const outputFile = ensureCrp56Extension(saveRes.filePath);
                await runAction('encrypt_file', () => window.crp56.encryptFile(passphrase, sourceFile, outputFile));
            }
            else if (activeTab === 'folder')
            {
                if (!selectedEncryptedFolder) { playSfx('error'); return show({ ok: false, error: 'No folder selected' }); }
                const saveRes = await window.crp56.pickFolder({ title: 'Select Output Folder for the Encrypted Archive', properties: ['openDirectory', 'createDirectory'] });
                if (saveRes.canceled) return;
                selectedFolderOutput = saveRes.filePaths[0];
                await runAction('encrypt_folder', () => window.crp56.encryptFolder(passphrase, selectedEncryptedFolder, selectedFolderOutput));
            }
        });
    }

    if (btnDecrypt && passphraseInput)
    {
        btnDecrypt.addEventListener('click', async () =>
        {
            const passphrase = passphraseInput.value;
            if (!passphrase) { playSfx('error'); return show({ ok: false, error: 'Passphrase is required' }); }
            const activeTab = document.querySelector('.tab-pill.active')?.dataset.tabTarget;
            if (activeTab === 'text' && plainTextInput)
            {
                const text = plainTextInput.value;
                const result = await runAction('decrypt_text', () => window.crp56.decryptText(passphrase, text));
                if (result?.ok && result.result) plainTextInput.value = result.result;
            }
            else if (activeTab === 'file')
            {
                if (selectedFiles.length === 0) { playSfx('error'); return show({ ok: false, error: 'No files selected' }); }
                const sourceFile = selectedFiles[0];
                const destRes = await window.crp56.pickFolder({ title: 'Select Destination Folder for Decrypted File', properties: ['openDirectory', 'createDirectory'] });
                if (destRes.canceled) return;
                await runAction('decrypt_file', () => window.crp56.decryptFile(passphrase, sourceFile, destRes.filePaths[0]));
            }
            else if (activeTab === 'folder')
            {
                if (!selectedEncryptedFolder) { playSfx('error'); return show({ ok: false, error: 'No encrypted archive (.crp56) selected' }); }
                const saveRes = await window.crp56.pickFolder({ title: 'Select Output Folder to Extract Into', properties: ['openDirectory', 'createDirectory'] });
                if (saveRes.canceled) return;
                selectedFolderOutput = saveRes.filePaths[0];
                await runAction('decrypt_folder', () => window.crp56.decryptFolder(passphrase, selectedEncryptedFolder, selectedFolderOutput));
            }
        });
    }
}

function bindThemeButtons()
{
    document.querySelectorAll('[data-set-theme]').forEach((btn) =>
    {
        btn.addEventListener('click', () => { playSfx('confirm'); setTheme(btn.dataset.setTheme); });
    });
}

function bindRailAudio()
{
    document.querySelectorAll('.nav-btn').forEach((el) =>
    {
        el.addEventListener('mouseenter', () => { if (!el.classList.contains('active')) playSfx('cursor'); });
        el.addEventListener('click', () => { if (!el.classList.contains('active')) playSfx('confirm'); });
    });
}

function bindDataSfx()
{
    document.addEventListener('click', (e) =>
    {
        const el = e.target.closest('[data-sfx]');
        if (!el) return;
        const cat = el.getAttribute('data-sfx');
        if (cat) playSfx(cat);
    });
}

async function bindMusicTrackSelect()
{
    const select = document.getElementById('musicTrackSelect');
    const playBtn = document.getElementById('musicTrackPlay');
    if (!select || !playBtn || !window.sfx?.listMusic)
    {
        console.log('[CRP56 renderer] music UI missing or bridge missing');
        return;
    }

    try
    {
        console.log('[CRP56 renderer] requesting music list...');
        const tracks = await window.sfx.listMusic();
        loadedMusicTracks = tracks.slice();
        console.log('[CRP56 renderer] music list loaded:', tracks);

        select.innerHTML = '';

        const autoOpt = document.createElement('option');
        autoOpt.value = '';
        autoOpt.textContent = 'Auto';
        select.appendChild(autoOpt);

        for (const track of tracks)
        {
            const opt = document.createElement('option');
            opt.value = track;
            opt.textContent = track;
            select.appendChild(opt);
        }

        select.value = localStorage.getItem('crp56-music-track') || '';

        playBtn.addEventListener('click', () =>
        {
            const track = select.value;
            console.log('[CRP56 renderer] music play click', {
                selected: track,
                tracksLoaded: loadedMusicTracks,
                bgMusicStarted
            });

            if (track)
            {
                console.log('[CRP56 renderer] sending music:play ->', track);
                window.sfx.playMusic(track);
                localStorage.setItem('crp56-music-track', track);
                bgMusicStarted = true;
                log('Manual BG music selected:', track);
            }
            else if (tracks.length > 0)
            {
                const pick = tracks[Math.floor(Math.random() * tracks.length)];
                console.log('[CRP56 renderer] auto-picked music ->', pick);
                window.sfx.playMusic(pick);
                localStorage.removeItem('crp56-music-track');
                bgMusicStarted = true;
                log('Manual BG music auto-picked:', pick);
            }
            else
            {
                console.log('[CRP56 renderer] no tracks available to play');
            }
        });
    }
    catch (e)
    {
        console.error('[CRP56] Failed to load music tracks:', e);
    }
}

async function startBackgroundMusicOnce()
{
    console.log('[CRP56 renderer] startBackgroundMusicOnce called', {
        bgMusicStarted,
        hasBridge: !!window.sfx,
        hasListMusic: !!window.sfx?.listMusic,
        hasPlayMusic: !!window.sfx?.playMusic
    });

    if (bgMusicStarted) return;
    if (!window.sfx?.listMusic || !window.sfx?.playMusic) return;

    try
    {
        const tracks = await window.sfx.listMusic();
        console.log('[CRP56 renderer] autoplay tracks:', tracks);
        loadedMusicTracks = tracks.slice();

        if (tracks.length > 0)
        {
            const pick = tracks[Math.floor(Math.random() * tracks.length)];
            console.log('[CRP56 renderer] autoplay music ->', pick);
            window.sfx.playMusic(pick);
            bgMusicStarted = true;
            log('BG music started:', pick);
        }
        else
        {
            console.log('[CRP56 renderer] autoplay skipped; no tracks');
        }
    }
    catch (e)
    {
        console.error('[CRP56] BG music start failed:', e);
    }
}

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
    }
    catch (_)
    {
        return true;
    }
}

function bindParticleToggle()
{
    const toggle = document.getElementById('particleToggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => { playSfx('cursor'); setParticlesEnabled(!particlesEnabled); });
}

function bindVolumeSliders()
{
    const sfxSlider = document.getElementById('sfxVolume');
    const sfxLabel = document.getElementById('sfxVolumeLabel');
    const musicSlider = document.getElementById('musicVolume');
    const musicLabel = document.getElementById('musicVolumeLabel');
    const savedSfx = Number(localStorage.getItem(SFX_VOL_STORAGE_KEY) ?? 80);
    const savedMusic = Number(localStorage.getItem(MUSIC_VOL_STORAGE_KEY) ?? 60);

    const sync = (slider, label, pct) =>
    {
        if (slider) slider.value = String(pct);
        if (label) label.textContent = `${pct}%`;
    };

    if (sfxSlider)
    {
        sync(sfxSlider, sfxLabel, savedSfx);
        sfxSlider.addEventListener('input', () =>
        {
            const pct = Number(sfxSlider.value);
            sync(sfxSlider, sfxLabel, pct);
            console.log('[CRP56 renderer] sfx volume input ->', pct);
            if (window.sfx) window.sfx.setVolume(pct / 100);
            try { localStorage.setItem(SFX_VOL_STORAGE_KEY, String(pct)); } catch (_) {}
        });
        sfxSlider.addEventListener('change', () => playSfx('cursor'));
    }

    if (musicSlider)
    {
        sync(musicSlider, musicLabel, savedMusic);
        musicSlider.addEventListener('input', () =>
        {
            const pct = Number(musicSlider.value);
            sync(musicSlider, musicLabel, pct);
            console.log('[CRP56 renderer] music volume input ->', pct);
            if (window.sfx) window.sfx.setMusicVolume(pct / 100);
            try { localStorage.setItem(MUSIC_VOL_STORAGE_KEY, String(pct)); } catch (_) {}
        });
    }
}

function applySavedVolumes()
{
    const sfxSlider = document.getElementById('sfxVolume');
    const sfxLabel = document.getElementById('sfxVolumeLabel');
    const musicSlider = document.getElementById('musicVolume');
    const musicLabel = document.getElementById('musicVolumeLabel');
    const masterSlider = document.getElementById('masterVolume');
    const masterLabel = document.getElementById('masterVolumeLabel');

    const readVol = (key, fb) =>
    {
        const raw = localStorage.getItem(key);
        const n = Number(raw);
        return Number.isFinite(n) ? n : fb;
    };

    const master = readVol(MASTER_VOL_STORAGE_KEY, 100);
    const sfxVol = readVol(SFX_VOL_STORAGE_KEY, 80);
    const musicVol = readVol(MUSIC_VOL_STORAGE_KEY, 60);

    if (masterSlider) masterSlider.value = String(master);
    if (masterLabel) masterLabel.textContent = `${master}%`;

    if (sfxSlider) sfxSlider.value = String(sfxVol);
    if (sfxLabel) sfxLabel.textContent = `${sfxVol}%`;

    if (musicSlider) musicSlider.value = String(musicVol);
    if (musicLabel) musicLabel.textContent = `${musicVol}%`;

    if (!window.sfx) return;

    console.log('[CRP56 renderer] applying saved volumes', { master, sfxVol, musicVol });

    window.sfx.setMasterVolume(master / 100);
    window.sfx.setVolume(sfxVol / 100);
    window.sfx.setMusicVolume(musicVol / 100);

    const muted = localStorage.getItem(MUTE_STORAGE_KEY) === 'on';
    window.sfx.setMuteAll(muted);
}

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

window.addEventListener('DOMContentLoaded', async () =>
{
    console.log('[CRP56 renderer] DOMContentLoaded');
    bindThemeToggle();
    bindThemeButtons();
    bindTabButtons();
    bindParticleToggle();
    bindVolumeSliders();
    bindMasterAndMusic();
    bindRailAudio();
    bindDataSfx();
    initBackgroundHost();
    setParticlesEnabled(savedParticlesEnabled(), { persist: false });
    setTheme(savedTheme() || html.dataset.theme || 'primordial-gold');
    resizeCanvas();
    drawParticles();
    applySavedVolumes();

    console.log('[CRP56 renderer] awaiting music track binding');
    await bindMusicTrackSelect();

    setTimeout(async () =>
    {
        try
        {
            console.log('[CRP56 renderer] delayed autoplay firing');
            await startBackgroundMusicOnce();
        }
        catch (e)
        {
            console.error('[CRP56] Delayed BG music start failed:', e);
        }
    }, 500);

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