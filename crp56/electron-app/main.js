const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const readline = require('readline');
const fmod = require('./fmod');
const collapseLog = require('./collapse_logger');
const collapseSecret = require('./collapse_secret');


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

/* ============================================================
   GRAVITY COLLAPSE — secure wipe engine + guard
   ------------------------------------------------------------
   ⚠ DANGER SWITCH: leave COLLAPSE_ALLOW_SYSTEM = false unless you
   truly accept that a mistake here can destroy your OS. With it
   false, the system drive, the app/exe drive, home/profile, and
   well-known critical roots are all blocked.
   ============================================================ */
const COLLAPSE_ALLOW_SYSTEM = false;

const COLLAPSE_PASSES = {
    quick:   [],                          // delete only, no overwrite
    single:  ['random'],                  // 1 pass random
    dod:     ['zero', 'one', 'random'],   // DoD 5220.22-M style 3-pass
    gutmann: ['random', 'zero', 'one', 'random', '0xFF', 'random', 'zero'], // 7-pass approximation
};

let collapseAborted = false;

function collapseNormalize(p) { return path.resolve(p).replace(/[\\/]+$/, '') + path.sep; }

function collapseProtectedRoots()
{
    const roots = new Set();
    const sysDrive = (process.env.SystemDrive || 'C:') + path.sep;
    const winDir = process.env.windir || 'C:\\Windows';

    [
        sysDrive,
        path.parse(process.execPath).root,
        path.parse(app.getAppPath()).root,
        winDir,
        os.homedir(),
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        process.env.ProgramData,
        '/', '/boot', '/etc', '/usr', '/System', '/Library',
        app.getPath('userData'),
        app.getPath('home'),
    ].filter(Boolean).forEach((r) => roots.add(collapseNormalize(r)));

    return roots;
}

function collapseEvaluateGuard(targetPath)
{
    if (COLLAPSE_ALLOW_SYSTEM) return { blocked: false, reason: '' };
    const tgt = collapseNormalize(targetPath);
    const roots = collapseProtectedRoots();

    for (const root of roots)
    {
        if (tgt === root) return { blocked: true, reason: 'Protected root: ' + root };
        if (root.startsWith(tgt)) return { blocked: true, reason: 'Target contains protected location: ' + root };
    }

    const sysDrive = collapseNormalize(process.env.SystemDrive || 'C:');
    if (tgt === sysDrive) return { blocked: true, reason: 'System drive is protected' };

    return { blocked: false, reason: '' };
}

async function collapseScan(target, limit = 200000)
{
    let items = 0, size = 0, capped = false;
    const stack = [target];
    while (stack.length)
    {
        const dir = stack.pop();
        let entries = [];
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
        catch { continue; }
        for (const e of entries)
        {
            const full = path.join(dir, e.name);
            items++;
            if (items > limit) { capped = true; return { items, size, capped }; }
            if (e.isDirectory() && !e.isSymbolicLink()) stack.push(full);
            else { try { const st = await fsp.lstat(full); size += st.size; } catch {} }
        }
    }
    return { items, size, capped };
}

async function collapseCollectFiles(target)
{
    const files = [];
    const dirs = [];
    const stack = [target];
    while (stack.length)
    {
        const dir = stack.pop();
        dirs.push(dir);
        let entries = [];
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
        catch { continue; }
        for (const e of entries)
        {
            const full = path.join(dir, e.name);
            if (e.isDirectory() && !e.isSymbolicLink()) stack.push(full);
            else files.push(full);
        }
    }
    return { files, dirs: dirs.reverse() }; // deepest dirs first
}

function collapsePatternBuffer(kind, len)
{
    const buf = Buffer.allocUnsafe(len);
    if (kind === 'zero') buf.fill(0x00);
    else if (kind === 'one') buf.fill(0x01);
    else if (kind === '0xFF') buf.fill(0xff);
    else { for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256); }
    return buf;
}

async function collapseOverwriteFile(file, passes)
{
    if (!passes.length) return;
    let st;
    try { st = await fsp.lstat(file); } catch { return; }
    if (!st.isFile() || st.size === 0) return;

    const CHUNK = 1 << 20; // 1 MB
    const fh = await fsp.open(file, 'r+');
    try
    {
        for (const kind of passes)
        {
            if (collapseAborted) throw new Error('Aborted');
            let remaining = st.size, pos = 0;
            while (remaining > 0)
            {
                if (collapseAborted) throw new Error('Aborted');
                const len = Math.min(CHUNK, remaining);
                const buf = collapsePatternBuffer(kind, len);
                await fh.write(buf, 0, len, pos);
                pos += len; remaining -= len;
            }
            await fh.sync();
        }
    }
    finally { await fh.close(); }
}

