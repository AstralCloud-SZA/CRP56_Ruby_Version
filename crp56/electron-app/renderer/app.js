const output = document.getElementById('output');

function show(data) {
    output.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function log(...args)
{
    console.log('[CRP56 renderer]', ...args);
}

window.addEventListener('error', (event) =>
{
    console.error('[Renderer error]', event.error || event.message);
    show({
        ok: false,
        error: String(event.error || event.message)
    });
});

window.addEventListener('unhandledrejection', (event) =>
{
    console.error('[Renderer unhandled rejection]', event.reason);
    show({
        ok: false,
        error: String(event.reason)
    });
});

async function runAction(label, fn)
{
    try {
        log('Running action:', label);
        show({ ok: false, status: `Running ${label}...` });

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
    }
}

document.addEventListener('DOMContentLoaded', () =>
{
    log('DOM fully loaded');

    const btnPing = document.getElementById('btn-ping');
    const btnVersion = document.getElementById('btn-version');
    const btnEncrypt = document.getElementById('btn-encrypt');
    const btnDecrypt = document.getElementById('btn-decrypt');
    const passphraseInput = document.getElementById('passphrase');
    const plainTextInput = document.getElementById('plain-text');

    if (!btnPing || !btnVersion || !btnEncrypt || !btnDecrypt || !passphraseInput || !plainTextInput || !output)
    {
        show({
            ok: false,
            error: 'Renderer initialization failed: required DOM elements not found.'
        });
        return;
    }

    if (!window.crp56)
    {
        show({
            ok: false,
            error: 'window.crp56 is missing. Check preload.js and BrowserWindow preload path.'
        });
        return;
    }

    show({
        ok: true,
        status: 'Renderer loaded. Ready for testing.'
    });

    btnPing.addEventListener('click', async () => {
        await runAction('ping', async () => {
            return window.crp56.ping();
        });
    });

    btnVersion.addEventListener('click', async () => {
        await runAction('version', async () => {
            return window.crp56.version();
        });
    });

    btnEncrypt.addEventListener('click', async () => {
        const passphrase = passphraseInput.value;
        const plainText = plainTextInput.value;

        const result = await runAction('encrypt_text', async () => {
            return window.crp56.encryptText(passphrase, plainText);
        });

        if (result && result.ok && result.result) {
            plainTextInput.value = result.result;
        }
    });

    btnDecrypt.addEventListener('click', async () => {
        const passphrase = passphraseInput.value;
        const cipherTextBase64 = plainTextInput.value;

        const result = await runAction('decrypt_text', async () => {
            return window.crp56.decryptText(passphrase, cipherTextBase64);
        });

        if (result && result.ok && result.result) {
            plainTextInput.value = result.result;
        }
    });
});