const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

let mainWindow = null;
let rubyProcess = null;
const pendingRequests = new Map();
let requestCounter = 0;

// Per-command timeouts (ms). Folder jobs can take a long time, and every
// progress event from Ruby refreshes the timer, so these only fire when the
// core goes truly silent.
const COMMAND_TIMEOUTS = {encrypt_folder: 600000, decrypt_folder: 600000, encrypt_file: 120000, decrypt_file: 120000};
const DEFAULT_TIMEOUT = 30000;

process.on('uncaughtException', (err) =>
{
    console.error('[uncaughtException]', err);
    try
    {
        dialog.showErrorBox('Main Process Error', `${err.name}: ${err.message}\n\n${err.stack || ''}`);
    } catch (_) {}
});

process.on('unhandledRejection', (reason) =>
{
    console.error('[unhandledRejection]', reason);
});

function log(...args)
{
    console.log('[CRP56 main]', ...args);
}

function armTimeout(id)
{
    const pending = pendingRequests.get(id);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    pending.timeoutId = setTimeout(() =>
    {
        if (pendingRequests.has(id))
        {
            pendingRequests.delete(id);
            pending.reject(new Error(`Ruby command timed out: ${pending.command}`));
        }
    }, pending.timeoutMs);
}

function startRubyServer()
{
    const rubyCorePath = path.join(__dirname, '..', 'ruby-core');
    const isWin = process.platform === 'win32';

    const command = 'ruby';
    const args = ['main.rb', 'server'];

    log('Ruby cwd:', rubyCorePath);
    log('Spawn command:', command, args.join(' '));

    rubyProcess = spawn(command, args, {cwd: rubyCorePath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: isWin});

    rubyProcess.on('spawn', () => {log('Ruby process spawned successfully');});

    rubyProcess.on('error', (err) => {console.error('[Ruby spawn error]', err);});

    const rl = readline.createInterface({input: rubyProcess.stdout, crlfDelay: Infinity});

    rl.on('line', (line) =>
    {
        const raw = line;
        line = line.trim();
        if (!line) return;

        try {
            const msg = JSON.parse(line);

            // Progress events: forward to the renderer, refresh the timeout,
            // and keep the request pending until the final response arrives.
            if (msg.event === 'progress')
            {
                if (pendingRequests.has(msg.id)) armTimeout(msg.id);
                if (mainWindow && !mainWindow.isDestroyed())
                {
                    mainWindow.webContents.send('crp56:progress', msg);
                }
                return;
            }

            log('Ruby stdout line:', raw);

            const pending = pendingRequests.get(msg.id);

            if (pending)
            {
                clearTimeout(pending.timeoutId);
                pendingRequests.delete(msg.id);
                pending.resolve(msg);
            } else
            {
                log('No pending request for Ruby message id:', msg.id);
            }
        } catch (e)
        {
            console.error('[Ruby stdout parse error]', e.message, raw);
        }
    });

    rubyProcess.stderr.on('data', (data) =>
    {
        console.log('[Ruby stderr]', data.toString());
    });

    rubyProcess.on('exit', (code, signal) =>
    {
        console.warn('[Ruby exit]', { code, signal });
        rubyProcess = null;

        for (const [id, pending] of pendingRequests.entries())
        {
            clearTimeout(pending.timeoutId);
            pending.reject(new Error(`Ruby process exited before responding to request ${id}`));
        }
        pendingRequests.clear();
    });
}

function stopRubyServer()
{
    if (!rubyProcess) return;

    log('Stopping Ruby process');
    try
    {
        rubyProcess.stdin.end();
    } catch (_)
    {}

    try
    {
        rubyProcess.kill();
    } catch (_) {}

    rubyProcess = null;
}

