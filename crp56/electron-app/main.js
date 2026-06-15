const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const fmod = require('./fmod');

/**
 * Main application window reference.
 * Set when the BrowserWindow is created and cleared on close.
 */
let mainWindow = null;

/**
 * Child process handle for the Ruby backend server.
 * This process handles encryption, decryption, and other backend commands.
 */
let rubyProcess = null;

/**
 * Tracks pending JSON-RPC style requests sent to the Ruby process.
 * Each request is stored by id until a response arrives or times out.
 */
const pendingRequests = new Map();

/**
 * Monotonic request counter used to assign unique ids to outbound Ruby calls.
 */
let requestCounter = 0;

/**
 * Command-specific timeout values in milliseconds.
 * Long-running folder operations get more time than simple file operations.
 */
const COMMAND_TIMEOUTS = {
    encrypt_folder: 600000,
    decrypt_folder: 600000,
    encrypt_file: 120000,
    decrypt_file: 120000
};

/**
 * Default timeout for commands that do not have a custom timeout value.
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Global crash handler for unexpected exceptions in the Electron main process.
 * Shows a native error dialog and logs the stack trace for debugging.
 */
process.on('uncaughtException', (err) =>
{
    console.error('[uncaughtException]', err);
    try
    {
        dialog.showErrorBox('Main Process Error', `${err.name}: ${err.message}\n\n${err.stack || ''}`);
    } catch (_) {}
});

/**
 * Global rejection handler for unhandled promise rejections.
 * Keeps backend failures visible in the main process logs.
 */
process.on('unhandledRejection', (reason) => {console.error('[unhandledRejection]', reason);});

/**
 * Convenience logger for app-level main process messages.
 */
function log(...args) {console.log('[CRP56 main]', ...args);}

/**
 * Resets the timeout timer for a pending Ruby request.
 * If the request stays active past its timeout, it is rejected and removed.
 *
 * @param {string} id - Request id previously assigned in sendToRuby().
 */
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

/**
 * Starts the Ruby backend server as a child process.
 *
 * The Electron main process spawns `ruby main.rb server` in the ruby-core
 * directory and communicates with it over stdin/stdout using newline-delimited
 * JSON messages.
 */
