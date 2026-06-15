# CRP56 Ruby + Electron Version

CRP56 is being rebuilt as a **private Ruby core + Electron desktop app**. It is no longer being treated as a Ruby gem. Instead, the repo now holds a plain Ruby codebase for encryption, compression, phrase handling, and file operations, while Electron provides the desktop UI and shell around it.

This shift makes the project easier to open in RubyMine, easier to maintain as a personal tool, and easier to style into something that feels more like a custom desktop app than a packaged library.

## Project direction

The old WPF build is now the legacy version. The new direction is:

- a **private Ruby core** for the encryption and compression logic,
- an **Electron frontend** for the desktop interface,
- a **private bridge layer** that lets Electron talk to Ruby safely,
- and **FMOD audio** for sound effects and music playback.

That setup keeps the real logic separate from the UI and avoids tying the core engine to one front end.

## Project structure

```text
crp56/
├── ruby-core/
│   ├── main.rb
│   ├── lib/
│   │   ├── crypto.rb
│   │   ├── file_crypto.rb
│   │   ├── compression.rb
│   │   ├── phrase_store.rb
│   │   ├── payload.rb
│   │   └── errors.rb
│   ├── data/
│   └── temp/
│
├── electron-app/
│   ├── main.js
│   ├── preload.js
│   ├── package.json
│   ├── renderer/
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── app.js
│   ├── bridge/
│   │   └── ruby_bridge.js
│   ├── audio/
│   │   ├── sfx/
│   │   └── music/
│   └── fmod/
│       └── (FMOD runtime integration files)
│
└── README.md
```

The `ruby-core` folder is where the private app logic lives. The `electron-app` folder handles the interface, the desktop runtime, and the audio layer. Electron talks to Ruby through a controlled bridge instead of putting crypto logic in the renderer.

## Why I built it this way

This is a personal encryption and compression tool, so it does not need to be packaged as a public gem or built for other people to consume. A plain Ruby structure is enough for a private project, and it keeps development pretty straightforward inside RubyMine.

Electron is a better fit for the kind of desktop UI I want here. It gives more room for layout, styling, navigation, and overall feel than the older WPF version, and its multi-process setup makes it easier to keep the interface separate from the Ruby backend.

FMOD is being used for audio so the app can handle UI sound effects, music playback, mixer groups, and volume control without pushing audio logic into the Ruby core. That keeps sound as part of the desktop layer instead of the encryption engine itself.

## Ruby core responsibilities

The Ruby side is the source of truth for:

- text encryption and decryption,
- file encryption and decryption,
- compression and decompression,
- phrase storage and lookup,
- payload formatting,
- and error handling.

The Ruby core should stay independent from Electron-specific concerns. It should not contain UI code, renderer logic, window management, or audio playback code.

## Example Ruby layout

A plain Ruby entry point can load files directly from `lib/`:

```ruby
# ruby-core/main.rb
$LOAD_PATH.unshift(File.expand_path('lib', __dir__))

require 'openssl'
require 'json'
require 'base64'
require 'securerandom'
require 'zlib'

require 'errors'
require 'payload'
require 'compression'
require 'phrase_store'
require 'crypto'
require 'file_crypto'
```

Ruby's OpenSSL support is available through the standard/default library, so encryption logic can live directly in the private Ruby core without needing a gem-based package layer.

## Electron responsibilities

The Electron app handles:

- launching the desktop window,
- loading the renderer UI,
- exposing a safe API through `preload.js`,
- sending requests to Ruby,
- showing encryption, compression, and file results,
- and coordinating desktop audio playback through FMOD.

The renderer should not directly touch system-level functionality. That belongs behind the preload and main-process boundary.

## FMOD audio handling

FMOD is the desktop audio engine for CRP56.

It handles:

- UI sound categories like cursor, confirm, back, and error,
- music playback separately from sound effects,
- mixer groups like master, SFX, and music,
- mute and volume controls from the Electron UI,
- and audio playback outside the Ruby core.

The intended audio flow is:

```text
Renderer UI interaction
   ↓
preload.js audio bridge
   ↓
Electron main process
   ↓
FMOD audio layer
   ↓
SFX / music playback
```

That keeps audio secure and nicely separated, the same way the Ruby bridge keeps the app logic under control.

## Bridge flow

The intended flow is:

```text
Electron Renderer
   ↓
preload.js API
   ↓
Electron Main Process
   ↓
Ruby bridge process
   ↓
CRP56 Ruby core
```

This keeps the UI responsive, keeps the logic organized, and follows Electron's recommended security model with isolated contexts and controlled bridging.

## Development workflow

### Ruby side

Open the `ruby-core/` folder in RubyMine and work directly with the plain Ruby files. No gem packaging is required for the private core.

Typical workflow:

```bash
cd ruby-core
ruby main.rb
```

I can also add small local scripts later for testing text encryption, file encryption, compression, and phrase storage.

### Electron side

Inside the Electron app folder:

```bash
cd electron-app
npm install
npm run dev
```

Electron should start the Ruby bridge from the main process and exchange JSON messages over stdin/stdout or another private IPC layer.

### Audio side

FMOD should be initialized from the Electron main process, not from the renderer and not from the Ruby core.

Typical responsibilities include:

- loading sound assets from local app folders,
- creating master, SFX, and music routing groups,
- responding to preload-exposed audio commands,
- and updating mixer state during the app session.

That keeps the audio behavior centralized and easier to debug.

## Migration goals

The migration from the older app into the new Ruby + Electron version is happening in stages:

1. Rebuild the encryption logic in plain Ruby.
2. Rebuild the compression logic in plain Ruby.
3. Recreate the file format and payload handling.
4. Add phrase storage and utility helpers.
5. Connect the Ruby core to Electron through the bridge.
6. Integrate FMOD audio into the Electron shell.
7. Replace the old UI with the new desktop interface.

That staged approach keeps the rewrite manageable and lowers the risk of breaking behavior while the project moves away from the legacy build.

## Status

Current direction:

- WPF is the legacy version.
- Ruby is the core implementation language.
- Electron is the new desktop shell.
- FMOD handles desktop audio playback and mixer control.
- RubyMine is the main IDE.
- The Ruby core stays private inside the repository.

## Notes

- Keep the file and encryption format versioned from the beginning so future updates stay readable.
- Keep the Ruby core separate from Electron UI code for maintainability.
- Treat Electron as the presentation layer and Ruby as the logic layer.
- Treat FMOD as part of the Electron desktop infrastructure, not part of the Ruby encryption core.

## License

Private personal project.
