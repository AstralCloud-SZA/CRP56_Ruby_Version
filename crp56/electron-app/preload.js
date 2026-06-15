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
]);

/**
 * Invokes a whitelisted IPC channel in the main process.
 *
 * @param {string} channel - Allowed IPC channel name.
 * @param {object} [payload] - Optional payload sent to the main process.
 * @returns {Promise<any>} IPC response promise.
 */
function invoke(channel, payload)
{
    if (!ALLOWED_CHANNELS.has(channel))
    {
        return Promise.reject(new Error(`[crp56 preload] Blocked channel: "${channel}"`));
    }

    return payload !== undefined ? ipcRenderer.invoke(channel, payload) : ipcRenderer.invoke(channel);
}

/**
 * Exposes the CRP56 API to the renderer.
 * This keeps the renderer isolated from direct Electron internals.
 */
contextBridge.exposeInMainWorld('crp56', {
    // System
    ping: () => invoke('crp56:ping'),
    version: () => invoke('crp56:version'),

    // Text Core
    encryptText: (passphrase, plainText) => invoke('crp56:encrypt-text', { passphrase, plainText }),
    decryptText: (passphrase, cipherTextBase64) => invoke('crp56:decrypt-text', { passphrase, cipherTextBase64 }),

    // File Core
    encryptFile: (passphrase, sourceFile, outputFile) => invoke('crp56:encrypt-file', { passphrase, sourceFile, outputFile }),
    decryptFile: (passphrase, sourceFile, outputFile) => invoke('crp56:decrypt-file', { passphrase, sourceFile, outputFile }),

    // Folder Core
    encryptFolder: (passphrase, sourceFolder, outputFolder) => invoke('crp56:encrypt-folder', { passphrase, sourceFolder, outputFolder }),
    decryptFolder: (passphrase, sourceFolder, outputFolder) => invoke('crp56:decrypt-folder', { passphrase, sourceFolder, outputFolder }),

    // OS Dialogs
    pickFile: (options) => invoke('dialog:pick-file', options ?? {}),
    pickFolder: (options) => invoke('dialog:pick-folder', options ?? {}),
    pickSaveFile: (options) => invoke('dialog:pick-save-file', options ?? {}),

    // Live progress events from the Ruby core.
    // Returns an unsubscribe function.
    onProgress: (callback) =>
    {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('crp56:progress', listener);
        return () => ipcRenderer.removeListener('crp56:progress', listener);
    },
});

/**
 * FMOD sound effects bridge.
 * Kept separate from the CRP56 IPC allowlist by design.
 */
const ALLOWED_SFX = new Set(['confirm', 'cursor', 'back', 'error']);

contextBridge.exposeInMainWorld('sfx', {
    play: (category) => { if (!ALLOWED_SFX.has(category)) return; ipcRenderer.send('sfx:play', category); },
    any: () => ipcRenderer.send('sfx:any'),
    setVolume: (v) => ipcRenderer.send('sfx:volume', v),
    setMusicVolume: (v) => ipcRenderer.send('music:volume', v),
    setMasterVolume: (v) => ipcRenderer.send('master:volume', v),
    setMuteAll: (muted) => ipcRenderer.send('audio:mute', muted),
    playMusic: (name) => ipcRenderer.send('music:play', name),
    stopMusic: () => ipcRenderer.send('music:stop'),
    listMusic: () => ipcRenderer.invoke('music:list'),
});