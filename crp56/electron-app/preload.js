const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crp56', {
    ping: () => ipcRenderer.invoke('crp56:ping'),
    version: () => ipcRenderer.invoke('crp56:version'),
    encryptText: (passphrase, plainText) =>
        ipcRenderer.invoke('crp56:encrypt-text', { passphrase, plainText }),
    decryptText: (passphrase, cipherTextBase64) =>
        ipcRenderer.invoke('crp56:decrypt-text', { passphrase, cipherTextBase64 }),
    encryptFile: (passphrase, sourceFile, outputFile) =>
        ipcRenderer.invoke('crp56:encrypt-file', { passphrase, sourceFile, outputFile }),
    decryptFile: (passphrase, sourceFile, outputFile) =>
        ipcRenderer.invoke('crp56:decrypt-file', { passphrase, sourceFile, outputFile })
});