function startRubyServer()
{
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

    rubyProcess.on('spawn', () => {log('Ruby process spawned successfully');});
    rubyProcess.on('error', (err) => {console.error('[Ruby spawn error]', err);});

    const rl = readline.createInterface({ input: rubyProcess.stdout, crlfDelay: Infinity });

    rl.on('line', (line) =>
    {
        const raw = line;
        line = line.trim();
        if (!line) return;

        try
        {
            const msg = JSON.parse(line);

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
            }
            else
            {
                log('No pending request for Ruby message id:', msg.id);
            }
        }
        catch (e)
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

/**
 * Stops the Ruby backend process if it is currently running.
 * This is called during app shutdown and before quit.
 */
function stopRubyServer()
{
    if (!rubyProcess) return;

    log('Stopping Ruby process');
    try { rubyProcess.stdin.end(); } catch (_) {}
    try { rubyProcess.kill(); } catch (_) {}
    rubyProcess = null;
}

/**
 * Sends a command to the Ruby backend and returns a promise for the response.
 *
 * @param {string} command - Ruby backend command name.
 * @param {object} params - JSON-serializable command parameters.
 * @returns {Promise<object>} parsed Ruby response.
 */
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

/**
 * Wrapper around sendToRuby() that converts thrown errors into a structured
 * failure response instead of rejecting the IPC handler.
 *
 * @param {string} command - Ruby backend command name.
 * @param {object} params - JSON-serializable command parameters.
 * @returns {Promise<object>} success or error payload
 */
async function safeInvoke(command, params = {})
{
    try
    {
        return await sendToRuby(command, params);
    }
    catch (err)
    {
        console.error(`[IPC ${command} failed]`, err);
        return { ok: false, error: `${err.name}: ${err.message}` };
    }
}

/**
 * Simple health check handler for the renderer.
 */
ipcMain.handle('crp56:ping', async () => safeInvoke('ping'));

/**
 * Returns the backend version or build info.
 */
ipcMain.handle('crp56:version', async () => safeInvoke('version'));

/**
 * Encrypts plain text via the Ruby backend.
 *
 * Expected renderer payload:
 * { passphrase, plainText }
 */
ipcMain.handle('crp56:encrypt-text', async (_event, { passphrase, plainText }) =>
{
    return safeInvoke('encrypt_text', { passphrase, plain_text: plainText });
});

/**
 * Decrypts Base64 text via the Ruby backend.
 *
 * Expected renderer payload:
 * { passphrase, cipherTextBase64 }
 */
ipcMain.handle('crp56:decrypt-text', async (_event, { passphrase, cipherTextBase64 }) =>
{
    return safeInvoke('decrypt_text', { passphrase, cipher_text_base64: cipherTextBase64 });
});

/**
 * Encrypts a single file via the Ruby backend.
 *
 * Expected renderer payload:
 * { passphrase, sourceFile, outputFile }
 */
ipcMain.handle('crp56:encrypt-file', async (_event, { passphrase, sourceFile, outputFile }) =>
{
    return safeInvoke('encrypt_file', { passphrase, source_file: sourceFile, output_file: outputFile });
});

/**
 * Decrypts a single file via the Ruby backend.
 *
 * Expected renderer payload:
 * { passphrase, sourceFile, outputFile }
 */
ipcMain.handle('crp56:decrypt-file', async (_event, { passphrase, sourceFile, outputFile }) =>
{
    return safeInvoke('decrypt_file', { passphrase, source_file: sourceFile, output_file: outputFile });
});

/**
 * Encrypts a folder via the Ruby backend.
 *
 * Expected renderer payload:
 * { passphrase, sourceFolder, outputFolder }
 */
ipcMain.handle('crp56:encrypt-folder', async (_event, { passphrase, sourceFolder, outputFolder }) =>
{
    return safeInvoke('encrypt_folder', { passphrase, source_folder: sourceFolder, output_folder: outputFolder });
});

/**
 * Decrypts encrypted folder containers via the Ruby backend.
 *
 * Expected renderer payload:
 * { passphrase, sourceFolder, outputFolder }
 */
ipcMain.handle('crp56:decrypt-folder', async (_event, { passphrase, sourceFolder, outputFolder }) =>
{
    return safeInvoke('decrypt_folder', {passphrase, source: sourceFolder, output_folder: outputFolder});
});

/**
 * Opens a native file picker dialog.
 *
 * Default behavior:
 * - openFile
 * - multiSelections
 */
ipcMain.handle('dialog:pick-file', async (_event, options = {}) =>
{
    const defaultOptions = { properties: ['openFile', 'multiSelections'], ...options };
    return dialog.showOpenDialog(mainWindow, defaultOptions);
});

/**
 * Opens a native folder picker dialog.
 *
 * Default behavior:
 * - openDirectory
 */
ipcMain.handle('dialog:pick-folder', async (_event, options = {}) =>
{
    const defaultOptions = { properties: ['openDirectory'], ...options };
    return dialog.showOpenDialog(mainWindow, defaultOptions);
});

/**
 * Opens a native save-file dialog.
 */
ipcMain.handle('dialog:pick-save-file', async (_event, options = {}) =>
{
    return dialog.showSaveDialog(mainWindow, options);
});

/**
 * Plays an FMOD sound effect by category.
 */
ipcMain.on('sfx:play', (_event, category) =>
{
    console.log('[CRP56 main] sfx:play ->', category);
    try { fmod.play(category); }
    catch (e) { console.error('[CRP56 main] fmod.play FAILED:', e.message); }
});

ipcMain.on('sfx:any', () => fmod.playAny());
ipcMain.on('sfx:volume', (_event, v) => fmod.setSfxVolume(v));
ipcMain.on('music:volume', (_event, v) => fmod.setMusicVolume(v));
ipcMain.on('master:volume', (_e, v) => fmod.setMasterVolume(v));
ipcMain.on('audio:mute', (_e, muted) => fmod.setMuteAll(muted));
ipcMain.on('music:play', (_e, name) => fmod.playMusic(name));
ipcMain.on('music:stop', () => fmod.stopMusic());
ipcMain.handle('music:list', () => fmod.listMusic());

/**
 * Creates the main BrowserWindow and loads the renderer entry point.
 *
 * Security settings:
 * - contextIsolation enabled
 * - nodeIntegration disabled
 * - preload script used for safe renderer API exposure
 */
function createWindow()
{
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
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.webContents.openDevTools({ mode: 'detach' });

    const rendererPath = path.join(__dirname, 'renderer', 'index.html');
    mainWindow.loadFile(rendererPath);

    mainWindow.on('closed', () => { mainWindow = null; });
}

/**
 * App startup sequence.
 * Initializes audio, creates the main window, and starts the Ruby backend.
 */
app.whenReady().then(() =>
{
    log('Electron app ready');

    try
    {
        fmod.init();
    }
    catch (err)
    {
        console.error('[FMOD init failed]', err);
    }

    createWindow();

    try
    {
        startRubyServer();
    }
    catch (err)
    {
        console.error('[startRubyServer failed]', err);
    }
});

/**
 * Closes the app when all windows are closed on non-macOS platforms.
 */
app.on('window-all-closed', () =>
{
    stopRubyServer();
    if (process.platform !== 'darwin')
    {
        app.quit();
    }
});

/**
 * Ensures the Ruby backend and audio subsystem are shut down before exit.
 */
app.on('before-quit', () =>
{
    stopRubyServer();
    try { fmod.shutdown(); } catch (_) {}
});

/**
 * Recreates the main window when the app is reactivated on macOS.
 */
app.on('activate', () =>
{
    if (BrowserWindow.getAllWindows().length === 0)
    {
        createWindow();
    }
});