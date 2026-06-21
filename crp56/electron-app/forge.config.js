// forge.config.js
// CRP56 Encryption App — Electron Forge config

const path = require('path');

module.exports = {
    packagerConfig: {
        asar: true,
        name: 'CRP56 Encryption App',
        // Adjust if your icon is different or lives elsewhere:
        icon: './Icon/f1',
        // Bundle Ruby + backend as resources beside app.asar
        extraResource: [
            './ruby-runtime', // portable Ruby (bin/, lib/, etc.)
            './ruby-core'     // your CRP56 Ruby backend (main.rb, lib/, data/, ...)
        ]
    },

    rebuildConfig: {},

    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {
                name: 'CRP56EncryptionApp',
                setupIcon: './Icon/f1.ico',
                loadingGif: undefined
            }
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['win32']
        }
    ],

    plugins: [
        {
            // Makes sure koffi’s native binaries are unpacked from the ASAR
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {}
        }
    ]
};