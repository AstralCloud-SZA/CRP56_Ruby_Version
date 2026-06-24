const { contextBridge, ipcRenderer } = require('electron');

/**
 * Whitelisted IPC channels for CRP56 main-process requests.
 * Only these channels may be invoked from the renderer.
 */
const ALLOWED_CHANNELS = new Set([
    'crp56:ping',
    'crp56:version',
    'crp56:encrypt-text',
    'crp56:decrypt-text',
    'crp56:encrypt-file',
    'crp56:decrypt-file',
    'crp56:encrypt-folder',
    'crp56:decrypt-folder',
    'dialog:pick-file',
    'dialog:pick-folder',
    'dialog:pick-save-file',
    // --- Gravity Collapse ---
    'collapse:guard-status',
    'collapse:verify-password',
    'collapse:select-target',
    'collapse:confirm-destroy',
    'collapse:run',
    'collapse:abort',
    'collapse:log-read',
    'collapse:log-clear',
]);

function log(...args)
{
    console.log('[CRP56 preload]', ...args);
}

function invoke(channel, payload)
{
    if (!ALLOWED_CHANNELS.has(channel))
    {
        log('blocked invoke', channel, payload);
        return Promise.reject(new Error(`[crp56 preload] Blocked channel: "${channel}"`));
    }

    log('invoke', channel, payload);

    return payload !== undefined ? ipcRenderer.invoke(channel, payload) : ipcRenderer.invoke(channel);
}

contextBridge.exposeInMainWorld('crp56', {
    ping: () =>
    {
        log('ping()');
        return invoke('crp56:ping');
    },
    version: () =>
    {
        log('version()');
        return invoke('crp56:version');
    },

    encryptText: (passphrase, plainText) =>
    {
        log('encryptText()', { hasPassphrase: !!passphrase, plainTextLength: plainText?.length ?? 0 });
        return invoke('crp56:encrypt-text', { passphrase, plainText });
    },
    decryptText: (passphrase, cipherTextBase64) =>
    {
        log('decryptText()', { hasPassphrase: !!passphrase, cipherLen: cipherTextBase64?.length ?? 0 });
        return invoke('crp56:decrypt-text', { passphrase, cipherTextBase64 });
    },

    encryptFile: (passphrase, sourceFile, outputFile) =>
    {
        log('encryptFile()', { sourceFile, outputFile });
        return invoke('crp56:encrypt-file', { passphrase, sourceFile, outputFile });
    },
    decryptFile: (passphrase, sourceFile, outputFile) =>
    {
        log('decryptFile()', { sourceFile, outputFile });
        return invoke('crp56:decrypt-file', { passphrase, sourceFile, outputFile });
    },

    encryptFolder: (passphrase, sourceFolder, outputFolder) =>
    {
        log('encryptFolder()', { sourceFolder, outputFolder });
        return invoke('crp56:encrypt-folder', { passphrase, sourceFolder, outputFolder });
    },
    decryptFolder: (passphrase, sourceFolder, outputFolder) =>
    {
        log('decryptFolder()', { sourceFolder, outputFolder });
        return invoke('crp56:decrypt-folder', { passphrase, sourceFolder, outputFolder });
    },

    pickFile: (options) =>
    {
        log('pickFile()', options);
        return invoke('dialog:pick-file', options ?? {});
    },
    pickFolder: (options) =>
    {
        log('pickFolder()', options);
        return invoke('dialog:pick-folder', options ?? {});
    },
    pickSaveFile: (options) =>
    {
        log('pickSaveFile()', options);
        return invoke('dialog:pick-save-file', options ?? {});
    },

    onProgress: (callback) =>
    {
        log('onProgress() attach');
        const listener = (_event, data) =>
        {
            log('progress event', data);
            callback(data);
        };
        ipcRenderer.on('crp56:progress', listener);
        return () =>
        {
            log('onProgress() unsubscribe');
            ipcRenderer.removeListener('crp56:progress', listener);
        };
    },
});

