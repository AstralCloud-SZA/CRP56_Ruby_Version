CRP56 Ruby + Electron Version
CRP56 is now being rebuilt as a private Ruby core + Electron desktop application. The project is no longer being structured as a Ruby gem. Instead, it uses a plain Ruby codebase inside the repository for encryption, compression, phrase handling, and file operations, while Electron provides the desktop UI and application shell.
This change is aimed at making the project easier to build in RubyMine, easier to maintain as a personal tool, and easier to style as a modern desktop application.
Project direction
The original WPF version is now considered the legacy build. The new direction is:
a private Ruby core for the actual encryption and compression logic,
an Electron frontend for the desktop experience and interface,
a private bridge layer that lets Electron communicate with the Ruby process safely,
and FMOD-based audio handling for interface sound effects and music playback.
This architecture keeps the business logic separate from the interface and avoids tying the core engine to one UI framework.
Project structure
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
The `ruby-core` folder contains the private application logic. The `electron-app` folder contains the UI, desktop runtime, and desktop audio layer. Electron should talk to Ruby through a controlled bridge instead of putting crypto logic in the renderer.
Why this setup
This project is a personal encryption and compression tool, so it does not need to be packaged as a public gem or designed as a shared library for outside users. A plain Ruby structure is enough for a private application and keeps development straightforward inside RubyMine.
Electron is being used because it gives much more flexibility for layout, styling, navigation, and desktop UX than the previous WPF version. Its multi-process architecture also makes it easier to isolate the UI from the Ruby backend logic.
FMOD is being used for audio handling so the desktop app can support responsive UI sound effects, music playback, mixer grouping, and controlled runtime volume behavior without embedding audio logic into the Ruby core. This keeps sound as part of the Electron desktop layer rather than the encryption engine.
Ruby core responsibilities
The Ruby side is the source of truth for:
text encryption and decryption,
file encryption and decryption,
compression and decompression,
phrase storage and lookup,
payload formatting,
and error handling.
The Ruby core should stay independent from Electron-specific concerns. It should not contain any UI code, renderer logic, window management, or audio playback logic.
Example Ruby layout
A simple plain-Ruby entry point can load files directly from `lib/`:
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
Ruby's OpenSSL support is available through the standard/default library, so encryption logic can be built directly in the private Ruby core without introducing a gem-based package layer.
Electron responsibilities
The Electron application is responsible for:
launching the desktop window,
loading the renderer UI,
exposing a safe API through `preload.js`,
sending requests to Ruby,
displaying encryption, compression, and file results,
and coordinating desktop audio playback through FMOD.
The Electron renderer should not directly access system-level functionality. That work should stay behind the preload and main-process boundary.
FMOD audio handling
FMOD is used as the app's desktop audio engine for sound effects and music.
It is responsible for:
playing UI sound categories such as cursor, confirm, back, and error,
handling music playback separately from sound effects,
managing mixer groups such as master, SFX, and music buses,
supporting mute and volume controls from the Electron UI,
and keeping audio playback in the Electron layer instead of the Ruby core.
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
This keeps audio secure and structured in the same way as the Ruby bridge: the renderer requests actions, while the privileged desktop layer performs them.
Bridge flow
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
This keeps the UI responsive, keeps the logic organized, and follows Electron's recommended security model based on isolated contexts and controlled bridging.
Development workflow
Ruby side
Open the `ruby-core/` project in RubyMine and work directly with the plain Ruby files. No gem packaging is required for the private core.
Typical workflow:
```bash
cd ruby-core
ruby main.rb
```
You can also add simple local scripts for testing text encryption, file encryption, compression, and phrase storage.
Electron side
Inside the Electron app folder:
```bash
cd electron-app
npm install
npm run dev
```
Electron should start the Ruby bridge from the main process and exchange JSON messages over stdin/stdout or another private IPC layer.
Audio side
FMOD should be initialized from the Electron main process, not from the renderer and not from the Ruby core.
Typical responsibilities include:
loading sound assets from the local app folders,
creating master, SFX, and music routing groups,
responding to preload-exposed audio commands,
and updating mixer state during the app session.
This keeps desktop audio behavior centralized and easier to debug.
Migration goals
The migration from the older application into the new Ruby + Electron version is planned in stages:
Rebuild the encryption logic in plain Ruby.
Rebuild the compression logic in plain Ruby.
Recreate the file format and payload handling.
Add phrase storage and utility helpers.
Connect the Ruby core to Electron through the bridge.
Integrate FMOD audio handling into the Electron desktop shell.
Replace the old UI with the new desktop interface.
This staged approach helps keep the rewrite manageable and reduces the risk of breaking behavior while the project transitions away from the legacy app.
Status
Current direction:
WPF version is legacy.
Ruby is now the core implementation language.
Electron is the new desktop shell.
FMOD handles desktop audio playback and mixer control.
RubyMine is the main IDE.
The Ruby core is private and kept inside the application repository.
Notes
Keep the file and encryption format versioned from the beginning so future updates remain readable.
Keep the Ruby core separate from Electron UI code for maintainability.
Treat Electron as the presentation layer and Ruby as the logic layer.
Treat FMOD as part of the Electron desktop infrastructure, not part of the Ruby encryption core.
License
Private personal project.
