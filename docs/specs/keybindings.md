# Keybindings

> Spec: action registry, profiles/layouts, OS mapping, contexts, chords. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/lib/keybindings/actions.ts` — canonical action registry with metadata, `ActionDef`, `ReversibleActionId`, `NonReversibleActionId`
- `src/lib/keybindings/defaults.ts` — default key-to-action maps per profile
- `src/lib/keybindings/handlers.ts` — action-to-implementation mapping, `executeEditorCommand()`
- `src/lib/keybindings/resolver.ts` — merge defaults and overrides, conflict detection, context evaluation
- `src/lib/keybindings/chords.ts` — chord sequence handling
- `src/lib/keybindings/contexts.ts` — context-sensitive binding predicates
- `src/lib/keybindings/keyNotation.ts` — key notation parsing and normalisation
- `src/lib/keybindings/stickyModifiers.ts` — sticky modifier latch logic
- `src/lib/keybindings/osReserved.ts` — per-OS and browser-reserved key database
- `src/lib/keybindings/usageTracker.ts` — binding usage tracking
- `src/lib/keybindings/announcer.ts` — action announcement (accessibility)
- `src/lib/keybindings/profiles.ts` — profile import/export, serialisation
- `src/lib/keybindings/profiles/` — built-in profile definitions
- `src/lib/keybindings/layouts/` — physical keyboard layout metadata for visual labels
- `src/ui/keybindings/KeybindingsPanel.tsx` — settings UI for rebinding and profile management
- `src/ui/keybindings/KeyboardVisualiser.tsx` — interactive keyboard rendering component
- `src/ui/keybindings/ActionPalette.tsx` — fuzzy-searchable action palette overlay
- `src/ui/keybindings/ModifierHints.tsx` — ephemeral modifier-hint overlay

1.1 **Action registry is the single source of truth.** Every bindable operation is named by an `ActionId` string. CodeMirror handlers, the help tab, the keyboard visualiser, the action palette, and gamepad bindings all reference the same `ActionId` strings. (see `src/lib/keybindings/actions.ts`)

1.2 Action categories are: `core`, `editor`, `structure`, `probe`, `navigation`, `ui`, `transport`, `gamepad`, `menu`. Each action has a description, category, optional icon, optional `requiresEditor`/`repeatable`/`analogOnly` flags.

1.3 **Keybindings are profile-based.** A `profile` selects a set of default bindings; user `overrides` is a sparse map of `ActionId → key`. The active map is `profile defaults ⊕ overrides`. (see `src/lib/keybindings/defaults.ts`, `src/lib/keybindings/profiles.ts`)

1.4 **Keyboard layout** (`keybindings.layout`, e.g. `qwerty-us`, `dvorak`) is independent of profile. Layout controls visualiser labels only — `Mod-Enter` is `Mod-Enter` regardless of layout. (see `src/lib/keybindings/layouts/`)

1.5 **OS modifier mapping.** `Mod-` translates to `Cmd` on macOS and `Ctrl` elsewhere. `Alt-` is `Option` on macOS. `Ctrl-` is literal Ctrl on every platform. OS detection prefers `navigator.userAgentData.platform`, falls back to `navigator.platform`, then user agent. Mac is detected by `/Mac|iPod|iPhone|iPad/`. (see `src/lib/keybindings/keyNotation.ts`)

1.6 **OS-reserved keys** (e.g. `Mod-q` on macOS) trigger a *warning*, not a hard refusal — users may have remapped their OS. **Browser-reserved keys** (e.g. `Ctrl-w`, `Ctrl-t`, `F11`, `F12`) are *hard blocks*: the resolver refuses to bind them. (see `src/lib/keybindings/osReserved.ts`)

1.7 **Context-sensitive bindings.** A binding may carry a `when` predicate (e.g. `probe.active`, `!modal.open`, `editor.focused && probe.active`). Bindings with non-overlapping contexts may share the same key. (see `src/lib/keybindings/contexts.ts`)

1.8 **Chord sequences.** A binding may be a chord (`Alt-s ]`): leader key opens a transient namespace, second key selects an action. The chord-completion window is `keybindings.chordTimeout` ms (default 1500). Within the window, the keyboard visualiser may dim non-completion keys to highlight available second strokes. (see `src/lib/keybindings/chords.ts`)

1.9 **Conflict detection.** The resolver detects key collisions and provides ranked rebinding suggestions: context-split (zero disruption) > swap (one displaced action moves) > chord (move into a namespace) > nearby (pick the closest free combo). (see `src/lib/keybindings/resolver.ts`)

1.10 The **action palette** (`Mod-Shift-P`) opens a fuzzy-searchable overlay listing all non-analog actions with their current bindings. Enter executes; Escape closes; a transient toast may surface the binding for the executed action. (see `src/ui/keybindings/ActionPalette.tsx`)

1.11 **Modifier hints.** Holding a modifier (`Ctrl`, `Alt`, `Meta`, `Shift`) for `keybindings.modifierHintDelay` ms (default 500; 0 disables) reveals an ephemeral hint overlay near the cursor showing available completions. Releasing the modifier or pressing a second key dismisses immediately. (see `src/ui/keybindings/ModifierHints.tsx`)

1.12 **Sticky modifiers** (`keybindings.stickyModifiers`, default false) latch a modifier for the next keypress. Visualisation indicates a stuck modifier. (see `src/lib/keybindings/stickyModifiers.ts`)

1.13 **Profile import/export.** Profiles serialise to `{ version: 1, baseProfile, overrides, gamepadOverrides }`. Profiles may be imported via JSON file or `?keymap=base64...` URL parameter. (see `src/lib/keybindings/profiles.ts`)

1.14 **Backwards passthrough.** Bindings from third-party keymaps (`@nextjournal/clojure-mode`) that are not explicitly wrapped in the registry are passed through unmodified, with a startup warning logged for unrecognised actions. Passthrough bindings must not include keys where the command router enforces policy (Backspace, Delete, Enter, bracket keys) — see [input-dispatch.md](input-dispatch.md) §3.6 and §7.3. (see `src/editors/keymaps.ts`)

## 2. Implementation Map

The action registry feeds every binding consumer:

| Surface | Source of truth |
|---|---|
| CodeMirror keymaps | Resolved keyboard bindings from the action registry |
| Help keybinding reference | Action registry + active resolved bindings |
| Keyboard visualiser | Action registry + layout metadata + active resolved bindings |
| Action palette | Action registry, excluding `analogOnly` actions |
| Gamepad dispatch | Same `ActionId` vocabulary, resolved through gamepad layers |

Core implementation modules:

| Module | Path | Responsibility |
|---|---|---|
| Action registry | `src/lib/keybindings/actions.ts` | Canonical list of bindable actions with metadata |
| Default bindings | `src/lib/keybindings/defaults.ts` | Default key-to-action maps per profile |
| Handler registry | `src/lib/keybindings/handlers.ts` | Action-to-implementation mapping |
| Binding resolver | `src/lib/keybindings/resolver.ts` | Merge defaults and overrides, detect conflicts, evaluate contexts |
| OS reservations | `src/lib/keybindings/osReserved.ts` | Per-OS and browser-reserved key database |
| Keyboard layouts | `src/lib/keybindings/layouts/` | Physical-layout metadata for visual labels |
| Keyboard visualiser | `src/ui/keybindings/KeyboardVisualiser.tsx` | Interactive keyboard rendering component |
| Keybindings panel | `src/ui/keybindings/KeybindingsPanel.tsx` | Settings UI for rebinding and profile management |

## 3. Open / Deferred

3.1 **Layout auto-detection.** The Keyboard API is Chromium-only. The reliability bar for auto-detection on Firefox/Safari versus manual selection is undecided.

3.2 **Picker navigation rebindability.** Arrow keys for picker navigation are currently fixed. Whether to register them as rebindable actions (scoped to `when: "picker.open"`) is undecided.
