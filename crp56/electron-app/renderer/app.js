const output = document.getElementById('output');
const themeStylesheet = document.getElementById('themeStylesheet');
const themeName = document.getElementById('themeName');
const themeNameCard = document.getElementById('themeNameCard');
const themeToggle = document.getElementById('themeToggle');
const progressFill = document.querySelector('.progress-fill');
const html = document.documentElement;
const body = document.body;

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

function log(...args) {
    console.log('[CRP56 renderer]', ...args);
}

function show(data) {
    if (!output) return;
    output.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function setTheme(theme) {
    if (!THEMES[theme]) return;

    html.dataset.theme = theme;

    if (themeStylesheet) {
        themeStylesheet.setAttribute('href', THEMES[theme].href);
    }

    if (themeName) {
        themeName.textContent = THEMES[theme].label;
    }

    if (themeNameCard) {
        themeNameCard.textContent = THEMES[theme].label;
    }

    seedParticles();
}

function setBusy(isBusy, label = '') {
    if (progressFill) {
        progressFill.style.width = isBusy ? '72%' : '0%';
        progressFill.style.opacity = isBusy ? '1' : '0.18';
    }

    if (isBusy) {
        show({ ok: false, status: label ? `Running ${label}...` : 'Working...' });
    }
}

async function runAction(label, fn) {
    try {
        log('Running action:', label);
        setBusy(true, label);
        const result = await fn();
        show(result);
        return result;
    } catch (err) {
        const payload = {
            ok: false,
            error: `${err.name}: ${err.message}`
        };
        show(payload);
        return payload;
    } finally {
        setBusy(false);
    }
}

function bindThemeToggle() {
    if (!themeToggle) return;

    themeToggle.addEventListener('click', () => {
        const next = html.dataset.theme === 'primordial-gold'
            ? 'hellflare-gold'
            : 'primordial-gold';

        setTheme(next);
    });
}

function bindTabButtons() {
    document.querySelectorAll('[data-tab-target]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tabTarget;

            document.querySelectorAll('[data-tab-target]').forEach((item) => {
                item.classList.toggle('active', item === btn);
            });

            document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
                panel.classList.toggle('hidden', panel.dataset.tabPanel !== target);
            });
        });
    });
}

function bindPageActions() {
    const btnPing = document.getElementById('btn-ping');
    const btnVersion = document.getElementById('btn-version');
    const btnEncrypt = document.getElementById('btn-encrypt');
    const btnDecrypt = document.getElementById('btn-decrypt');
    const passphraseInput = document.getElementById('passphrase');
    const plainTextInput = document.getElementById('plain-text');

    if (btnPing) {
        btnPing.addEventListener('click', async () => {
            if (!window.crp56?.ping) return show({ ok: false, error: 'window.crp56.ping is missing.' });
            await runAction('ping', () => window.crp56.ping());
        });
    }

    if (btnVersion) {
        btnVersion.addEventListener('click', async () => {
            if (!window.crp56?.version) return show({ ok: false, error: 'window.crp56.version is missing.' });
            await runAction('version', () => window.crp56.version());
        });
    }

    if (btnEncrypt && passphraseInput && plainTextInput) {
        btnEncrypt.addEventListener('click', async () => {
            if (!window.crp56?.encryptText) return show({ ok: false, error: 'window.crp56.encryptText is missing.' });

            const passphrase = passphraseInput.value;
            const plainText = 'value' in plainTextInput ? plainTextInput.value : plainTextInput.textContent;

            const result = await runAction('encrypt_text', () =>
                window.crp56.encryptText(passphrase, plainText)
            );

            if (result && result.ok && result.result && 'value' in plainTextInput) {
                plainTextInput.value = result.result;
            }
        });
    }

    if (btnDecrypt && passphraseInput && plainTextInput) {
        btnDecrypt.addEventListener('click', async () => {
            if (!window.crp56?.decryptText) return show({ ok: false, error: 'window.crp56.decryptText is missing.' });

            const passphrase = passphraseInput.value;
            const cipherTextBase64 = 'value' in plainTextInput ? plainTextInput.value : plainTextInput.textContent;

            const result = await runAction('decrypt_text', () =>
                window.crp56.decryptText(passphrase, cipherTextBase64)
            );

            if (result && result.ok && result.result && 'value' in plainTextInput) {
                plainTextInput.value = result.result;
            }
        });
    }

    document.querySelectorAll('[data-set-theme]').forEach((btn) => {
        btn.addEventListener('click', () => setTheme(btn.dataset.setTheme));
    });
}

const canvas = document.getElementById('particles');
const ctx = canvas ? canvas.getContext('2d') : null;
let particles = [];

function accentColors() {
    const style = getComputedStyle(document.documentElement);
    return [
        style.getPropertyValue('--accent').trim() || '#ffc94a',
        style.getPropertyValue('--accent-2').trim() || '#ff9f1c'
    ];
}

function hexToRgba(input, alpha) {
    const c = String(input).replace('#', '');
    const normalized = c.length === 3 ? c.split('').map(ch => ch + ch).join('') : c;
    const bigint = parseInt(normalized, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function seedParticles() {
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

function resizeCanvas() {
    if (!canvas || !ctx) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 1.8);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    seedParticles();
}

function drawParticles() {
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.twinkle += 0.03;

        if (p.x < -20) p.x = window.innerWidth + 20;
        if (p.x > window.innerWidth + 20) p.x = -20;
        if (p.y < -20) p.y = window.innerHeight + 20;
        if (p.y > window.innerHeight + 20) p.y = -20;

        const pulse = (Math.sin(p.twinkle) + 1) / 2;

        ctx.beginPath();
        ctx.fillStyle = hexToRgba(p.color, 0.16 + pulse * p.alpha * 0.4);
        ctx.arc(p.x, p.y, p.r + pulse * 1.4, 0, Math.PI * 2);
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
            const q = particles[j];
            const dx = p.x - q.x;
            const dy = p.y - q.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 128) {
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

window.addEventListener('DOMContentLoaded', () => {
    log('DOM fully loaded');

    if (!window.crp56) {
        show({
            ok: false,
            error: 'window.crp56 is missing. Check preload.js and BrowserWindow preload path.'
        });
        return;
    }

    bindThemeToggle();
    bindTabButtons();
    bindPageActions();

    setTheme(html.dataset.theme || 'primordial-gold');
    resizeCanvas();
    drawParticles();

    if (body?.dataset?.page === 'home') {
        show({ ok: true, status: 'Home page ready.' });
    } else if (body?.dataset?.page === 'encrypt') {
        show({ ok: true, status: 'Encrypt page ready.' });
    } else if (body?.dataset?.page === 'decrypt') {
        show({ ok: true, status: 'Decrypt page ready.' });
    } else if (body?.dataset?.page === 'settings') {
        show({ ok: true, status: 'Settings page ready.' });
    } else if (body?.dataset?.page === 'about') {
        show({ ok: true, status: 'About page ready.' });
    }
});

window.addEventListener('resize', resizeCanvas);