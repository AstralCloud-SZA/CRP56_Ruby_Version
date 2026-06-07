# CRP56 Ruby + Electron Version

CRP56 is now being rebuilt as a **private Ruby core + Electron desktop application**. The project is no longer being structured as a Ruby gem. Instead, it uses a plain Ruby codebase inside the repository for encryption, compression, phrase handling, and file operations, while Electron provides the desktop UI and application shell.[1][2]

This change is aimed at making the project easier to build in RubyMine, easier to maintain as a personal tool, and easier to style as a modern desktop application.[1][3]

## Project direction

The original WPF version is now considered the legacy build. The new direction is:

- a **private Ruby core** for the actual encryption and compression logic,[1][4]
- an **Electron frontend** for the desktop experience and interface,[3][5]
- and a **private bridge layer** that lets Electron communicate with the Ruby process safely.[2][6]

This architecture keeps the business logic separate from the interface and avoids tying the core engine to one UI framework.[3][1]

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
│   └── bridge/
│       └── ruby_bridge.js
│
└── README.md
```

The `ruby-core` folder contains the private application logic. The `electron-app` folder contains the UI and desktop runtime. Electron should talk to Ruby through a controlled bridge instead of putting crypto logic in the renderer.[1][2][5]

## Why this setup

This project is a personal encryption and compression tool, so it does not need to be packaged as a public gem or designed as a shared library for outside users.[1] A plain Ruby structure is enough for a private application and keeps development straightforward inside RubyMine.[1][7]

Electron is being used because it gives much more flexibility for layout, styling, navigation, and desktop UX than the previous WPF version.[3] Using Electron’s multi-process architecture also makes it easier to isolate the UI from the Ruby backend logic.[3][2]

## Ruby core responsibilities

The Ruby side is the source of truth for:

- text encryption and decryption,[4]
- file encryption and decryption,[4]
- compression and decompression,
- phrase storage and lookup,
- payload formatting,
- and error handling.

The Ruby core should stay independent from Electron-specific concerns. It should not contain any UI code, renderer logic, or window management.[1][5]

## Example Ruby layout

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

Ruby’s OpenSSL support is available through the standard/default library, so encryption logic can be built directly in the private Ruby core without introducing a gem-based package layer.[4][8]

## Electron responsibilities

The Electron application is responsible for:

- launching the desktop window,[3]
- loading the renderer UI,
- exposing a safe API through `preload.js`,[2][5]
- sending requests to Ruby,
- and displaying encryption, compression, and file results.

The Electron renderer should not directly access system-level functionality. That work should stay behind the preload and main-process boundary.[2][5]

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

This keeps the UI responsive, keeps the logic organized, and follows Electron’s recommended security model based on isolated contexts and controlled bridging.[3][2][5]

## Development workflow

### Ruby side

Open the `ruby-core/` project in RubyMine and work directly with the plain Ruby files. No gem packaging is required for the private core.[1][7]

Typical workflow:

```bash
cd ruby-core
ruby main.rb
```

You can also add simple local scripts for testing text encryption, file encryption, compression, and phrase storage.

### Electron side

Inside the Electron app folder:

```bash
cd electron-app
npm install
npm run dev
```

Electron should start the Ruby bridge from the main process and exchange JSON messages over stdin/stdout or another private IPC layer.[6][9]

## Migration goals

The migration from the older application into the new Ruby + Electron version is planned in stages:

1. Rebuild the encryption logic in plain Ruby.
2. Rebuild the compression logic in plain Ruby.
3. Recreate the file format and payload handling.
4. Add phrase storage and utility helpers.
5. Connect the Ruby core to Electron through the bridge.
6. Replace the old UI with the new desktop interface.

This staged approach helps keep the rewrite manageable and reduces the risk of breaking behavior while the project transitions away from the legacy app.[10][11]

## Status

Current direction:

- WPF version is legacy.
- Ruby is now the core implementation language.
- Electron is the new desktop shell.
- RubyMine is the main IDE.
- The Ruby core is private and kept inside the application repository.

## Notes

- Keep the file and encryption format versioned from the beginning so future updates remain readable.[10][11]
- Keep the Ruby core separate from Electron UI code for maintainability.[1][5]
- Treat Electron as the presentation layer and Ruby as the logic layer.[3][2]

## License

Private personal project.
