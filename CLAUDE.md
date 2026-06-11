# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

`lol-vo-extract` extracts League of Legends champion/skin voice lines from game client WAD archives, parses Wwise sound banks (BNK/WPK) and binary data (BIN) to match audio files to in-game events (kill, joke, movement, etc.), then exports renamed audio files, event JSON mappings, and dictation markdown files.

## Commands

```bash
# Run the extraction (config-driven, no CLI args)
node index.js

# Lint
npx eslint .

# No build step — pure ESM JavaScript, runs directly
# No test suite exists
```

Requires Node.js >= 26. Package manager is pnpm.

External tools needed at runtime for audio conversion:
- **VGMStream** (`vgmstream-cli`) — `.wem` → `.wav`
- **Ravioli Game Tools** (`RExtractorConsole`) — `.wem` → `.ogg`

## Architecture

### Pipeline (entry: `index.js`)

The program is config-driven. All behavior is controlled through JSON/JSONC config files, not CLI arguments.

```
config.runcom.jsonc → parseRuncom() → parseExtractConfig() → extractVoices()
```

`extractVoices()` in `src/extract-voices.js` runs this pipeline:
1. `parseAssetFilesNeed()` — determine which WAD files are needed
2. `parseGameFilesNeed()` — determine which files to extract from inside WADs
3. `extractWAD()` — unpack WAD archives (via `@lol-archiver/lol-wad-extract`)
4. `parseBIN()` — extract event literal names from `.bin` files
5. `parseBNK()` — parse Wwise sound banks, build HIRC object tree
6. `parseEvents()` — cross-reference BIN event names with BNK HIRC objects using FNV-1 hashes
7. `extractAudios()` — extract `.wem` audio from BNK/WPK
8. `copyAudios$fileBank()` — copy/rename audio to export dirs with event-based naming
9. `saveEvent()` — export event-to-voice JSON (separate VO and SFX)
10. `saveDictation()` — export markdown dictation files

### Key Directories

- `src/` — core pipeline modules
- `src/entry/bnk/` — BNK HIRC object class hierarchy (the Wwise sound bank data model)
- `src/entry/manifest/` — Riot CDN manifest parsing for downloading assets
- `lib/` — shared utilities: `database.js` (champion data), `utility.js` (hashing, hex, error helpers), `i18n.js`, `constant.js`
- `config/` — JSON/JSONC configuration files (user-editable)
- `data/` — static data: champion databases, friendly event name mappings, hash files
- `locale/` — i18n locale files (`en.json`, `zh.json`)
- `script/` — standalone utility scripts

### Configuration System

Layered profile inheritance:
1. `config.default.json` — built-in preset profiles
2. `config.user.json` — user-defined profiles with `$base` inheritance and `$profile` for default selection
3. `config.runcom.jsonc` — which champion/skin to extract using which profile (format: `slot|skinId|title|profile`)
4. `config.event-manual.jsonc` — manually provided event names for edge cases

Profiles merge bottom-up: `default.$` → `default[profile]` → `user.$` → `user[profile]` → runcom overrides.

### HIRC Object Hierarchy (`src/entry/bnk/HIRCObject.js`)

The Wwise BNK parser builds a tree of these objects:
- `HIRCObject` — base class (`id`, `type`)
- `HIRCSound` (type 2) — references an audio file by `idAudio`
- `HIRCAction` (type 3) — play/stop/set-state/set-switch actions targeting other objects
- `HIRCEvent` (type 4) — named event containing action IDs; bridges event names to audio
- `HIRCPlayContainer` (type 5) — random/sequence container of sounds
- `HIRCSwitchContainer` (type 6) — conditional container based on game state
- `HIRCLayerContainer` (type 9) — layer container
- `HIRCSwitch` — pseudo-object representing a switch state's child list

### Framework: `@nuogz/pangu`

