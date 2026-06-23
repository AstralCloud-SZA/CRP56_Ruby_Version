const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const fmod = require('./fmod');


let mainWindow = null;
let rubyProcess = null;
const pendingRequests = new Map();
let requestCounter = 0;

const COMMAND_TIMEOUTS = {
    encrypt_folder: 600000,
    decrypt_folder: 600000,
    encrypt_file: 120000,
    decrypt_file: 120000,
    version: 15000,
    ping: 15000
};

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

function log(...args) { console.log('[CRP56 main]', ...args); }
function musicLog(...args) { console.log('[CRP56 music]', ...args); }

function existsAny(paths)
{
    for (const p of paths)
    {
        if (p && fs.existsSync(p)) return p;
    }
    return null;
}

function resourcePath(...segments)
{
    return path.join(process.resourcesPath || path.join(__dirname, '..', 'resources'), ...segments);
}

function appPath(...segments)
{
    return path.join(__dirname, ...segments);
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

function getRubyCorePath()
{
    const candidates = app.isPackaged ? [resourcePath('ruby-core')] : [appPath('..', 'ruby-core'), appPath('ruby-core')];

    const found = existsAny(candidates);
    if (found) return found;

    const msg = app.isPackaged ? `[getRubyCorePath] packaged path not found: ${candidates[0]}` : `[getRubyCorePath] could not locate ruby-core, tried: ${candidates.join(' , ')}`;
    console.error(msg);
    throw new Error(msg);
}

function getRubyExePath()
{
    const candidates = app.isPackaged ? [resourcePath('ruby-runtime', 'bin', 'ruby.exe')] : [appPath('..', 'ruby-runtime', 'bin', 'ruby.exe'), appPath('ruby-runtime', 'bin', 'ruby.exe')];

    const found = existsAny(candidates);
    if (found) return found;

    console.warn('[getRubyExePath] falling back to system ruby');
    return 'ruby';
}



function startRubyServer()
{
    const rubyCorePath = getRubyCorePath();
    const rubyExe = getRubyExePath();
    const args = ['main.rb', 'server'];

    log('Ruby cwd:', rubyCorePath);
    log('Ruby exe:', rubyExe);
    log('Spawn command:', rubyExe, args.join(' '));

    rubyProcess = spawn(rubyExe, args, {
        cwd: rubyCorePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
    });

    rubyProcess.on('spawn', () => { log('Ruby process spawned successfully'); });
    rubyProcess.on('error', (err) => { console.error('[Ruby spawn error]', err); });

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
                log('Ruby progress:', msg);
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

function stopRubyServer()
{
    if (!rubyProcess) return;

    log('Stopping Ruby process');
    try { rubyProcess.stdin.end(); } catch (_) {}
    try { rubyProcess.kill(); } catch (_) {}
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
    }
    catch (err)
    {
        console.error(`[IPC ${command} failed]`, err);
        return { ok: false, error: `${err.name}: ${err.message}` };
    }
}

async function testRubyLaunch()
{
    const rubyExe = getRubyExePath();
    const rubyCorePath = getRubyCorePath();

    return new Promise((resolve) =>
    {
        const child = spawn(rubyExe, ['-v'], {
            cwd: rubyCorePath,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            shell: false
        });

        let out = '';
        let err = '';

        child.stdout.on('data', (data) => { out += data.toString(); });
        child.stderr.on('data', (data) => { err += data.toString(); });

        child.on('close', (code) =>
        {
            log('Ruby launch test complete');
            log('Ruby launch test path:', rubyExe);
            log('Ruby launch test exit code:', code);
            log('Ruby launch test stdout:', out.trim());
            log('Ruby launch test stderr:', err.trim());
            resolve({
                ok: code === 0,
                rubyExe,
                rubyCorePath,
                code,
                stdout: out.trim(),
                stderr: err.trim()
            });
        });
    });
}

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
    return safeInvoke('decrypt_folder', { passphrase, source: sourceFolder, output_folder: outputFolder });
});

ipcMain.handle('crp56:test-ruby-launch', async () =>
{
    return await testRubyLaunch();
});

ipcMain.handle('dialog:pick-file', async (_event, options = {}) =>
{
    const defaultOptions = { properties: ['openFile', 'multiSelections'], ...options };
    return dialog.showOpenDialog(mainWindow, defaultOptions);
});

ipcMain.handle('dialog:pick-folder', async (_event, options = {}) =>
{
    const defaultOptions = { properties: ['openDirectory'], ...options };
    return dialog.showOpenDialog(mainWindow, defaultOptions);
});

ipcMain.handle('dialog:pick-save-file', async (_event, options = {}) =>
{
    return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('sfx:listOutputDevices', async () =>
{
    try
    {
        const devices = fmod.listOutputDevices();
        console.log('[CRP56 main] sfx:listOutputDevices ->', devices);
        return devices;
    }
    catch (e)
    {
        console.error('[CRP56 main] sfx:listOutputDevices FAILED:', e);
        return [];
    }
});

ipcMain.handle('sfx:setOutputDevice', async (_event, id) =>
{
    try
    {
        console.log('[CRP56 main] sfx:setOutputDevice ->', id);
        if (typeof fmod.setOutputDevice !== 'function')
        {
            throw new Error('fmod.setOutputDevice is not implemented');
        }
        return fmod.setOutputDevice(id);
    }
    catch (e)
    {
        console.error('[CRP56 main] sfx:setOutputDevice FAILED:', e);
        return { ok: false, error: `${e.name}: ${e.message}` };
    }
});

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

ipcMain.on('music:play', (_e, name) =>
{
    musicLog('music:play listener fired with:', name);
    try
    {
        musicLog('dispatching to fmod.playMusic');
        fmod.playMusic(name);
        musicLog('music:play dispatched to fmod');
    }
    catch (e)
    {
        console.error('[CRP56 main] music:play FAILED:', e.message);
    }
});

ipcMain.on('music:stop', () =>
{
    musicLog('music:stop');
    try { fmod.stopMusic(); }
    catch (e) { console.error('[CRP56 main] music:stop FAILED:', e.message); }
});

ipcMain.handle('music:list', () =>
{
    const list = fmod.listMusic();
    musicLog('music:list ->', list);
    return list;
});

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

    if (!app.isPackaged)
    {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    const rendererPath = path.join(__dirname, 'renderer', 'index.html');
    mainWindow.loadFile(rendererPath);

    mainWindow.webContents.on('did-finish-load', () =>
    {
        log('Renderer finished load');
    });

    mainWindow.on('closed', () =>
    {
        mainWindow = null;
    });
}

app.whenReady().then(async () =>
{
    log('Electron app ready');

    try
    {
        log('Initializing FMOD...');
        fmod.init();
        log('FMOD init complete');
    }
    catch (err)
    {
        console.error('[FMOD init failed]', err);
    }

    createWindow();

    try
    {
        await testRubyLaunch();
        startRubyServer();
    }
    catch (err)
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
    try { fmod.shutdown(); } catch (_) {}
});

app.on('activate', () =>
{
    if (BrowserWindow.getAllWindows().length === 0)
    {
        createWindow();
    }
});