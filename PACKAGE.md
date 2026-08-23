# What's in this package

## Install it right now

`Release/de.shells.osc.streamDeckPlugin` — double-click it and Stream Deck will install version 3.0.0. Built and packed with Elgato's own CLI (`streamdeck pack`), which validates the manifest as part of packaging.

Requires Stream Deck 6.4 or newer. Nothing else to install; Stream Deck supplies the Node.js runtime.

## Repository layout

```
├── src/                          TypeScript source
│   ├── plugin.ts                 entry point
│   ├── settings.ts               settings shape + version 2 compatibility
│   ├── defaults.ts               appsettings.json loading
│   ├── json.ts                   local JSON types
│   ├── actions/send-osc.ts       the action
│   ├── net/udp.ts                pooled UDP sockets
│   ├── osc/
│   │   ├── tags.ts               type tag metadata (shared with the UI)
│   │   ├── types.ts              argument parsing and validation
│   │   ├── encode.ts             the binary encoder
│   │   ├── address.ts            address validation
│   │   └── encode.test.ts        spec fixtures
│   ├── settings.test.ts          compatibility + UDP round trip
│   └── ui/pi.ts                  property inspector logic
│
├── de.shells.osc.sdPlugin/       the plugin as Stream Deck loads it
│   ├── manifest.json
│   ├── appsettings.json          legacy defaults, imported once then ignored
│   ├── imgs/                     generated — see assets/generate.py
│   ├── bin/plugin.js             built — regenerate with npm run build
│   └── ui/send-osc.html          property inspector markup and styles
│       └── pi.js                 built — regenerate with npm run build
│
├── assets/                       icon source (SVG) and generator
├── Release/                      packaged installer
├── docs/O.png                    screenshot (shows the v2 panel — outdated)
├── legacy-v2/                    the C# plugin, archived
└── package.json, tsconfig.json, rollup.config.mjs
```

## Notes on a few of these

**`de.shells.osc.sdPlugin/bin/` and `ui/pi.js` are build output.** They're included here so the folder is immediately usable, but `.gitignore` excludes them — build artifacts don't belong in version control. If you'd rather commit them, remove those two lines from `.gitignore`.

**`imgs/` is generated, not hand-drawn.** `python3 assets/generate.py` rebuilds every size from the SVG source in `assets/`, so changing the mark means editing one file rather than eight PNGs. Requires `pip install cairosvg`.

The version 2 icons were replaced: they were full-colour artwork in the two slots Elgato requires to be monochrome white on transparent, which is why they rendered as dark blobs in the actions list. `actionDefaultImage.png` is gone — the manifest never referenced it in v2 either.

**`docs/O.png` shows the old property inspector.** Worth retaking before you publish, since the panel is entirely different now.

**`legacy-v2/`** holds the C# project, the old property inspector, `SharpOSC.dll` and the previous release, so nothing is lost. Delete it whenever you're confident in v3 — the git history has it either way.

**`Category` changed** from "Send OSC" to "Send OSC Command" to satisfy Elgato's packaging validator, which wants it to match the plugin name. It only affects the grouping label in the actions list; no stored settings are involved.

## Rebuilding

```sh
npm install
npm test          # 72 tests
npm run typecheck
npm run build
npm run watch     # rebuild + restart the plugin on save
```

To repack the installer:

```sh
npm install -g @elgato/cli
streamdeck validate de.shells.osc.sdPlugin
streamdeck pack de.shells.osc.sdPlugin --output Release --force
```

Bump `Version` in `manifest.json` first — Stream Deck uses it to decide whether an install is an upgrade.

## Before you publish

- Retake the screenshot.
- Test the property inspector's drag-to-reorder in the real Stream Deck webview. It uses HTML5 drag events, which couldn't be exercised outside the app.
- Sanity-check one existing v2 button on a real device. The compatibility tests cover the byte output, but nothing here has talked to actual Stream Deck hardware.