/**
 * Gravity Collapse bridge.
 * Exposed as window.collapseAPI so gravitional_collapse.js can drive the
 * destruction chamber. All channels route through the allowlisted invoke().
 */
contextBridge.exposeInMainWorld('collapseAPI', {
    guardStatus: () =>
    {
        log('collapse.guardStatus()');
        return invoke('collapse:guard-status');
    },
    verifyPassword: (candidate) =>
    {
        log('collapse.verifyPassword()', { len: candidate?.length ?? 0 });
        return invoke('collapse:verify-password', candidate);
    },
    selectTarget: (kind) =>
    {
        log('collapse.selectTarget()', kind);
        return invoke('collapse:select-target', kind);
    },
    confirmDestroy: (targetPath, mode) =>
    {
        log('collapse.confirmDestroy()', { targetPath, mode });
        return invoke('collapse:confirm-destroy', { path: targetPath, mode });
    },
    abort: () =>
    {
        log('collapse.abort()');
        return invoke('collapse:abort');
    },
    readLog: (limit) =>
    {
        log('collapse.readLog()', limit);
        return invoke('collapse:log-read', limit);
    },
    clearLog: () =>
    {
        log('collapse.clearLog()');
        return invoke('collapse:log-clear');
    },

    /**
     * run(job, onProgress) -> Promise<result>
     * job: { path, type:'folder'|'drive', mode:'quick'|'single'|'dod'|'gutmann' }
     * Progress streams on the 'collapse:progress' channel.
     */
    run: (job, onProgress) =>
    {
        log('collapse.run()', job);
        const listener = (_event, data) =>
        {
            try { onProgress && onProgress(data); }
            catch (e) { log('collapse progress callback error', e?.message); }
        };
        ipcRenderer.on('collapse:progress', listener);
        return invoke('collapse:run', job)
            .finally(() => ipcRenderer.removeListener('collapse:progress', listener));
    },
});

/**
 * FMOD sound effects bridge.
 * Kept separate from the CRP56 IPC allowlist by design.
 */
const ALLOWED_SFX = new Set(['confirm', 'cursor', 'back', 'error']);

contextBridge.exposeInMainWorld('sfx', {
    play: (category) =>
    {
        if (!ALLOWED_SFX.has(category))
        {
            log('blocked sfx play', category);
            return;
        }
        log('sfx.play()', category);
        ipcRenderer.send('sfx:play', category);
    },
    any: () =>
    {
        log('sfx.any()');
        ipcRenderer.send('sfx:any');
    },
    setVolume: (v) =>
    {
        log('sfx.setVolume()', v);
        ipcRenderer.send('sfx:volume', v);
    },
    setMusicVolume: (v) =>
    {
        log('sfx.setMusicVolume()', v);
        ipcRenderer.send('music:volume', v);
    },
    setMasterVolume: (v) =>
    {
        log('sfx.setMasterVolume()', v);
        ipcRenderer.send('master:volume', v);
    },
    setMuteAll: (muted) =>
    {
        log('sfx.setMuteAll()', muted);
        ipcRenderer.send('audio:mute', muted);
    },
    playMusic: (name) =>
    {
        log('sfx.playMusic() sending music:play', name);
        ipcRenderer.send('music:play', name);
        log('sfx.playMusic() sent music:play', name);
    },
    stopMusic: () =>
    {
        log('sfx.stopMusic() sending music:stop');
        ipcRenderer.send('music:stop');
        log('sfx.stopMusic() sent music:stop');
    },
    listMusic: () =>
    {
        log('sfx.listMusic()');
        return ipcRenderer.invoke('music:list');
    },
    listOutputDevices: () =>
    {
        log('sfx.listOutputDevices()');
        return ipcRenderer.invoke('sfx:listOutputDevices');
    },
    setOutputDevice: (id) =>
    {
        log('sfx.setOutputDevice()', id);
        return ipcRenderer.invoke('sfx:setOutputDevice', id);
    },
});