async function collapseRun(job, send)
{
    collapseAborted = false;
    const { path: target, type, mode } = job;
    const guard = collapseEvaluateGuard(target);
    if (guard.blocked) throw new Error('Guard blocked: ' + guard.reason);

    const passes = COLLAPSE_PASSES[mode] || COLLAPSE_PASSES.single;
    send({ phase: 'Scanning', pct: 0 });

    const { files, dirs } = await collapseCollectFiles(target);
    const totalUnits = files.length * Math.max(1, passes.length) + files.length + dirs.length;
    let done = 0;

    for (const f of files)
    {
        if (collapseAborted) throw new Error('Aborted');
        try
        {
            await collapseOverwriteFile(f, passes);
            done += Math.max(1, passes.length);
            const obscured = path.join(path.dirname(f), 'x' + Math.random().toString(36).slice(2));
            try { await fsp.rename(f, obscured); await fsp.unlink(obscured); }
            catch { await fsp.rm(f, { force: true }); }
            done += 1;
        }
        catch (e)
        {
            if (collapseAborted) throw e;
            try { await fsp.rm(f, { force: true }); } catch {}
            done += Math.max(1, passes.length) + 1;
        }
        if (done % 8 === 0 || files.length < 50)
        {
            send({ phase: passes.length ? 'Overwriting' : 'Deleting', pct: (done / totalUnits) * 100, current: f, done, total: totalUnits });
        }
    }

    for (const d of dirs)
    {
        if (collapseAborted) throw new Error('Aborted');
        try { await fsp.rm(d, { recursive: true, force: true }); } catch {}
        done += 1;
        send({ phase: 'Crushing', pct: (done / totalUnits) * 100, current: d, done, total: totalUnits });
    }

    // folder target: remove the root too; drive target: keep the volume root mounted
    if (type !== 'drive')
    {
        try { await fsp.rm(target, { recursive: true, force: true }); } catch {}
    }

    send({ phase: 'Complete', pct: 100, done: totalUnits, total: totalUnits });
    return { ok: true, files: files.length, dirs: dirs.length };
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

/* ---------------- Gravity Collapse IPC ---------------- */
ipcMain.handle('collapse:guard-status', () => !COLLAPSE_ALLOW_SYSTEM);

ipcMain.handle('collapse:verify-password', (_event, candidate) =>
{
    try { return collapseSecret.verify(candidate); }
    catch (e) { console.error('[collapse:verify-password failed]', e); return false; }
});

ipcMain.handle('collapse:select-target', async (_event, kind) =>
{
    const res = await dialog.showOpenDialog(mainWindow, {
        title: kind === 'drive' ? 'Select a drive/volume root' : 'Select a folder',
        properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;

    const target = res.filePaths[0];
    const guard = collapseEvaluateGuard(target);
    const { items, size, capped } = await collapseScan(target);
    return { path: target, type: kind, items, size, capped, blocked: guard.blocked, reason: guard.reason };
});

ipcMain.handle('collapse:confirm-destroy', async (_event, { path: targetPath, mode }) =>
{
    const guard = collapseEvaluateGuard(targetPath);
    if (guard.blocked)
    {
        collapseLog.record({ path: targetPath, mode, status: 'blocked', error: guard.reason });
        await dialog.showMessageBox(mainWindow, {type: 'error', title: 'Collapse blocked', message: 'Gravity guard blocked this target.', detail: guard.reason,});
        return false;
    }
    const r = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'COLLAPSE'],
        defaultId: 0,
        cancelId: 0,
        title: 'Confirm Gravity Collapse',
        message: 'Permanently destroy this target?',
        detail: `${targetPath}\n\nMode: ${mode}\n\nThis cannot be undone. Files are overwritten and erased.`,
    });
    return r.response === 1;
});

ipcMain.handle('collapse:run', async (event, job) =>
{
    // Defense in depth: never wipe unless the supplied password verifies in main.
    if (!collapseSecret.verify(job && job.password))
    {
        const msg = 'Password verification failed';
        await collapseLog.record({
            path: job && job.path,
            type: job && job.type,
            mode: job && job.mode,
            status: 'failed',
            error: msg
        });
        return { ok: false, error: msg };
    }

    const send = (p) =>
    {
        try
        {
            if (mainWindow && !mainWindow.isDestroyed())
            {
                mainWindow.webContents.send('collapse:progress', p);
            }
        }
        catch (_) {}
    };
    const startedAt = Date.now();
    try
    {
        const result = await collapseRun(job, send);
        collapseLog.record({
            path: job && job.path, type: job && job.type, mode: job && job.mode,
            status: 'completed', files: result.files, dirs: result.dirs,
            durationMs: Date.now() - startedAt,
        });
        return result;
    }
    catch (err)
    {
        console.error('[collapse:run failed]', err);
        const aborted = /abort/i.test(err && err.message || '');
        collapseLog.record({
            path: job && job.path, type: job && job.type, mode: job && job.mode,
            status: aborted ? 'aborted' : 'failed', error: `${err.name}: ${err.message}`,
            durationMs: Date.now() - startedAt,
        });
        return { ok: false, error: `${err.name}: ${err.message}` };
    }
});

ipcMain.handle('collapse:abort', () => { collapseAborted = true; return true; });

ipcMain.handle('collapse:log-read', async (_event, limit) =>
{
    try { return await collapseLog.read(typeof limit === 'number' ? limit : 100); }
    catch (e) { console.error('[collapse:log-read failed]', e); return []; }
});

ipcMain.handle('collapse:log-clear', async () =>
{
    try { return await collapseLog.clear(); }
    catch (e) { console.error('[collapse:log-clear failed]', e); return false; }
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
        webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false}
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

    try { log('Collapse audit log at:', collapseLog.init(app)); }
    catch (err) { console.error('[collapse-logger init failed]', err); }

    try
    {
        const s = collapseSecret.init(app);
        log('Collapse secret at:', s.path, s.seeded ? '(seeded from INITIAL_PASSWORD)' : (s.exists ? '(existing)' : '(NOT SET)'));
    }
    catch (err) { console.error('[collapse-secret init failed]', err); }

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