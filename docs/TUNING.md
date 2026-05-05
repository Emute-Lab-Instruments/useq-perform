# Tuning Guide

Where to hand-edit behaviour, content, and feel. Each section lists the file, what lives there, and what you'd change.

---

## Gaps: Things That Should Be Settable But Aren't Yet

These are behaviours currently hardcoded as inline constants that would benefit from being surfaced as settings (in `schema.ts`) or at least named top-level constants in the relevant file.

### High-value (would meaningfully change the feel)

| What | Current | Where | Suggested setting |
|------|---------|-------|-------------------|
| **Gamepad paradigm selection** | Hardcoded to `modalShiftLayers` | `src/lib/gamepad/index.ts:139` | `settings.gamepad.paradigm: "modal-shift" \| "leader" \| "hydra" \| "chord-heavy"` — hot-swappable from settings panel |
| **Menu engagement threshold** | Inline `0.5` | `src/lib/gamepad/index.ts:227` | `settings.menu.stickEngagement` (spec §4.5 already names this; not wired) |
| **Menu segment count** | Hardcoded `12` | `src/lib/gamepad/index.ts:234` | `settings.menu.maxSegments` — affects how many items fit one ring before pagination kicks in |
| **Eval highlight flash duration** | Inline `1000` ms | `src/editors/extensions/evalHighlight.ts:82,96` | `settings.editor.evalFlashMs` — shorter for fast performers, longer for learners |
| **Live-edit idle-eval delay** | `DEFAULT_IDLE_EVAL_MS = 1500` | `src/editors/extensions/liveEdit/idleEval.ts:24` | `settings.editor.liveEditIdleEvalMs` — how long after a structural edit before auto-re-eval |
| **Gamepad poll interval** | `50` ms | `src/lib/gamepad/index.ts:127` | `settings.gamepad.pollIntervalMs` — lower = more responsive but higher CPU; higher = battery-friendly |
| **Auto-chain behaviour** | Always re-opens for typed holes | `src/lib/menu/chain.ts` / dispatcher | `settings.menu.autoChainEnabled: boolean` — some users might prefer manual hole-filling |
| **Range inference rules** | Hardcoded if/else cascade | `src/editors/extensions/liveEdit/rangeInference.ts` | A data-driven lookup table (parent-head → {min, max, precision}) instead of code branches — new rules without editing TS |
| **Notification/toast duration** | Inline `2500` ms | `src/ui/help/ModuLispReferenceTab.tsx:24`, `KeybindingsPanel.tsx:196` | `settings.ui.toastDurationMs` |

### Medium-value (would change the vibe)

| What | Current | Where | Suggested setting |
|------|---------|-------|-------------------|
| **Radial menu size** | Implied by SVG viewbox | `src/ui/menu/RadialMenu.tsx` | `settings.menu.size` (spec §3.2.1 says "configurable via menu.size") — not wired |
| **Menu dim backdrop opacity** | Probably in CSS | Menu overlay CSS | `settings.menu.backdropOpacity` — heavier dim = less distraction, lighter = maintain awareness |
| **Structural cursor halo corner radius + offset** | In settings (`nodeHighlightCornerRadius`, `nodeHighlightYOffset`) | Already settable | ✓ Already good |
| **Expression gutter play-button visibility** | `expressionClearButtonEnabled` | Already settable | ✓ Already good |
| **T9 commit timeout** | `600` ms | `src/lib/menu/dispatcher.ts:848` | `settings.menu.t9CommitMs` — faster typists want lower |
| **Gamepad hold threshold** | `250` ms in `DEFAULT_TIMING` | `src/lib/gamepad/recognizer.ts:89` | `settings.gamepad.holdMs` — personal preference for how long "hold" takes |
| **Gamepad held-repeat rate** | `60` ms in `DEFAULT_TIMING` | `src/lib/gamepad/recognizer.ts:91` | `settings.gamepad.heldRepeatMs` — faster or slower auto-repeat |
| **Chord grace window** | `30` ms | `src/lib/gamepad/recognizer.ts:92` | `settings.gamepad.chordGraceMs` — looser = easier chords but more false positives |
| **Flick threshold** | `0.7` | `src/lib/gamepad/recognizer.ts:94` | `settings.gamepad.flickThreshold` — lower = easier flicks but more accidental triggers |

### Lower-value (useful for power-users, not critical)

