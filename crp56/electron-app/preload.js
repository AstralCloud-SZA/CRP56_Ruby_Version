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

function invoke(channel, payload) {
    if (!ALLOWED_CHANNELS.has(channel)) {
        return Promise.reject(new Error(`[crp56 preload] Blocked channel: "${channel}"`));
    }

    return payload !== undefined
        ? ipcRenderer.invoke(channel, payload)
        : ipcRenderer.invoke(channel);
}

contextBridge.exposeInMainWorld('crp56', {
    ping: () =>
        invoke('crp56:ping'),

    version: () =>
        invoke('crp56:version'),

    encryptText: (passphrase, plainText) =>
        invoke('crp56:encrypt-text', { passphrase, plainText }),

    decryptText: (passphrase, cipherTextBase64) =>
        invoke('crp56:decrypt-text', { passphrase, cipherTextBase64 }),

    encryptFile: (passphrase, sourceFile, outputFile) =>
        invoke('crp56:encrypt-file', { passphrase, sourceFile, outputFile }),

    decryptFile: (passphrase, sourceFile, outputFile) =>
        invoke('crp56:decrypt-file', { passphrase, sourceFile, outputFile }),

    encryptFolder: (passphrase, sourceFolder, outputFolder) =>
        invoke('crp56:encrypt-folder', { passphrase, sourceFolder, outputFolder }),

    decryptFolder: (passphrase, sourceFolder, outputFolder) =>
        invoke('crp56:decrypt-folder', { passphrase, sourceFolder, outputFolder }),

    pickFile: (options) =>
        invoke('dialog:pick-file', options ?? {}),

    pickFolder: (options) =>
        invoke('dialog:pick-folder', options ?? {}),

    pickSaveFile: (options) =>
        invoke('dialog:pick-save-file', options ?? {}),
});