Imported via side-effect initialization in `index.js`. Provides:
- `C` — config accessor (e.g., `C.runcom`, `C.default`, `C.user`)
- `G` — logger with scoped instances via `G.where(label)`
- `T(key)` / `TS(key, ...args)` — i18n translation (from `lib/i18n.js`)
- `Day` — dayjs instance
- `dirWorking` — working directory path

## Code Conventions

- **Pure ESM** — `"type": "module"`, all imports use `.js` extensions
- **Tab indentation**, single quotes, semicolons, trailing commas only on multiline
- **JSDoc for types** — no TypeScript compilation; `tsconfig.json` is for `.d.ts` generation and editor IntelliSense only
- **Scoped loggers** — `const GG = G.where(T('where:module-name'))` at module top, then `GG.info()`, `GG.infoD()`, `GG.infoU()`, `GG.fatalE()`
- **Translation wrapping** — all user-facing strings go through `T()` or `TS()`; never hardcode display text
- **`$` suffix convention** — filenames with `$` indicate a sub-function variant (e.g., `copyAudios$fileBank.js`)
- **Error helpers** — use `LogError()` and `TLogError()` from `lib/utility.js` for structured errors with `what`/`infos` fields
- **Binary parsing** — uses `@danor-lib/biffer` for reading binary buffers throughout the pipeline

## Key Dependencies

| Package | Role |
|---------|------|
| `@danor-lib/biffer` | Binary buffer unpacking (BNK, WPK, WAD, BIN parsing) |
| `@lol-archiver/lol-wad-extract` | WAD archive extraction with ZSTD support |
| `@nuogz/pangu` | App framework: config, logging, i18n, dayjs |
| `xxhashjs` | XXHash for WAD file path hashing |
| `fs-extra` | Extended filesystem operations |
| `axios` | HTTP client for CDN downloads |

## Notes

- The project is private (`"private": true`), not published as a library
- Console output is partially internationalized (Chinese and English); some hardcoded Chinese strings remain in source
- CDN fetch functionality is currently broken (see TODO in `extract-voices.js:69`); only local file extraction works
- Type definitions in `bases.zh-cn.d.ts` document the config structure with Chinese annotations

---

## Branch Customizations (`v2.x-bgg` vs `v2.x`)

> **Purpose**: Record all customizations made on the `v2.x-bgg` branch relative to upstream `v2.x`.
> When merging upstream updates, consult this section to ensure custom modifications are preserved.

### Version

- `package.json` version changed from `2.12.0` to `2.12.0-bgg.1`

### 1. Audio Export: Hash-Based Naming (Replaces Event-Based Naming)

**Files**: `src/copy-audios.js`

The original `copyAudios$fileBank()` used event names as filenames (e.g., `joke[abcdef12][12345678].wav`). This was replaced with a simpler CRC32-hash-based naming scheme:

- **VO**: exports WEM files as `{crc32hash}.wem` to `dirExportVoice`, and WAV files as `{crc32hash}.wav` to `dirConversionVoice`
- **SFX**: exports WEM files as `{crc32hash}.wem` to `dirExportSoundEffect`, optionally WAV to `dirConversionSoundEffect` when `convertSFX` is true
- Removed: `groupActionChildAudioIDs()` function (moved to `save-event.js`), event-name filename logic, `@long-event.txt` logging
- Removed unused imports: `appendFileSync`, `pad0`, `showID`, `toHexL8`, `HIRCContainer`, `HIRCEvent`, `HIRCSound`, `HIRCSwitch`

### 2. New Module: `src/save-event.js`

**File**: `src/save-event.js` (new, 219 lines)

Exports event-to-audio JSON mappings separately from audio file copying:
- Moved `groupActionChildAudioIDs()` from `copy-audios.js` here
- Added `getWEMHash()` to look up WEM CRC32 hash from cache directory
- `saveEvent()` generates JSON files mapping event names → `{ name, voices[] }` where voices are CRC32 hashes
- Supports separate VO and SFX event export via `fileRanges` filtering (VO events from non-sfx BNK, SFX events from sfx BNK)
- Event names are converted to friendly titles using `convertEventNameToTitle()` (same logic as dictation)
- Output filename: `{championId}{skinId}.json` for skin mode, `{slot}.json` for non-skin mode