| What | Current | Where | Suggested setting |
|------|---------|-------|-------------------|
| **Adaptive quality pressure window** | `8` frames | `src/effects/adaptiveQuality.ts:36` | Expose if users want to tune responsiveness vs stability of quality changes |
| **Vis future lead seconds** | Already in settings | `settings.visualisation.futureLeadSeconds` | ✓ Already good |
| **Default starting code** | Hardcoded string | `src/lib/editorDefaults.ts` | Could be a file path or template name — but low priority |
| **Panel chrome design** | Switchable at runtime (devmode) | `DesignSelector` component | Already has a widget, but it's devmode-only. Could be a setting. |
| **Keybinding chord timeout** | In `KeybindingsSettings.chordTimeout` | Schema has the field | ✓ Interface exists but verify it's wired |

---

## Structural Improvements to Enable Better Tuning

Beyond individual parameters, these architectural changes would make the system more tuneable:

### 1. Settings-driven gamepad timing (instead of compile-time constants)

Currently `DEFAULT_TIMING` in `recognizer.ts` is a frozen object. The pipeline *accepts* a `timing` override via `GamepadPipelineOptions`, but `createGamepadPipeline()` in `index.ts` doesn't read from the settings store. Wiring this would let users tweak `holdMs`, `heldRepeatMs`, `flickThreshold`, `stickDeadzone` from the Settings panel without restarting.

### 2. Paradigm as a runtime setting (not a code import)

