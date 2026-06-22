// forge.config.js
// CRP56 Encryption App — Electron Forge config

module.exports = {
    packagerConfig: {
        asar: {
            unpack: '**/*.{node,dll,so,dylib}'
        },
        name: 'CRP56 Encryption App',
        icon: './Icon/f1',
        extraResource: [
            '../ruby-runtime',
            '../ruby-core'
        ]
    },

    rebuildConfig: {},

    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {
                name: 'CRP56.Encryption.App',
                setupIcon: './Icon/f1.ico',
                authors: 'AstralCloud_SZA [D Gounden]',
                description: 'CRP56 is a polymorphic encryption system that seals text, files, and entire folders behind a passphrase-derived shard cipher.'
            }
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['win32']
        }
    ],

    publishers: [
        {
            name: '@electron-forge/publisher-github',
            config: {
                repository: {
                    owner: 'AstralCloud-SZA',
                    name: 'CRP56_Ruby_Version'
                },
                prerelease: true,
                draft: false
            }
        }
    ],

    plugins: [
        {
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {}
        }
    ]
};