### 3. Pipeline Changes in `src/extract-voices.js`

- Added import of `saveEvent` from `./save-event.js`
- `parseEvents()` now returns `{ objectsBNKAll, fileRanges }` instead of just `objectsBNKAll`
- Added two new pipeline steps after `copyAudios$fileBank()`: save VO event JSON and SFX event JSON

### 4. `src/parse-events.js` — Returns File Ranges

- Now tracks `fileRanges`: array of `{ file, start, end }` recording which BNK file each range of `objectsBNKAll` came from
- Return type changed from `objectsBNKAll` to `{ objectsBNKAll, fileRanges }`

### 5. SFX Conversion Control (`convertSFX` config option)

**Files**: `src/extract-audios.js`, `src/copy-audios.js`, `bases.zh-cn.d.ts`

New config option `convertSFX` (default `false`):
- When `false`: SFX only outputs raw WEM, skips format conversion entirely
- When `true`: SFX uses the same `format` config as VO for conversion
- In `extract-audios.js`: SFX banks skip WAV/OGG conversion when `convertSFX` is false; cache check logic updated accordingly
- Fixed: error message for missing RExtractorConsole now correctly references `fileVGMStreamCLI` path

### 6. Simplified Export Directory Naming

**File**: `src/parse-extract-config.js`

- `nameDirVoiceExport` simplified from `{idFull}@{skinName}@{region}@{lang}` to just `{idFull}` (skin mode) or `{slot}` (non-skin mode)
- This makes exported directory names shorter and more predictable

### 7. New Export Directories

**File**: `src/parse-extract-config.js`

Six new export directories with defaults:
| Config Key | Default Path | Purpose |
|---|---|---|
| `dirConversionVoice` | `@1wav` | VO WAV converted files |
| `dirExportSoundEffect` | `@1sfx` | SFX WEM files |
| `dirConversionSoundEffect` | `@1sfx-wav` | SFX WAV converted files |
| `dirExportVoiceEvent` | `events/vo` | VO event JSON |
| `dirExportSoundEffectEvent` | `events/sfx` | SFX event JSON |

Original `dirExportVoice` default remains `@1voice` (now specifically for VO WEM files).

### 8. New Script: `script/1-generate-runcom.js`

**File**: `script/1-generate-runcom.js` (new, 399 lines)

Interactive CLI tool for generating runcom configuration files:
1. All champions, all skins
2. Single champion, all skins
3. New skins by version comparison (via CDragon API)
4. Show champion list
5. All champions, default skin only

Uses `data/base/{lang}.json` as data source. Has slot substitution table (e.g., `wukong` → `monkeyking`).

### 9. Improved Error Messages in `src/parse-runcom.js`

- Champion not found: now includes `slot` and full config string in error
- Skin not found: now includes `slot`, champion name, `skinId`, and full config string in error

### 10. Config Example Updates

**File**: `config/config.user.json.example`

Added new config keys: `skipSaveDictation`, `dirExportVoice`, `dirConversionVoice`, `convertSFX`, `dirExportSoundEffect`, `dirConversionSoundEffect`, `dirExportVoiceEvent`, `dirExportSoundEffectEvent`

### 11. Type Definition Updates

**File**: `bases.zh-cn.d.ts`

Added JSDoc type definitions for all new config options (`convertSFX`, `dirConversionVoice`, `dirExportSoundEffect`, `dirConversionSoundEffect`, `dirExportVoiceEvent`, `dirExportSoundEffectEvent`). Updated `dirExportVoice` description to clarify it's for WEM files only.

### 12. Data Updates

**Files**: `data/base/en_us.json`, `data/base/zh_cn.json`

Regular champion/skin database updates (new skins, name corrections). These are routine data updates, not structural customizations — they will be superseded by upstream data updates on merge.
