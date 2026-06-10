const output = document.getElementById('output');
const themeStylesheet = document.getElementById('themeStylesheet');
const themeName = document.getElementById('themeName');
const themeNameCard = document.getElementById('themeNameCard');
const themeToggle = document.getElementById('themeToggle');
const progressFill = document.querySelector('.progress-fill');
const html = document.documentElement;
const body = document.body;

const ENCRYPTED_EXTENSION = '.crp56';

// State for File/Folder selections
let selectedFiles = [];
let selectedFolder = null;

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
    return filePath.toLowerCase().endsWith(ENCRYPTED_EXTENSION)
        ? filePath
        : filePath + ENCRYPTED_EXTENSION;
}

// "test1.png" -> "test1.crp56" (original extension is stored inside the payload)
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
    seedParticles();
}

function setBusy(isBusy, label = '')
{
    if (progressFill)
    {
        progressFill.style.width = isBusy ? '72%' : '0%';
        progressFill.style.opacity = isBusy ? '1' : '0.18';
    }
    if (isBusy)
    {
        show({ ok: false, status: label ? `Running ${label}...` : 'Working...' });
    }
}

async function runAction(label, fn)
{
    try
    {
        log('Running action:', label);
        setBusy(true, label);
        const result = await fn();
        show(result);
        return result;
    } catch (err)
    {
        const payload = { ok: false, error: `${err.name}: ${err.message}` };
        show(payload);
        return payload;
    } finally
    {
        setBusy(false);
    }
}

function bindThemeToggle()
{
    if (!themeToggle) return;
    themeToggle.addEventListener('click', () => {
        const next = html.dataset.theme === 'primordial-gold' ? 'hellflare-gold' : 'primordial-gold';
        setTheme(next);
    });
}

function bindTabButtons() {
    document.querySelectorAll('[data-tab-target]').forEach((btn) =>
    {
        btn.addEventListener('click', () =>
        {
            const target = btn.dataset.tabTarget;
            document.querySelectorAll('[data-tab-target]').forEach((item) =>
            {
                item.classList.toggle('active', item === btn);
            });
            document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
                panel.classList.toggle('hidden', panel.dataset.tabPanel !== target);

            });
        });
    });
}

