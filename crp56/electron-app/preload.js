const { contextBridge, ipcRenderer } = require('electron');
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

function invoke(channel, payload)
{
    if (!ALLOWED_CHANNELS.has(channel))
    {
        return Promise.reject(new Error(`[crp56 preload] Blocked channel: "${channel}"`));
    }

    return payload !== undefined ? ipcRenderer.invoke(channel, payload) : ipcRenderer.invoke(channel);
}

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

    // Live progress events from the Ruby core (per shard / per file).
    // Returns an unsubscribe function.
    onProgress: (callback) =>
    {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('crp56:progress', listener);
        return () => ipcRenderer.removeListener('crp56:progress', listener);
    },
});

// ---------------------------------------------------------------------------
// FMOD sound effects bridge (fire-and-forget; no response needed).
// Kept separate from the crp56 invoke() allowlist on purpose.
// ---------------------------------------------------------------------------
const ALLOWED_SFX = new Set(['confirm', 'cursor', 'back', 'error']);

contextBridge.exposeInMainWorld('sfx', {
    // Play a random sound from a category, e.g. window.sfx.play('confirm')
    play: (category) =>
    {
        if (!ALLOWED_SFX.has(category)) return;
        ipcRenderer.send('sfx:play', category);
    },
    // Play any random sound across all categories
    any: () => ipcRenderer.send('sfx:any'),
    // Volume setters (expects 0..1)
    setVolume: (v) => ipcRenderer.send('sfx:volume', v),
    setMusicVolume: (v) => ipcRenderer.send('music:volume', v),
});