function sendToRuby(command, params = {})
{
    return new Promise((resolve, reject) =>
    {
        if (!rubyProcess)
        {
            reject(new Error('Ruby server is not running.'));
            return;
        }

        const id = String(++requestCounter);
        const payload = { id, command, ...params };
        const line = JSON.stringify(payload) + '\n';

        log('Sending to Ruby:', payload);

        const timeoutMs = COMMAND_TIMEOUTS[command] ?? DEFAULT_TIMEOUT;

        pendingRequests.set(id, { resolve, reject, command, timeoutMs, timeoutId: null });
        armTimeout(id);

        rubyProcess.stdin.write(line, (err) =>
        {
            if (err)
            {
                const pending = pendingRequests.get(id);
                if (pending) clearTimeout(pending.timeoutId);
                pendingRequests.delete(id);
                reject(err);
            }
        });
    });
}

async function safeInvoke(command, params = {})
{
    try
    {
        return await sendToRuby(command, params);
    } catch (err)
    {
        console.error(`[IPC ${command} failed]`, err);
        return {ok: false, error: `${err.name}: ${err.message}`};
    }
}

// --- RUBY INTERFACE HANDLERS ---
ipcMain.handle('crp56:ping', async () => safeInvoke('ping'));
ipcMain.handle('crp56:version', async () => safeInvoke('version'));

ipcMain.handle('crp56:encrypt-text', async (_event, { passphrase, plainText }) =>
{
    return safeInvoke('encrypt_text', { passphrase, plain_text: plainText });
});

ipcMain.handle('crp56:decrypt-text', async (_event, { passphrase, cipherTextBase64 }) =>
{
    return safeInvoke('decrypt_text', { passphrase, cipher_text_base64: cipherTextBase64 });
});

ipcMain.handle('crp56:encrypt-file', async (_event, { passphrase, sourceFile, outputFile }) =>
{
    return safeInvoke('encrypt_file', { passphrase, source_file: sourceFile, output_file: outputFile });
});

ipcMain.handle('crp56:decrypt-file', async (_event, { passphrase, sourceFile, outputFile }) =>
{
    return safeInvoke('decrypt_file', { passphrase, source_file: sourceFile, output_file: outputFile });
});

ipcMain.handle('crp56:encrypt-folder', async (_event, { passphrase, sourceFolder, outputFolder }) =>
{
    return safeInvoke('encrypt_folder', { passphrase, source_folder: sourceFolder, output_folder: outputFolder });
});

ipcMain.handle('crp56:decrypt-folder', async (_event, { passphrase, sourceFolder, outputFolder }) =>
{
    return safeInvoke('decrypt_folder', { passphrase, source_folder: sourceFolder, output_folder: outputFolder });
});

// --- DIALOG HANDLERS ---

ipcMain.handle('dialog:pick-file', async (_event, options = {}) =>
{
    // Defaults to allowing multiple files for the 'File Containment' field
    const defaultOptions = {properties: ['openFile', 'multiSelections'], ...options};
    return dialog.showOpenDialog(mainWindow, defaultOptions);
});

ipcMain.handle('dialog:pick-folder', async (_event, options = {}) =>
{
    const defaultOptions = {properties: ['openDirectory'], ...options};
    return dialog.showOpenDialog(mainWindow, defaultOptions);
});

ipcMain.handle('dialog:pick-save-file', async (_event, options = {}) =>
{
    return dialog.showSaveDialog(mainWindow, options);
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1348,
        height: 928,
        minWidth: 900,
        minHeight: 650,
        maxWidth: 1935,
        maxHeight: 1245,
        title: 'CRP56',
        backgroundColor: '#161616',
        autoHideMenuBar: true,
        webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false}
    });

    mainWindow.webContents.openDevTools({ mode: 'detach' });

    const rendererPath = path.join(__dirname, 'renderer', 'index.html');
    mainWindow.loadFile(rendererPath);

    mainWindow.on('closed', () => {mainWindow = null;});
}

app.whenReady().then(() =>
{
    log('Electron app ready');
    createWindow();
    try
    {
        startRubyServer();
    } catch (err)
    {
        console.error('[startRubyServer failed]', err);
    }
});

app.on('window-all-closed', () =>
{
    stopRubyServer();
    if (process.platform !== 'darwin')
    {
        app.quit();
    }
});

app.on('before-quit', () =>
{
    stopRubyServer();
});

app.on('activate', () =>
{
    if (BrowserWindow.getAllWindows().length === 0)
    {
        createWindow();
    }
});