// Logic for File and Folder selection
function bindSelectionZones()
{
    const fileZone = document.getElementById('file-drop-zone');
    const fileList = document.getElementById('file-list');
    const folderZone = document.getElementById('folder-drop-zone');
    const folderList = document.getElementById('folder-list');
    const isDecryptPage = body?.dataset?.page === 'decrypt';

    if (fileZone) {
        fileZone.addEventListener('click', async () =>
        {
            const options = { properties: ['openFile', 'multiSelections'] };

            // On the decrypt page, surface .crp56 containers first
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
            if (folderList) {
                folderList.style.display = 'block';
                folderList.innerText = `📂 ${selectedFolder}`;
            }
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

    if (btnPing) {
        btnPing.addEventListener('click', async () => {
            await runAction('ping', () => window.crp56.ping());
        });
    }

    if (btnVersion) {
        btnVersion.addEventListener('click', async () => {
            await runAction('version', () => window.crp56.version());
        });
    }

    // ENCRYPT LOGIC
    if (btnEncrypt && passphraseInput) {
        btnEncrypt.addEventListener('click', async () => {
            const passphrase = passphraseInput.value;
            if (!passphrase) return show({ ok: false, error: 'Passphrase is required' });

            const activeTab = document.querySelector('.tab-pill.active')?.dataset.tabTarget;

            if (activeTab === 'text' && plainTextInput) {
                const text = plainTextInput.value;
                const result = await runAction('encrypt_text', () => window.crp56.encryptText(passphrase, text));
                if (result?.ok && result.result) plainTextInput.value = result.result;
            }
            else if (activeTab === 'file') {
                if (selectedFiles.length === 0) return show({ ok: false, error: 'No files selected' });

                const sourceFile = selectedFiles[0];
                const saveRes = await window.crp56.pickSaveFile({
                    title: 'Save Encrypted File',
                    // test1.png -> test1.crp56 (original name is stored inside the payload)
                    defaultPath: toCrp56Name(baseName(sourceFile)),
                    filters: [{ name: 'CRP56 Encrypted', extensions: ['crp56'] }]
                });
                if (saveRes.canceled || !saveRes.filePath) return;

                // Belt-and-braces: force .crp56 even if the user renames the file
                const outputFile = ensureCrp56Extension(saveRes.filePath);

                await runAction('encrypt_file', () =>
                    window.crp56.encryptFile(passphrase, sourceFile, outputFile)
                );
            }
            else if (activeTab === 'folder') {
                if (!selectedFolder) return show({ ok: false, error: 'No folder selected' });

                const saveRes = await window.crp56.pickFolder({
                    title: 'Select Output Folder for Encrypted Files',
                    properties: ['openDirectory', 'createDirectory']
                });
                if (saveRes.canceled) return;

                await runAction('encrypt_folder', () =>
                    window.crp56.encryptFolder(passphrase, selectedFolder, saveRes.filePaths[0])
                );
            }
        });
    }

    // DECRYPT LOGIC
    if (btnDecrypt && passphraseInput) {
        btnDecrypt.addEventListener('click', async () => {
            const passphrase = passphraseInput.value;
            if (!passphrase) return show({ ok: false, error: 'Passphrase is required' });

            const activeTab = document.querySelector('.tab-pill.active')?.dataset.tabTarget;

            if (activeTab === 'text' && plainTextInput) {
                const text = plainTextInput.value;
                const result = await runAction('decrypt_text', () => window.crp56.decryptText(passphrase, text));
                if (result?.ok && result.result) plainTextInput.value = result.result;
            }
            else if (activeTab === 'file') {
                if (selectedFiles.length === 0) return show({ ok: false, error: 'No files selected' });

                const sourceFile = selectedFiles[0];

                // Pick a destination FOLDER: the Ruby core restores the original
                // filename + extension stored inside the encrypted payload.
                const destRes = await window.crp56.pickFolder({
                    title: 'Select Destination Folder for Decrypted File',
                    properties: ['openDirectory', 'createDirectory']
                });
                if (destRes.canceled) return;

                await runAction('decrypt_file', () =>
                    window.crp56.decryptFile(passphrase, sourceFile, destRes.filePaths[0])
                );
            }
            else if (activeTab === 'folder') {
                if (!selectedFolder) return show({ ok: false, error: 'No folder selected' });

                const saveRes = await window.crp56.pickFolder({
                    title: 'Select Output Folder for Decrypted Files',
                    properties: ['openDirectory', 'createDirectory']
                });
                if (saveRes.canceled) return;

                await runAction('decrypt_folder', () =>
                    window.crp56.decryptFolder(passphrase, selectedFolder, saveRes.filePaths[0])
                );
            }
        });
    }

    document.querySelectorAll('[data-set-theme]').forEach((btn) => {
        btn.addEventListener('click', () => setTheme(btn.dataset.setTheme));
    });
}

/* --- PARTICLE SYSTEM --- */
const canvas = document.getElementById('particles');
const ctx = canvas ? canvas.getContext('2d') : null;
let particles = [];

function accentColors() {
    const style = getComputedStyle(document.documentElement);
    return [
        style.getPropertyValue('--accent').trim() || '#ffea00',
        style.getPropertyValue('--accent-2').trim() || '#fff9c4'
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
    if (!window.crp56) {
        show({ ok: false, error: 'window.crp56 is missing.' });
        return;
    }

    bindThemeToggle();
    bindTabButtons();
    bindSelectionZones();
    bindPageActions();

    setTheme(html.dataset.theme || 'primordial-gold');
    resizeCanvas();
    drawParticles();

    const page = body?.dataset?.page;
    if (page) show({ ok: true, status: `${page.charAt(0).toUpperCase() + page.slice(1)} page ready.` });
});

window.addEventListener('resize', resizeCanvas);