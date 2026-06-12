---
stability: stable
layer: behavioural
---

# URL Parameters

> Spec: bootstrap URL parameters and their precedence. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/runtime/startupContext.ts` — reads and parses URL params into `startupFlags`/`startupFlags.params`
- `src/runtime/appSettingsRepository.ts` — code-loading params (`config`, `gist`, `txt`, `default`)
- `src/runtime/bootstrap.ts` — applies URL-param overrides during bootstrap
- `src/lib/persistence.ts` — `?nosave` integration (silent no-op writes)
- `src/lib/keybindings/profiles.ts` — `?keymap` profile import

---

## 1. General rules

1.1 URL parameters are the **highest-precedence configuration source**, above persisted settings and product defaults (see `src/runtime/startupContext.ts`).

1.2 An unknown URL param is **stored in `startupFlags.params` but is not an error**. Future params may be added; old bundles must not crash on encountering them.

1.3 Removal/rename of any param in §2 (stable) is a compatibility break and must be treated as a major version concern. Params in §3 (dev/debug) carry no stability promise.

## 2. Stable parameters

These are part of the public contract. Renaming or removing them is a breaking change.

| Param | Value | Effect | Source |
|-------|-------|--------|--------|
| `config` | URL | Fetch and apply a config JSON before normal startup | `appSettingsRepository.ts` |
| `gist` | Gist ID or full GitHub URL | Load editor code from a GitHub gist | `appSettingsRepository.ts` |
| `txt` | URL | Load editor code from a plain-text URL | `appSettingsRepository.ts` |
| `default` | *(presence)* | Load the hardcoded default editor starting code | `appSettingsRepository.ts` |
| `nosave` | *(presence)* | Disable all localStorage writes; reads still succeed against pre-existing state (see [persistence.md §1.7](persistence.md)) | `persistence.ts` |
| `keymap` | Base64-encoded JSON profile | Import a keybinding profile from URL (see [keybindings.md §1.13](keybindings.md)) | `profiles.ts` |

2.1 If both `?gist` and `?txt` are specified, **`?txt` wins**. `?gist` is ignored.

2.2 `?nosave` makes every persistence write a silent no-op, including auto-save and the dismiss flag for the onboarding banner (see `src/lib/persistence.ts`). Reads still succeed against any pre-existing localStorage state (see [persistence.md §1.7](persistence.md)).

2.3 `?keymap` is decoded as a Base64 JSON keybinding profile object `{ version, baseProfile, overrides, gamepadOverrides }`. It is read by the keybindings system independently of the main `startupFlags` parser.

## 3. Dev/debug parameters

These are internal tooling flags. They carry no stability promise and may move or disappear.

| Param | Value | Effect | Source |
|-------|-------|--------|--------|
| `debug` | `true` | Enable verbose debug logging via `toggleDbg()` | `startupContext.ts` |
| `devmode` | `true` | Unlock advanced settings sections and dev-mode UI | `startupContext.ts` |
| `disableWebSerial` | `true` | Force browser-local mode regardless of browser capability | `startupContext.ts` |
| `noModuleMode` | `true` | Use the in-browser ModuLisp interpreter without hardware | `startupContext.ts` |
| `virtualGamepad` | `true` | Mount an interactive virtual Xbox gamepad overlay for testing gamepad controls without hardware | `bootstrap.ts` |
| `nativeBridge` / `wsPort` | *(presence)* or port number | Connect to a uSEQ engine running in a separate native process (e.g. the VCV Rack plugin) over a loopback WebSocket `ws://127.0.0.1:<port>` (default 17890), presented to the app as an ordinary serial port so it reports a hardware connection. Distinct from `noModuleMode`. See [runtime-modes.md](runtime-modes.md). | `bootstrap.ts` |
| `calibrate` | `1` | *(Spec only — not yet implemented.)* Open calibration picker on hardware connection (see [calibration.md §2.1](calibration.md)) | — |

3.1 Boolean flags use `=true` and are checked with strict equality, except `?nosave` which is a presence-only flag (`urlParams.has()`).

## 4. Hash routing

The URL fragment (`location.hash`) is used for Zen mode routing and is not part of the query-parameter system.

| Pattern | Effect | Source |
|---------|--------|--------|
| `#/zen/<exerciseId>` | Load a specific Zen Mode exercise | `src/zen/index.tsx` |
