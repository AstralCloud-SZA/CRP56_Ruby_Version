const output = document.getElementById('output');
const appRoot = document.getElementById('viewRoot');
const pageTitle = document.getElementById('pageTitle');
const themeStylesheet = document.getElementById('themeStylesheet');
const themeNameLabel = document.getElementById('themeName');
const progressFill = document.querySelector('.progress-fill');

const state = {
    route: 'home',
    theme: 'primordial-gold',
    encryptTab: 'text',
    decryptTab: 'text',
    busy: false,
    output: {
        ok: true,
        status: 'Renderer loaded. Ready for testing.'
    }
};

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

function show(data) {
    state.output = data;
    if (!output) return;
    output.textContent =
        typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function log(...args) {
    console.log('[CRP56 renderer]', ...args);
}

function setBusy(isBusy, label = '') {
    state.busy = isBusy;

    if (progressFill) {
        progressFill.style.width = isBusy ? '72%' : '0%';
        progressFill.style.opacity = isBusy ? '1' : '0.18';
    }

    if (isBusy) {
        show({ ok: false, status: label ? `Running ${label}...` : 'Working...' });
    }
}

function setTheme(theme) {
    if (!THEMES[theme]) return;

    state.theme = theme;
    document.documentElement.dataset.theme = theme;

    if (themeStylesheet) {
        themeStylesheet.setAttribute('href', THEMES[theme].href);
    }

    if (themeNameLabel) {
        themeNameLabel.textContent = THEMES[theme].label;
    }
}

function setRoute(route) {
    state.route = route;
    render();
}

function setTab(page, tab) {
    if (page === 'encrypt') state.encryptTab = tab;
    if (page === 'decrypt') state.decryptTab = tab;
    render();
}

window.addEventListener('error', (event) => {
    console.error('[Renderer error]', event.error || event.message);
    show({
        ok: false,
        error: String(event.error || event.message)
    });
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('[Renderer unhandled rejection]', event.reason);
    show({
        ok: false,
        error: String(event.reason)
    });
});

async function runAction(label, fn) {
    try {
        log('Running action:', label);
        setBusy(true, label);

        const result = await fn();

        log('Action result:', label, result);
        show(result);
        return result;
    } catch (err) {
        console.error(`[${label} failed]`, err);
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

function escapeHtml(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderHome() {
    return `
        <section class="hero">
            <section class="hero-panel">
                <div class="kicker">Yellow Primordial Demon Interface</div>
                <h2>Gold-led command hub with a ceremonial firecore feel.</h2>
                <p>The home page acts as the launch chamber for encryption and decryption.</p>
                <div class="hero-actions">
                    <button class="primary-btn" data-route="encrypt" type="button">Enter Encrypt</button>
                    <button class="secondary-btn" data-route="decrypt" type="button">View Decrypt</button>
                </div>
                <div class="hero-grid">
                    <article class="mini-card">
                        <div class="mini-label">Theme</div>
                        <div class="mini-value">${escapeHtml(THEMES[state.theme].label)}</div>
                    </article>
                    <article class="mini-card">
                        <div class="mini-label">Rail position</div>
                        <div class="mini-value">Right-side control spine</div>
                    </article>
                    <article class="mini-card">
                        <div class="mini-label">Background mode</div>
                        <div class="mini-value">Shuffled scene + particles</div>
                    </article>
                    <article class="mini-card">
                        <div class="mini-label">Signature detail</div>
                        <div class="mini-value">Shard-flame progress line</div>
                    </article>
                </div>
            </section>

            <aside class="system-stack">
                <section class="system-panel">
                    <h2 class="panel-title">Home page build target</h2>
                    <div class="action-grid">
                        <article class="action-card">
                            <div class="action-label">Primary route</div>
                            <div class="action-title">Encrypt</div>
                            <div class="action-copy">Text, file, and folder tabs inside one focused operation page.</div>
                        </article>
                        <article class="action-card">
                            <div class="action-label">Parallel route</div>
                            <div class="action-title">Decrypt</div>
                            <div class="action-copy">Mirrors the encryption layout so the whole app feels like one system.</div>
                        </article>
                    </div>
                </section>
            </aside>
        </section>
    `;
}

function renderEncrypt() {
    const activeTab = state.encryptTab;

    return `
        <section class="section-shell">
            <div class="content-stack">
                <div class="tab-row">
                    <button class="tab-pill ${activeTab === 'text' ? 'active' : ''}" data-tab-page="encrypt" data-tab="text" type="button">Text</button>
                    <button class="tab-pill ${activeTab === 'file' ? 'active' : ''}" data-tab-page="encrypt" data-tab="file" type="button">File</button>
                    <button class="tab-pill ${activeTab === 'folder' ? 'active' : ''}" data-tab-page="encrypt" data-tab="folder" type="button">Folder</button>
                </div>

                <div class="two-col">
                    <section class="hero-panel">
                        <div class="kicker">Encrypt workflow</div>
                        <h2>Secure input in a controlled gold chamber.</h2>

                        <label for="passphrase" class="mini-label">Passphrase</label>
                        <input id="passphrase" class="input-panel" type="password" placeholder="Enter passphrase" />

                        <label for="plain-text" class="mini-label">${
        activeTab === 'text'
            ? 'Plain text'
            : activeTab === 'file'
                ? 'Selected file'
                : 'Selected folder'
    }</label>

                        ${
        activeTab === 'text'
            ? `<textarea id="plain-text" class="input-panel" placeholder="Enter text to encrypt"></textarea>`
            : `<div id="plain-text" class="input-panel">${
                activeTab === 'file'
                    ? 'File picker integration goes here'
                    : 'Folder picker integration goes here'
            }</div>`
    }

                        <div class="hero-actions">
                            <button class="primary-btn" id="btn-encrypt" type="button">Encrypt</button>
                            <button class="secondary-btn" id="btn-ping" type="button">Ping</button>
                            <button class="secondary-btn" id="btn-version" type="button">Version</button>
                        </div>
                    </section>

                    <aside class="system-stack">
                        <section class="system-panel">
                            <h2 class="panel-title">Operation controls</h2>
                            <div class="action-grid">
                                <article class="action-card">
                                    <div class="action-label">Primary action</div>
                                    <div class="action-title">Encrypt</div>
                                    <div class="action-copy">Starts active processing and triggers the signature progress bar.</div>
                                </article>
                            </div>
                        </section>
                    </aside>
                </div>
            </div>
        </section>
    `;
}

function renderDecrypt() {
    const activeTab = state.decryptTab;

    return `
        <section class="section-shell">
            <div class="content-stack">
                <div class="tab-row">
                    <button class="tab-pill ${activeTab === 'text' ? 'active' : ''}" data-tab-page="decrypt" data-tab="text" type="button">Text</button>
                    <button class="tab-pill ${activeTab === 'file' ? 'active' : ''}" data-tab-page="decrypt" data-tab="file" type="button">File</button>
                    <button class="tab-pill ${activeTab === 'folder' ? 'active' : ''}" data-tab-page="decrypt" data-tab="folder" type="button">Folder</button>
                </div>

                <div class="two-col">
                    <section class="hero-panel">
                        <div class="kicker">Decrypt workflow</div>
                        <h2>Restore secured content with the same chamber logic.</h2>

                        <label for="passphrase" class="mini-label">Passphrase</label>
                        <input id="passphrase" class="input-panel" type="password" placeholder="Enter passphrase" />

                        <label for="plain-text" class="mini-label">${
        activeTab === 'text'
            ? 'Cipher text'
            : activeTab === 'file'
                ? 'Selected file'
                : 'Selected folder'
    }</label>

                        ${
        activeTab === 'text'
            ? `<textarea id="plain-text" class="input-panel" placeholder="Enter base64 encrypted text"></textarea>`
            : `<div id="plain-text" class="input-panel">${
                activeTab === 'file'
                    ? 'Encrypted file picker integration goes here'
                    : 'Encrypted folder picker integration goes here'
            }</div>`
    }

                        <div class="hero-actions">
                            <button class="primary-btn" id="btn-decrypt" type="button">Decrypt</button>
                            <button class="secondary-btn" id="btn-ping" type="button">Ping</button>
                            <button class="secondary-btn" id="btn-version" type="button">Version</button>
                        </div>
                    </section>

                    <aside class="system-stack">
                        <section class="system-panel">
                            <h2 class="panel-title">Operation controls</h2>
                            <div class="action-grid">
                                <article class="action-card">
                                    <div class="action-label">Primary action</div>
                                    <div class="action-title">Decrypt</div>
                                    <div class="action-copy">Uses the same progress language and job feedback system as encryption.</div>
                                </article>
                            </div>
                        </section>
                    </aside>
                </div>
            </div>
        </section>
    `;
}

function renderSettings() {
    return `
        <section class="section-shell">
            <div class="content-stack">
                <section class="hero-panel">
                    <div class="kicker">Settings</div>
                    <h2>Theme and atmosphere control.</h2>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>Theme mode</strong>
                            <span class="subtle">Swap between Primordial Gold and Hellflare Gold.</span>
                        </div>
                        <div class="switcher">
                            <button class="secondary-btn" data-theme="primordial-gold" type="button">Primordial</button>
                            <button class="primary-btn" data-theme="hellflare-gold" type="button">Hellflare</button>
                        </div>
                    </div>
                </section>
            </div>
        </section>
    `;
}

function renderAbout() {
    return `
        <section class="section-shell">
            <div class="content-stack">
                <section class="hero-panel">
                    <div class="kicker">About</div>
                    <h2>Polymorphic encryption command chamber.</h2>
                    <p class="about-copy">
                        This interface combines a right-hand tactical rail, strong yellow-led identity,
                        dual aesthetic themes, persistent particles, and a branded shard-flame progress line.
                    </p>
                </section>
            </div>
        </section>
    `;
}

function renderRoute() {
    switch (state.route) {
        case 'encrypt':
            return renderEncrypt();
        case 'decrypt':
            return renderDecrypt();
        case 'settings':
            return renderSettings();
        case 'about':
            return renderAbout();
        case 'home':
        default:
            return renderHome();
    }
}

function routeTitle(route) {
    switch (route) {
        case 'encrypt': return 'Encrypt Chamber';
        case 'decrypt': return 'Decrypt Chamber';
        case 'settings': return 'Settings Chamber';
        case 'about': return 'About Chamber';
        case 'home':
        default:
            return 'Home Command Chamber';
    }
}

function updateActiveNav() {
    document.querySelectorAll('[data-route-link]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.routeLink === state.route);
    });
}

function bindEvents() {
    document.querySelectorAll('[data-route-link]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setRoute(btn.dataset.routeLink);
        });
    });

    document.querySelectorAll('[data-route]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setRoute(btn.dataset.route);
        });
    });

    document.querySelectorAll('[data-tab-page][data-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setTab(btn.dataset.tabPage, btn.dataset.tab);
        });
    });

    document.querySelectorAll('[data-theme]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setTheme(btn.dataset.theme);
        });
    });

    const btnPing = document.getElementById('btn-ping');
    const btnVersion = document.getElementById('btn-version');
    const btnEncrypt = document.getElementById('btn-encrypt');
    const btnDecrypt = document.getElementById('btn-decrypt');
    const passphraseInput = document.getElementById('passphrase');
    const plainTextInput = document.getElementById('plain-text');

    if (btnPing) {
        btnPing.addEventListener('click', async () => {
            await runAction('ping', async () => window.crp56.ping());
        });
    }

    if (btnVersion) {
        btnVersion.addEventListener('click', async () => {
            await runAction('version', async () => window.crp56.version());
        });
    }

    if (btnEncrypt && passphraseInput && plainTextInput) {
        btnEncrypt.addEventListener('click', async () => {
            const passphrase = passphraseInput.value;
            const plainText = 'value' in plainTextInput ? plainTextInput.value : plainTextInput.textContent;

            const result = await runAction('encrypt_text', async () => {
                return window.crp56.encryptText(passphrase, plainText);
            });

            if (result && result.ok && result.result && 'value' in plainTextInput) {
                plainTextInput.value = result.result;
            }
        });
    }

    if (btnDecrypt && passphraseInput && plainTextInput) {
        btnDecrypt.addEventListener('click', async () => {
            const passphrase = passphraseInput.value;
            const cipherTextBase64 = 'value' in plainTextInput ? plainTextInput.value : plainTextInput.textContent;

            const result = await runAction('decrypt_text', async () => {
                return window.crp56.decryptText(passphrase, cipherTextBase64);
            });

            if (result && result.ok && result.result && 'value' in plainTextInput) {
                plainTextInput.value = result.result;
            }
        });
    }
}

function render() {
    if (!appRoot) {
        show({
            ok: false,
            error: 'Renderer initialization failed: viewRoot not found.'
        });
        return;
    }

    if (pageTitle) {
        pageTitle.textContent = routeTitle(state.route);
    }

    appRoot.innerHTML = renderRoute();
    updateActiveNav();
    bindEvents();
}

document.addEventListener('DOMContentLoaded', () => {
    log('DOM fully loaded');

    if (!output) {
        console.error('Missing #output element');
        return;
    }

    if (!window.crp56) {
        show({
            ok: false,
            error: 'window.crp56 is missing. Check preload.js and BrowserWindow preload path.'
        });
        return;
    }

    setTheme(state.theme);
    render();
    show({
        ok: true,
        status: 'Renderer loaded. Ready for testing.'
    });
});