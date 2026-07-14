---
stability: stable
layer: behavioural
---

# Settings

> Spec: settings schema, mutation surface, panel layout. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/lib/settings/schema.ts` — settings type definitions and default values
- `src/lib/settings/normalization.ts` — validation, clamping, migration, total normalisation
- `src/lib/settings/persistence.ts` — settings-specific localStorage read/write
- `src/lib/appSettings.ts` — legacy settings helpers and re-exports
- `src/runtime/appSettingsRepository.ts` — canonical repository (normalises, persists, emits changes)
- `src/runtime/runtimeService.ts` — public runtime-service facade; the canonical import surface (re-exports the domain services below)
- `src/runtime/runtimeSettingsService.ts` — settings-mutation implementation behind the facade (`updateSettings`)
- `src/utils/settingsStore.ts` — reactive SolidJS store for UI reads
- `src/ui/settings/SettingsPanel.tsx` — settings panel shell (tab layout)
- `src/ui/settings/GeneralSettings.tsx` — General tab with sub-sections
- `src/ui/settings/ThemeSettings.tsx` — Themes tab
- `src/ui/settings/EditorSettings.tsx`, `ConsoleSettings.tsx`, `EvalResultsSettings.tsx`, `StorageSettings.tsx`, `UISettings.tsx`, `KeybindingsSettings.tsx`, `VisualisationSettings.tsx`, `AdvancedSettings.tsx`, `PersonalSettings.tsx` — per-section panels rendered (in this order) inside the General tab
- `src/ui/settings/ConfigurationManagement.tsx` — import/export configuration
- `src/ui/settings/FormControls.tsx` — shared form primitives (`Section`/`SubGroup`/`Row`, inputs); carries the devmode `level` gate
- `src/ui/settings/devmodeContext.ts` — devmode signal and `isLevelVisible` gate for advanced controls
- `src/ui/settings/MidiSettings.tsx` — MIDI settings panel (currently **not mounted** anywhere; orphan)

1.1 Settings are a **typed, normalised, persistent record**. The schema has these top-level sections: `editor`, `storage`, `ui`, `visualisation`, `runtime`, `wasm`, `console`, `evalResults`, `structure`, `format`, `hardware`, optional `keybindings`, and optional `keymaps`. The `name` field is a free-form session label. (see `src/lib/settings/schema.ts`)

1.2 **The sole mutation surface is `runtimeService.updateSettings(patch)`.** Consumers import it from the public facade `src/runtime/runtimeService.ts`, which re-exports the implementation in `src/runtime/runtimeSettingsService.ts`. UI components must not write to localStorage, the canonical repository, or the reactive store directly. Reads are reactive (via `settingsStore` — see `src/utils/settingsStore.ts`); writes are imperative (via runtime service).

1.3 Mutation is end-to-end observable: a settings patch flows `runtimeService.updateSettings` (facade in `src/runtime/runtimeService.ts`, implementation in `src/runtime/runtimeSettingsService.ts`) → repository (normalises, persists — see `src/runtime/appSettingsRepository.ts`) → `settingsChanged` channel → reactive store reconcile (see `src/utils/settingsStore.ts`) → all subscribers update. A single patch produces exactly one observable settings revision.

1.4 The settings panel is structured as **three top-level tabs**: General, Themes, Keybindings. The General tab subdivides, in order, into Personal, Editor, Console, Eval Results, Storage, UI, Keybindings, Visualisation, Advanced, and Configuration Management sections. (see `src/ui/settings/SettingsPanel.tsx`, `src/ui/settings/GeneralSettings.tsx`)

The General-tab **Keybindings** sub-section (`src/ui/settings/KeybindingsSettings.tsx`) holds only lightweight keybinding *preferences* (e.g. modifier-hint style, sticky modifiers) under `settings.keybindings`. The full keybinding **profile/remapping editor** lives in the separate top-level **Keybindings** tab (`src/ui/keybindings/KeybindingsPanel.tsx`); the two are distinct surfaces.

1.5 **Devmode gating.** Settings **UI controls** (`Section`/`SubGroup`/`Row` in `src/ui/settings/FormControls.tsx`) accept a `level` prop (`"basic"` | `"advanced"`, default `"basic"`). Controls tagged `level="advanced"` are hidden unless `?devmode=true` is set, via `isLevelVisible` in `src/ui/settings/devmodeContext.ts`. The level is a *UI-control* attribute, not per-field schema metadata — the schema in `src/lib/settings/schema.ts` carries no `level` tags. Devmode primarily gates UI visibility of advanced sections and toggles for undecided design choices; it does not change runtime behaviour. The user-facing default surface is the basic-tier subset; the advanced tier is internal/diagnostic and may change shape without notice.

1.5.1 **Test coverage scope.** Tests should cover the full settings schema (all fields including devmode-gated ones): default values, normalisation, clamping, and persistence round-trip. Tests should also verify that each schema field has a corresponding UI control — a field that exists in the schema but has no UI exposure is a signal worth surfacing.

1.6 Default values for user-facing settings must be **safe and unobtrusive**: visualisation enabled with a 10-second window, autosave on at 5-second cadence, autoreconnect on, WASM on, themes on `uSEQ Dark`. A first-time user with no settings should land in a working app.

1.7 **Settings normalisation is total.** Any persisted blob is mapped to a valid settings record by clamping out-of-range values, dropping unknown fields, and filling missing ones from defaults. Normalisation must never throw. (see `src/lib/settings/normalization.ts`)

1.8 **Editor `theme` is the source of truth for both editor and chrome theming**: switching theme reconfigures the CodeMirror compartment, injects CSS variables into the document root, and updates the visualisation palette (dark vs light). These three effects must remain consistent. See [themes.md](themes.md).

1.8.1 **`runtime.failureMode` configures the engine's non-finite failure policy on BOTH runtimes** (`"lkg"` default / `"zero"` legacy — see `src-useq/docs/specs/failure-model.md` §3.2). The setting is pushed to the in-browser WASM engine via `useq_set_failure_mode` (applied at interpreter init and on change — `src/runtime/wasmInterpreter.ts`, `src/runtime/wasmRuntimePort.ts`, `src/effects/failureModeSync.ts`) and to connected hardware via the wire `set-failure-mode` message (`src-useq/docs/specs/wire-protocol.md` §5.18 — `src/transport/json-protocol.ts`). The device does not persist the mode, so the editor re-sends it as part of every JSON-protocol handshake. Exposed as a devmode-gated select in the Advanced section (`src/ui/settings/AdvancedSettings.tsx`).