Line 139 of `src/lib/gamepad/index.ts` hardcodes `modalShiftLayers`. All four paradigms are already importable. Adding a `settings.gamepad.paradigm` enum and a lookup map would let users switch between modal-shift, leader, hydra, and chord-heavy from Settings. The radial layer ships alongside all paradigms (it's always present when menu is open).

### 3. Data-driven range inference table

The `inferRange()` function is a hand-maintained if/else cascade. Replacing it with a JSON/YAML lookup table (parent-head → range spec) would let you add rules for new functions (e.g. `euclid` n=1–32, `gates` pw=0–1, `scale` inMin/inMax) without touching TypeScript. The function becomes `table.find(rule => rule.parentHead === head) ?? genericFallback(seed)`.

### 4. Menu settings group

The spec names several tunables (§4.5 `menu.stickEngagement`, §3.2.1 `menu.size`, `menu.holeAutoFreeForm`) that have no corresponding `MenuSettings` interface in `schema.ts`. Adding one would consolidate all menu tunables into Settings:

```ts
interface MenuSettings {
  stickEngagement: number;     // 0.2–0.9, default 0.5
  maxSegments: number;         // ring segment cap before pagination
  size: number;                // SVG px size
  backdropOpacity: number;     // dim layer behind menu
  autoChainEnabled: boolean;   // whether holes auto-reopen menu
  t9CommitMs: number;          // multi-tap commit idle timeout
  holeAutoFreeForm: boolean;   // jump straight to numpad/t9 for typed holes
}
```

### 5. Gamepad settings group

Similarly, a dedicated group would collect the currently-scattered timing:

```ts
interface GamepadSettings {
  paradigm: "modal-shift" | "leader" | "hydra" | "chord-heavy";
  pollIntervalMs: number;
  holdMs: number;
  heldRepeatMs: number;
  heldInitialMs: number;
  chordGraceMs: number;
  doubleTapMs: number;
  stickDeadzone: number;
  flickThreshold: number;
}
```

---

## Radial Menu Content

| File | What |
|------|------|
| `src/lib/menu/manifest.yaml` | Human-editable source for all radial menu tabs, categories, and items. Edit this, then regenerate `manifest.json`. |
| `src/lib/menu/manifest.json` | The runtime manifest consumed by the app. Generated from the YAML (or hand-edited directly). |

Structure: tabs → categories (left ring) → items (right ring). See `manifest.yaml` header comments for the DSL.

---

## Keyboard Bindings

| File | What |
|------|------|
| `src/lib/keybindings/actions.ts` | The action registry — every bindable action with its ID, category, icon, description, and reversibility. Add new actions here. |
| `src/lib/keybindings/defaults.ts` | Default key→action bindings (`defaultKeyBindings`) and gamepad→action bindings (`defaultGamepadBindings`). Reorder, remap, or add new bindings. |
| `src/lib/keybindings/profiles/simplified.ts` | Alternative "simplified" binding profile with fewer shortcuts. |

User overrides are stored at runtime in `settings.keybindings.overrides` (persisted to localStorage).

---

## Gamepad Paradigms

Each file exports a layer stack defining a complete gamepad interaction model. Only one paradigm is active at a time.

| File | What |
|------|------|
| `src/lib/gamepad/paradigms/modal-shift.ts` | LB/RB as shift modifiers. The default paradigm. |
| `src/lib/gamepad/paradigms/leader.ts` | Vim-style leader key (Y → transient layer). |
| `src/lib/gamepad/paradigms/hydra.ts` | Emacs-style sticky leader (layer persists until miss/cancel). |
| `src/lib/gamepad/paradigms/chord-heavy.ts` | Two-button chords for everything; flat resolution, no layers. |
| `src/lib/gamepad/paradigms/radial.ts` | Radial menu layer (active while menu is open). Ships alongside whichever paradigm is selected. |

Each paradigm file is a plain `Layer[]` array. Edit button→action mappings, add/remove layers, change `when:` predicates.

---

## Gamepad Timing

| File | What |
|------|------|
| `src/lib/gamepad/recognizer.ts` | `DEFAULT_TIMING` object (line ~88) |

```
holdMs:         250    — ms before a press becomes a hold
heldInitialMs:  300    — ms before first held-repeat tick
heldRepeatMs:    60    — ms between subsequent held-repeat ticks
chordGraceMs:    30    — max ms between simultaneous presses to form a chord
stickDeadzone:  0.12   — magnitude below which stick reads as (0,0)
flickThreshold: 0.7    — minimum magnitude to register a flick gesture
doubleTapMs:    300    — window for second tap to register as double-tap
```

---

## Radial Menu Timing & Interaction

| File | What |
|------|------|
| `src/lib/menu/dispatcher.ts` | Menu-specific timing constants |

```
T9_COMMIT_TIMEOUT_MS:  600    — idle ms before T9 multi-tap commits a character
NUMPAD_CHARS:          [...]  — the polar-grid character layout for numpad sub-mode
T9_GROUPS:             [...]  — letter groups per T9 key position
FACE_TO_VERB_KIND:     Map    — A=insert, X=replace, Y=wrapWith, B=call
```

The engagement threshold (0.5) and hysteresis (0.05) for stick-to-ring-segment mapping are in `src/lib/menu/state.ts` (spec §4.5).

---

## Settings Defaults

| File | What |
|------|------|
| `src/lib/settings/schema.ts` | `defaultUserSettings` object (line ~339) — all application defaults |

Key groups inside `defaultUserSettings`:

| Group | Tunables |
|-------|----------|
| `editor` | `fontSize` (16), `theme` ("uSEQ Dark"), `preventBracketUnbalancing` |
| `storage` | `autoSaveInterval` (5000 ms) |
| `ui` | `nodeHighlightCornerRadius` (3), `nodeHighlightYOffset` (0), `indentGuideMode/Width/Opacity/Luminosity/Dash/Gap/YPadding` |
| `visualisation` | `windowDuration` (10s), `sampleCount` (100), `lineWidth` (1.5), `probeRefreshIntervalMs` (33), `futureLeadSeconds` (1), `digitalLaneGap` (4), `readabilityBlurRadius/Padding/TintOpacity/Alpha/Passes/Feather/MaxDarken/DebounceMs/Overscan` |
| `format` | `lineWidth` (60 chars), `complexityThreshold` (4), `indentStyle` ("align") |
| `hardware` | `holdTickHz` (30), `bindingQueueDepth` (4) |
| `console` | `entryAnimation` ("slide"), `typewriterIntervalMs` (20) |
| `evalResults` | `mode` ("inline-ephemeral"), `autoDismissMs` (3000), `maxChars` (200) |

---

## Visualisation Palette & Channels

| File | What |
|------|------|
| `src/lib/visualisationUtils.ts` | Colour palettes and channel list |

```ts
serialVisPaletteLight = ['#ace397', '#45a5ad', '#fcbf5d', '#ff809f', '#ff005e', '#c9004c', '#93003a', '#00429d']
serialVisPaletteDark  = [/* 8 colours */]
serialVisChannels     = ['a1', 'a2', 'a3', 'a4', 'd1', 'd2', 'd3']
```

---

## Visualisation Sampler Constants

| File | What |
|------|------|
| `src/effects/visualisationSampler.ts` | Internal timing for the vis pipeline |

```
FRONTIER_GUARD_BAND_SECONDS:  0.5
DEFAULT_FUTURE_LEAD_SECONDS:  1
MAX_FUTURE_LEAD_SECONDS:      8
DEFAULT_HISTORY_HEADROOM:     5
DEFAULT_MAX_HISTORY_SECONDS:  30
ASSUMED_FRAME_RATE:           30
```

---

## Adaptive Quality Thresholds

| File | What |
|------|------|
| `src/effects/adaptiveQuality.ts` | Frame-pressure detection thresholds |

```
PRESSURE_WINDOW:       8     — frames tracked in the rolling window
MISS_THRESHOLD_MS:    50     — rAF tick > this = a "miss"
MILD_MISS_COUNT:       3     — misses in window → degrade to level 1
SEVERE_MISS_COUNT:     6     — misses in window → degrade to level 2
RECOVERY_NORMAL_TICKS: 16    — clean ticks needed to step back up
```

---

## Themes

| File | What |
|------|------|
| `src/editors/themes.ts` | `themeSpecs[]` array (~line 51) — full colour recipes for all 17 themes. Each `ThemeSpec` has background, foreground, caret, selection, gutter, line-highlight, and per-token syntax styles. |
| `src/lib/themes.ts` | `themeNames[]` — the name list (must stay in sync with `themeSpecs`). |

To add a theme: add a `ThemeSpec` to the array in `src/editors/themes.ts`, then add its name to `src/lib/themes.ts`.

---

## Editor Defaults

| File | What |
|------|------|
| `src/lib/editorDefaults.ts` | `defaultFontSize` (16), `defaultTheme` ("uSEQ Dark"), `defaultMainEditorStartingCode` (the code shown on first load). |

---

## Live-Edit Range Inference

| File | What |
|------|------|
| `src/editors/extensions/liveEdit/rangeInference.ts` | `inferRange(seed, parentHead)` — rules for automatic `:min`/`:max` when a user marks a value as live-editable. |

Current rules:
- Inside `slow`/`fast`: min=1, max=max(16, 2×seed)
- Inside `osc`/`phasor`: min=20, max=max(2000, 2×seed)
- Seed in [0,1]: min=0, max=1
- Seed in [-1,0): min=-1, max=0
- Other positive: min=0, max=2×seed
- Other negative: min=2×seed, max=0

Add new parent-head rules (e.g. for `euclid`, `gates`, `scale`) by adding `if (parentHead === '...')` branches before the generic fallbacks.

---

## Mock Control Inputs (Dev Mode)

| File | What |
|------|------|
| `src/effects/mockControlInputs.ts` | `getControlDefinitions()` (~line 190) — definitions for simulated hardware inputs (ain1, ain2, din1, din2, swm, swt) with ranges, steps, and defaults. |
| `src/lib/settings/schema.ts` | `defaultDevModeConfiguration.mockControls` — initial values for mock inputs. |

---

## Reference Data (Language Builtins)

| File | What |
|------|------|
| `assets/modulisp_reference_data.json` | The full ModuLisp builtin function reference — names, descriptions, parameters, examples, tags. Drives the Help panel's reference tab and the legacy picker menu model. |

---

## Legacy Picker Menu (being replaced by radial)

| File | What |
|------|------|
| `src/lib/pickerMenuModel.ts` | `buildHierarchicalMenuModel()` — constructs the old grid-style picker categories from reference data. Buckets functions into Maths/Control/Lists/Utils with a 12-item cap per bucket. Being superseded by `manifest.yaml`. |

---

## Maybe-relevant (deeper plumbing)

These aren't primary tuning targets but you might occasionally want to touch them:

| File | What | When |
|------|------|------|
| `src/lib/gamepad/hardware.ts` | `buttonThreshold: 0.1` — analog trigger threshold for treating as "pressed" | If triggers feel too sensitive or sluggish |
| `src/machines/transport.machine.ts` | XState transport machine (play/pause/stop states) | If you need new transport states |
| `src/runtime/wasmInterpreter.ts` | WASM eval/time update interface | If interpreter API changes |
| `src/effects/localClock.ts` | rAF-driven internal clock | If timing drift is an issue |
| `src/ui/overlayManager.ts` | Overlay stack (Escape handling, scroll lock) | If modal stacking feels wrong |
| `src/lib/menu/state.ts` | Pure state machine reducer for radial menu | If menu transitions need new behaviour |
