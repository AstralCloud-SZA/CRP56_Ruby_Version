const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

let mainWindow = null;
let rubyProcess = null;
const pendingRequests = new Map();
let requestCounter = 0;

// ── Ruby process ────────────────────────────────────────────────────────────

function startRubyServer() {
    const rubyCorePath = path.join(__dirname, '..', 'ruby-core');

    rubyProcess = spawn('bundle', ['exec', 'ruby', 'main.rb', 'server'], {cwd: rubyCorePath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,});

    const rl = readline.createInterface({ input: rubyProcess.stdout });

    rl.on('line', (line) =>
    {
        line = line.trim();
        if (!line) return;

        try {
            const msg = JSON.parse(line);
            const resolve = pendingRequests.get(msg.id);
            if (resolve) {
                pendingRequests.delete(msg.id);
                resolve(msg);
            }
        } catch (e) {
            console.error('[Ruby stdout parse error]', e.message, line);
        }
    });

    rubyProcess.stderr.on('data', (data) =>
    {
        console.log('[Ruby]', data.toString().trim());
    });

    rubyProcess.on('exit', (code) =>
    {
        console.warn('[Ruby] process exited with code', code);
        rubyProcess = null;
    });
}

function sendToRuby(command, params = {})
{
    return new Promise((resolve, reject) =>
    {
        if (!rubyProcess)
        {
            return reject(new Error('Ruby server is not running.'));
        }

        const id = String(++requestCounter);
        pendingRequests.set(id, resolve);

        const message = JSON.stringify({ id, command, ...params }) + '\n';
        rubyProcess.stdin.write(message);

        // Timeout after 30 seconds
        setTimeout(() =>
        {
            if (pendingRequests.has(id)) {
                pendingRequests.delete(id);
                reject(new Error(`Ruby command timed out: ${command}`));
            }
        }, 30000);
    });
}

// ── IPC handlers (renderer → main → Ruby) ───────────────────────────────────

ipcMain.handle('crp56:ping', async () =>
{
    return sendToRuby('ping');
});

ipcMain.handle('crp56:encrypt-text', async (_event, { passphrase, plainText }) =>
{
    return sendToRuby('encrypt_text', { passphrase, plain_text: plainText });
});

ipcMain.handle('crp56:decrypt-text', async (_event, { passphrase, cipherTextBase64 }) =>
{
    return sendToRuby('decrypt_text', { passphrase, cipher_text_base64: cipherTextBase64 });
});

ipcMain.handle('crp56:encrypt-file', async (_event, { passphrase, sourceFile, outputFile }) =>
{
    return sendToRuby('encrypt_file', { passphrase, source_file: sourceFile, output_file: outputFile });
});

ipcMain.handle('crp56:decrypt-file', async (_event, { passphrase, sourceFile, outputFile }) =>
{
    return sendToRuby('decrypt_file', { passphrase, source_file: sourceFile, output_file: outputFile });
});

ipcMain.handle('crp56:version', async () => {
    return sendToRuby('version');
});

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 680,
        minWidth: 700,
        minHeight: 500,
        webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,},
        titleBarStyle: 'hiddenInset',
        title: 'CRP56',
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
    startRubyServer();
    createWindow();
});

app.on('window-all-closed', () => {
    if (rubyProcess) {
        rubyProcess.stdin.end();
        rubyProcess.kill();
    }
    if (process.platform !== 'darwin') app.quit();
});