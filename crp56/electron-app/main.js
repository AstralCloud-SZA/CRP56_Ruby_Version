const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

let mainWindow = null;
let rubyProcess = null;
const pendingRequests = new Map();
let requestCounter = 0;

process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    try {
        dialog.showErrorBox('Main Process Error', `${err.name}: ${err.message}\n\n${err.stack || ''}`);
    } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
});

function log(...args) {
    console.log('[CRP56 main]', ...args);
}

function startRubyServer() {
    const rubyCorePath = path.join(__dirname, '..', 'ruby-core');
    const isWin = process.platform === 'win32';

    const command = 'ruby';
    const args = ['main.rb', 'server'];

    log('Ruby cwd:', rubyCorePath);
    log('Spawn command:', command, args.join(' '));

    rubyProcess = spawn(command, args, {
        cwd: rubyCorePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: isWin
    });

    rubyProcess.on('spawn', () => {
        log('Ruby process spawned successfully');
    });

    rubyProcess.on('error', (err) => {
        console.error('[Ruby spawn error]', err);
    });

    const rl = readline.createInterface({
        input: rubyProcess.stdout,
        crlfDelay: Infinity
    });

    rl.on('line', (line) => {
        const raw = line;
        line = line.trim();
        if (!line) return;

        log('Ruby stdout line:', raw);

        try {
            const msg = JSON.parse(line);
            const pending = pendingRequests.get(msg.id);

            if (pending) {
                clearTimeout(pending.timeoutId);
                pendingRequests.delete(msg.id);
                pending.resolve(msg);
            } else {
                log('No pending request for Ruby message id:', msg.id);
            }
        } catch (e) {
            console.error('[Ruby stdout parse error]', e.message, raw);
        }
    });

    rubyProcess.stderr.on('data', (data) => {
        console.log('[Ruby stderr]', data.toString());
    });

    rubyProcess.on('exit', (code, signal) => {
        console.warn('[Ruby exit]', { code, signal });
        rubyProcess = null;

        for (const [id, pending] of pendingRequests.entries()) {
            clearTimeout(pending.timeoutId);
            pending.reject(new Error(`Ruby process exited before responding to request ${id}`));
        }
        pendingRequests.clear();
    });
}

function stopRubyServer() {
    if (!rubyProcess) return;

    log('Stopping Ruby process');
    try {
        rubyProcess.stdin.end();
    } catch (_) {}

    try {
        rubyProcess.kill();
    } catch (_) {}

    rubyProcess = null;
}

function sendToRuby(command, params = {}) {
    return new Promise((resolve, reject) => {
        if (!rubyProcess) {
            reject(new Error('Ruby server is not running.'));
            return;
        }

        const id = String(++requestCounter);
        const payload = { id, command, ...params };
        const line = JSON.stringify(payload) + '\n';

        log('Sending to Ruby:', payload);

        const timeoutId = setTimeout(() => {
            if (pendingRequests.has(id)) {
                pendingRequests.delete(id);
                reject(new Error(`Ruby command timed out: ${command}`));
            }
        }, 30000);

        pendingRequests.set(id, { resolve, reject, timeoutId });

        rubyProcess.stdin.write(line, (err) => {
            if (err) {
                clearTimeout(timeoutId);
                pendingRequests.delete(id);
                reject(err);
            }
        });
    });
}

async function safeInvoke(command, params = {}) {
    try {
        return await sendToRuby(command, params);
    } catch (err) {
        console.error(`[IPC ${command} failed]`, err);
        return {
            ok: false,
            error: `${err.name}: ${err.message}`
        };
    }
}

ipcMain.handle('crp56:ping', async () => {
    return safeInvoke('ping');
});

ipcMain.handle('crp56:version', async () => {
    return safeInvoke('version');
});

ipcMain.handle('crp56:encrypt-text', async (_event, { passphrase, plainText }) => {
    return safeInvoke('encrypt_text', {
        passphrase,
        plain_text: plainText
    });
});

ipcMain.handle('crp56:decrypt-text', async (_event, { passphrase, cipherTextBase64 }) => {
    return safeInvoke('decrypt_text', {
        passphrase,
        cipher_text_base64: cipherTextBase64
    });
});

ipcMain.handle('crp56:encrypt-file', async (_event, { passphrase, sourceFile, outputFile }) => {
    return safeInvoke('encrypt_file', {
        passphrase,
        source_file: sourceFile,
        output_file: outputFile
    });
});

ipcMain.handle('crp56:decrypt-file', async (_event, { passphrase, sourceFile, outputFile }) => {
    return safeInvoke('decrypt_file', {
        passphrase,
        source_file: sourceFile,
        output_file: outputFile
    });
});

ipcMain.handle('crp56:encrypt-folder', async (_event, { passphrase, sourceFolder, outputFolder }) => {
    return safeInvoke('encrypt_folder', {
        passphrase,
        source_folder: sourceFolder,
        output_folder: outputFolder
    });
});

ipcMain.handle('crp56:decrypt-folder', async (_event, { passphrase, sourceFolder, outputFolder }) => {
    return safeInvoke('decrypt_folder', {
        passphrase,
        source_folder: sourceFolder,
        output_folder: outputFolder
    });
});

ipcMain.handle('dialog:pick-file', async (_event, options = {}) => {
    return dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        ...options
    });
});

ipcMain.handle('dialog:pick-folder', async (_event, options = {}) => {
    return dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        ...options
    });
});

ipcMain.handle('dialog:pick-save-file', async (_event, options = {}) => {
    return dialog.showSaveDialog(mainWindow, options);
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 720,
        minWidth: 760,
        minHeight: 560,
        title: 'CRP56',
        backgroundColor: '#161616',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.webContents.openDevTools({ mode: 'detach' });

    mainWindow.webContents.on('did-start-loading', () => {
        log('Renderer started loading');
    });

    mainWindow.webContents.on('did-finish-load', () => {
        log('Renderer finished loading');
    });

    mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
        console.error('[Renderer failed to load]', { code, description, validatedURL });
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[Renderer process gone]', details);
    });

    const rendererPath = path.join(__dirname, 'renderer', 'index.html');
    log('Loading renderer file:', rendererPath);
    mainWindow.loadFile(rendererPath);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    log('Electron app ready');
    createWindow();

    try {
        startRubyServer();
    } catch (err) {
        console.error('[startRubyServer failed]', err);
    }
});

app.on('window-all-closed', () => {
    stopRubyServer();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopRubyServer();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});