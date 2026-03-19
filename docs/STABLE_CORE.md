# Stable Core And Compatibility Cuts

This document is the Wave 1 scope decision for the `useq-perform` reset. It defines the product surface that must survive near-term cleanup and the surfaces that should not receive accidental compatibility protection.

It is intentionally narrower than "everything currently in the repo". Downstream cleanup issues should cite this file instead of inferring scope from stale docs, unmounted components, or leftover migration seams.

## Current Product Shape

- The shipped app is a single Vite bundle built from `src/main.ts` into `public/solid-dist/`.
- The runtime today is one browser app with one CodeMirror editor session, one transport toolbar, one main toolbar, settings/help panels, and serial visualisation.
- The app can run against either real uSEQ hardware over Web Serial or the pinned `src-useq` WASM bundle in browser-local mode, which should be available by default in release builds.

## Stable Core

The reset must preserve these workflows:

1. Open the app, edit code, and evaluate expressions from the main editor.
2. Use transport controls that map to the shared runtime contract in `src/contracts/useqRuntimeContract.ts`.
3. Connect to real uSEQ hardware over Web Serial and auto-reconnect a previously saved port when available, with a persisted user setting to opt out of automatic reconnect.
4. Run browser-local execution through the pinned `src-useq` WASM bundle by default when hardware is unavailable, and also use it alongside connected hardware when that helps with visualisation and local analysis.
5. Expose an in-editor "don't wait for hardware to connect" style setting so local editing and evaluation can proceed without blocking on hardware attachment.
6. Make runtime state legible in the UI so the app and the user can distinguish real hardware connection from WASM-only execution, with different visual indications for each.
7. Keep visualisation working in both complementary WASM mode and live serial-observation mode, with the understanding that future-looking features only apply to the local/WASM path.
8. Keep mock time as the WASM interpreter's local clock when no hardware module is present to drive execution.
9. Preserve committed config loading, local persistence, and retained URL bootstrap overrides.

## Supported Environments

### Hardware mode

- Supported browsers: Chromium-family browsers with Web Serial support, including Chrome, Edge, Brave, and Opera.
- When Web Serial is unavailable, the app should stay usable in browser-local WASM mode instead of failing outright.
- Supported firmware floor for fully supported behavior: `1.2.0` or newer, which enables JSON handshake, heartbeat, and stream configuration.

### Browser-local mode

- Supported via the checked-in `src-useq/wasm/useq.js` artifact copied to `public/wasm/useq.js`.
- The release app should activate the WASM interpreter by default, with a settings control to turn that behavior off when needed.
- The editor should expose a user-facing "don't wait for hardware to connect" style setting so local work can start immediately without the hardware connection gate.
- When hardware is connected, the WASM interpreter remains available as a complementary engine for visualisation, local analysis, and other assistance that should not bog down the hardware runtime.
- Turning WASM support off means: if hardware is connected, only talk to hardware; if hardware is not connected, show a disconnected state and warn before evaluating code.
- Browser support promise is narrower than hardware mode: "modern ES2020 browser that can run the current bundle and WASM". Automated coverage is Chromium-first.

## Runtime Mode Decisions

### Retained product modes

- Normal hardware mode over Web Serial.
- Default browser-local WASM mode.
- In-editor "don't wait for hardware to connect" style mode toggle.
- Unsupported-browser / `?disableWebSerial=true` containment path.

Runtime ownership should stay seamless for the user:

- If hardware is connected, it remains a first-class execution target.
- The WASM interpreter should complement connected hardware rather than replacing it, including support for sharing state or sending the same code to both when that improves the experience.
- If hardware is absent or Web Serial is unavailable, the app should continue in WASM mode without presenting that as an error state.
- The UI should make hardware-connected and WASM-only states visually distinct so users can tell which runtime is active.

### Retained only as internal tooling, not a public product promise

- `?noModuleMode=true`
- `?devmode=true`
- Mock controls
- Mock time
- Storybook
- Test harnesses

These can change shape, move UI, or disappear from the live bundle if the debugging capability still exists.

### Not a compatibility target

- Any ambiguous or desynchronised hybrid state where hardware and WASM are both present but the app cannot clearly tell which runtime is authoritative for a given action or status indicator.
- Any assumption that `connectedToModule` means "real hardware is attached".

Issue `useq-perform-tgf.1.3` should use this decision to split runtime modes cleanly.

## Storage And URL Compatibility Promises

### Hard compatibility promises for the reset

- `localStorage["uSEQ-Perform-User-Settings"]`
- `localStorage["uSEQ-Perform-User-Code"]`
- `localStorage["uSEQ-Serial-Port-Info"]`
- `?config=<url>`
- `?disableWebSerial=true`
- `?devmode=true`
- `?nosave`
- `?gist=<id-or-url>`
- `?txt=<url>`

These top-level keys and URL parameters are part of the live bootstrap contract and should not be broken casually. The exact internal shape of the persisted JSON values may evolve over time as settings are added, removed, or reorganised.

When both URL flags and persisted settings exist, precedence should be:

1. Explicit URL flags
2. Persisted user settings
3. Product defaults

### Soft compatibility promises while the panels remain

- `localStorage["useqExperienceLevel"]`
- `localStorage["moduLispReference:*"]`
- `localStorage["codeSnippets:*"]`

These should keep working unless the corresponding help/reference/snippet surfaces are intentionally removed.

## Compatibility Cuts

### Keep

- Shared transport builtins.
- Hardware JSON handshake for firmware `>= 1.2.0`.
- Browser-local WASM execution as the default non-hardware path.
- Automatic reconnect to previously saved hardware ports as the default behavior, with a persisted opt-out.
- Complementary WASM-plus-hardware execution for visualisation and analysis without overloading the hardware.
- Distinct connected-state signalling for real hardware versus WASM-only execution.
- Existing storage keys and retained bootstrap URL parameters listed above.

### Contain

- Legacy text serial protocol: keep it only as a compatibility bridge while the runtime contract reset lands. It is not the target architecture and should not block simplification aimed at the `1.2.0+` JSON path.
- `?noModuleMode=true`: keep it only as a development/debugging escape hatch, not as a release-facing compatibility promise.
- `?devmode=true`: keep the flag, but treat the panel/UI as internal tooling rather than a stable public surface.
- Visualisation sourced from live serial data: support it as an observation mode, but do not treat future-looking or time-seeking features as compatibility requirements for that path.

### Out of scope for the stable core

- Camera workflows and `CameraPanel`.
- MIDI setup and related browser permissions.
- Desktop / Electron assumptions.
- Virtual gamepad support.
- Unmounted console-panel residue and similar dead panel shells.
- Any requirement to preserve duplicate runtime ownership between legacy and modern UI layers.

Issue `useq-perform-tgf.1.5` should use this list to prune dead or misleading surfaces.

## Canonical References

- Repo entry guide and file map: `docs/REPO_MAP.md`.
- Product scope and reset boundary: this document.
- Runtime and firmware/WASM contract: `docs/RUNTIME_CONTRACT.md`.
- Serial framing and JSON message shapes: `docs/PROTOCOL.md`.
- Authoritative firmware/WASM source of truth: the pinned `src-useq/` submodule commit reported by `npm run src-useq:status`.
