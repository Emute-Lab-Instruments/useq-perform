# Keybinding System Redesign

Specification for a unified, user-customisable keybinding system for uSEQ Perform.

**Status**: Draft
**Supersedes**: Current hardcoded keymaps in `src/editors/keymaps.ts` and manual binding list in `src/ui/help/KeybindingsTab.tsx`.

---

## Motivation

The current system has three disconnected layers:

1. **Runtime keymaps** (`keymaps.ts`) — hardcoded CodeMirror `{key, run}` arrays
2. **Display tab** (`KeybindingsTab.tsx`) — a manually duplicated binding list that is already stale (e.g. `Alt-h` is labelled "Toggle Help Panel" in the tab but actually fires `expandCurrentProbeContext` at runtime)
3. **Gamepad combos** (`gamepadIntents.ts`) — a completely separate combo registry with its own action vocabulary

No bindings are user-customisable. The `keymaps` field in the settings schema is a dead placeholder. OS awareness is limited to swapping modifier display names (Ctrl↔Cmd, Alt↔Option). Keyboard layout differences are ignored entirely.

---

## Goals

1. **Single source of truth** — one action registry feeds CodeMirror, the keyboard visualiser, the help tab, conflict detection, and gamepad dispatch.
2. **User-customisable bindings** — rebind any action with conflict detection, swap suggestions, and undo.
3. **Cross-platform correctness** — handle OS-reserved keys, physical vs logical key mapping, and multiple keyboard layouts (QWERTY, Dvorak, AZERTY, Colemak, etc.).
4. **Context-sensitive bindings** — reuse scarce key real-estate by scoping bindings to active contexts (editor focused, probe active, help open, etc.).
5. **Chord sequences** — namespace related actions behind a leader key for discoverability and ergonomics.
6. **Keyboard visualiser** — an interactive, layout-aware component that shows current bindings, supports edit-mode rebinding, and adapts to chord/context state.
7. **Gamepad as first-class peer** — gamepad and keyboard share the same action namespace.
8. **Discoverability** — modifier-hold hints, action palette, usage heat maps.
9. **Accessibility** — sticky modifiers, simplified profiles, screen reader announcements.
10. **Shareable profiles** — JSON import/export of binding overrides, URL-encodable for workshops.

---

## Architecture

```
                    ┌─────────────────────┐
                    │   Action Registry    │
                    │  (ID, description,   │
                    │   category, icon)    │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                     │
┌─────────▼─────────┐  ┌──────▼──────┐  ┌──────────▼──────────┐
│  Default Bindings  │  │   User      │  │  Gamepad Bindings   │
│  (per profile)     │  │   Overrides │  │  (per profile)      │
└─────────┬─────────┘  └──────┬──────┘  └──────────┬──────────┘
          │                    │                     │
          └─────────┬──────────┘                     │
                    │                                │
          ┌─────────▼──────────┐           ┌─────────▼──────────┐
          │  Binding Resolver  │           │  Gamepad Intent     │
          │  • merge defaults  │           │  Emitter            │
          │    + overrides     │           └─────────┬──────────┘
          │  • conflict detect │                     │
          │  • context eval    │                     │
          │  • OS reservations │                     │
          └──┬─────┬───────┬──┘                     │
             │     │       │                        │
    ┌────────▼┐ ┌──▼────┐ ┌▼────────────┐  ┌───────▼───────┐
    │CodeMirror│ │Help   │ │Keyboard Viz │  │   Handler     │
    │keymap()  │ │Tab    │ │Component    │  │   Registry    │
    └─────────┘ └───────┘ └─────────────┘  └───────────────┘
```

### Core Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Action Registry | `src/lib/keybindings/actions.ts` | Canonical list of all actions with metadata |
| Default Bindings | `src/lib/keybindings/defaults.ts` | Default key→action maps per profile |
| Handler Registry | `src/lib/keybindings/handlers.ts` | Action→implementation mapping |
| Binding Resolver | `src/lib/keybindings/resolver.ts` | Merges defaults + overrides, detects conflicts, evaluates contexts |
| Context Predicates | `src/lib/keybindings/contexts.ts` | Named boolean predicates for when-clauses |
| OS Reservations | `src/lib/keybindings/osReserved.ts` | Per-OS reserved key database |
| Keyboard Layouts | `src/lib/keybindings/layouts/` | Physical key layout data (QWERTY, Dvorak, etc.) |
| Keyboard Visualiser | `src/ui/keybindings/KeyboardVisualiser.tsx` | Interactive keyboard rendering component |
| Keybindings Panel | `src/ui/keybindings/KeybindingsPanel.tsx` | Settings UI for rebinding, profile management |
| Gamepad Bindings | `src/lib/keybindings/gamepadDefaults.ts` | Default gamepad combo→action maps |
| Profile I/O | `src/lib/keybindings/profiles.ts` | Import/export/URL-encode binding profiles |

---

## Action Registry

Every bindable operation in the app is registered as an **action**:

```typescript
interface ActionDef {
  description: string;
  category: ActionCategory;
  icon?: string;              // Lucide icon name for visualiser
  repeatable?: boolean;       // Can fire on key-repeat (default false)
  requiresEditor?: boolean;   // Only available when an editor is focused
}

type ActionCategory =
  | "core"        // Evaluation
  | "editor"      // Text manipulation
  | "structure"   // Structural editing (slurp/barf/splice)
  | "probe"       // Probe management
  | "navigation"  // Cursor/structural navigation
  | "ui"          // Panel toggles, modals
  | "transport"   // Serial connection, firmware
  | "gamepad"     // Gamepad-specific
  | "menu";       // Picker/radial menu operations

type ActionId = keyof typeof actions;  // String literal union
```

Actions are the **only** way to name an operation. CodeMirror handlers, gamepad intent subscribers, the help tab, and the keyboard visualiser all reference the same `ActionId` strings.

### Gamepad-Only and Analog Actions

Some actions originate from the gamepad with no natural keyboard equivalent:

```typescript
// Actions that exist in the registry but may have no default keyboard binding
"nav.adjustNumber":       { description: "Adjust number at cursor ±1", category: "gamepad", requiresEditor: true },
"menu.openBefore":        { description: "Open menu before cursor",    category: "menu" },
"menu.openAfter":         { description: "Open menu after cursor",     category: "menu" },
"menu.radial":            { description: "Open radial create menu",    category: "menu" },
"control.bindStick":      { description: "Bind stick to number",       category: "gamepad", analogOnly: true },
"control.stickAxis":      { description: "Continuous stick input",     category: "gamepad", analogOnly: true },
```

Actions marked `analogOnly: true` genuinely require analog input and cannot be meaningfully keyboard-bound. They appear in the registry for documentation and gamepad visualiser purposes but are excluded from the keyboard conflict resolver.

### Third-Party Keymaps (clojure-mode)

The `@nextjournal/clojure-mode` package ships its own `complete_keymap`. We remap some of its bindings (arrow keys → bracket keys) and wrap Delete for bracket balancing. Strategy:

- **Wrap all clojure-mode bindings** in the action registry at startup, generating ActionIds like `"clojure.slurpForward"`, `"clojure.killToEndOfList"`, etc.
- When the library updates and adds new bindings, they appear as **unregistered actions** — the system logs a warning and passes them through to CodeMirror unmodified.
- Only our remappings and wrappings (4 arrow→bracket, 1 Delete wrapper) are stored in the default bindings module.

### Commented-Out Structural Navigation

`keymaps.ts` contains a commented-out `structural_navigation_keymap` (Alt-Arrow for structural code traversal). These are registered as actions with **no default binding**:

```typescript
"nav.structuralUp":    { description: "Navigate out (structural)", category: "navigation", requiresEditor: true },
"nav.structuralDown":  { description: "Navigate in (structural)",  category: "navigation", requiresEditor: true },
"nav.structuralLeft":  { description: "Navigate prev (structural)",category: "navigation", requiresEditor: true },
"nav.structuralRight": { description: "Navigate next (structural)",category: "navigation", requiresEditor: true },
```

Users can bind these if they want; they're just not on by default (the gamepad provides this via its separate navigation mode).

---

## Binding Format

### Keyboard Bindings

```typescript
interface KeyBinding {
  action: ActionId;
  key: string;              // CodeMirror key notation: "Mod-Enter", "Alt-s ]" (chord)
  when?: string;            // Context predicate expression
  preventDefault?: boolean; // Default true
}
```

Key notation follows CodeMirror conventions:
- `Mod-` = Cmd on macOS, Ctrl elsewhere
- `Alt-` = Option on macOS
- `Ctrl-` = literal Ctrl (even on macOS)
- `Shift-`, `Meta-`
- Space-separated for chords: `"Alt-s ]"` = press Alt-s, release, press ]

### Gamepad Bindings

```typescript
interface GamepadBinding {
  action: ActionId;
  combo: string[];          // Button names: ["LB", "A"], ["Start"]
  when?: string;            // Same context predicates as keyboard
}
```

---

## Context System

### Predicate Definitions

```typescript
// src/lib/keybindings/contexts.ts
const contextPredicates = {
  "editor.focused":       () => document.activeElement?.closest(".cm-editor") != null,
  "help.visible":         () => helpPanelVisible(),
  "vis.visible":          () => visVisible(),
  "probe.active":         () => hasActiveProbe(),
  "modal.open":           () => modalVisible(),
  "picker.open":          () => pickerVisible(),
  "eval.available":       () => transportConnected() || wasmInterpreterReady(),
  "editor.bracketProtect":() => getAppSettings().editor?.preventBracketUnbalancing ?? true,
  "gamepad.navMode":      () => gamepadNavMode() === "structural",
  "gamepad.connected":    () => gamepadConnected(),
  "transport.connected":  () => transportConnected(),
} as const;
```

### Expression Syntax

When-clauses support simple boolean expressions:

```
"probe.active"                    // Single predicate
"!modal.open"                     // Negation
"editor.focused && probe.active"  // Conjunction
"editor.focused && !modal.open"   // Combined
```

No disjunction (OR) — use separate bindings instead, which is clearer.

### Context-Aware Key Reuse

Keys can be bound to different actions in non-overlapping contexts:

```typescript
{ action: "probe.expand", key: "Alt-h", when: "probe.active" },
{ action: "panel.help",   key: "Alt-h", when: "!probe.active" },
```

The conflict resolver verifies non-overlap at bind time and rejects ambiguous combinations.

---

## Chord Sequences

### Definition

A chord is a multi-keystroke binding where the first stroke (the **leader**) opens a transient namespace and the second stroke selects an action:

```typescript
// Structural editing namespace
{ action: "edit.slurpFwd",  key: "Alt-s ]" },
{ action: "edit.slurpBack", key: "Alt-s [" },
{ action: "edit.barfFwd",   key: "Alt-s '" },
{ action: "edit.barfBack",  key: "Alt-s ;" },
{ action: "edit.splice",    key: "Alt-s s" },

// Probe namespace
{ action: "probe.toggle",    key: "Alt-p p" },
{ action: "probe.toggleRaw", key: "Alt-p r" },
{ action: "probe.expand",    key: "Alt-p h" },
{ action: "probe.contract",  key: "Alt-p s" },
```

### Timeout

After pressing the leader key, a 1500ms window opens for the second stroke. If the window expires without a second key, the leader key's own action fires (if any) or nothing happens. The timeout is user-configurable.

### Visualiser Integration

When a leader key is pressed, the keyboard visualiser morphs to show **only the chord completions** — all other keys dim, and the available second strokes light up with their action labels. This makes chords self-documenting.

---

## Binding Resolver

The resolver is the central engine that turns (defaults + overrides + contexts) into a live keymap.

### Resolution Order

1. Start with profile defaults (e.g. "full keyboard QWERTY")
2. Apply user overrides (stored in `settings.keybindings`)
3. Validate: no two bindings share the same key in overlapping contexts
4. Generate CodeMirror keymap extensions (grouped by precedence)
5. Expose reactive query API for UI consumers

### Conflict Detection

```typescript
interface ConflictInfo {
  key: string;
  actions: ActionId[];           // All actions bound to this key
  overlappingContexts: boolean;  // True if when-clauses don't cleanly separate them
  osReserved: boolean;           // True if OS intercepts this key
}

interface BindingResolver {
  // Current resolved map
  resolved(): Map<ActionId, ResolvedBinding>;

  // Conflict queries
  conflictsFor(key: string): ConflictInfo | null;
  allConflicts(): ConflictInfo[];

  // Free key discovery
  freeKeys(opts?: { withModifiers?: string[] }): string[];

  // Rebind with suggestions
  rebind(action: ActionId, newKey: string): RebindResult;

  // Generate CodeMirror extensions
  toKeymapExtensions(): Extension[];
}
```

### Adaptive Conflict Resolution

When `rebind()` detects a conflict, it returns ranked suggestions:

```typescript
type RebindResult =
  | { status: "ok" }
  | { status: "conflict"; displaced: ActionId; suggestions: RebindSuggestion[] };

type RebindSuggestion =
  | { type: "context-split"; reason: string }    // "These don't overlap — allow both"
  | { type: "swap"; target: string }              // "Swap displaced action to Alt-j"
  | { type: "chord"; target: string }             // "Move to Alt-p h (probe namespace)"
  | { type: "nearby"; target: string }            // "Closest free key: Alt-Shift-h"
```

Suggestions are ranked by disruption: context-split (zero disruption) > swap (one other action moves) > chord (changes interaction pattern) > nearby (arbitrary relocation).

---

## OS & Layout Awareness

### Platform Detection

```typescript
type OsFamily = "mac" | "windows" | "linux";

function detectOs(): OsFamily {
  // navigator.userAgentData?.platform (modern)
  // Fallback: navigator.platform / userAgent sniffing
}
```

### Reserved Keys

Per-OS database of keys the browser/OS will intercept:

```typescript
const osReserved: Record<OsFamily, ReservedKey[]> = {
  mac: [
    { key: "Mod-q", reason: "Quit application" },
    { key: "Mod-h", reason: "Hide application" },
    { key: "Mod-m", reason: "Minimise window" },
    { key: "Ctrl-ArrowLeft", reason: "Desktop switching" },
    { key: "Ctrl-ArrowRight", reason: "Desktop switching" },
    // ...
  ],
  windows: [
    { key: "Alt-F4", reason: "Close window" },
    { key: "Ctrl-Alt-Delete", reason: "System interrupt" },
    { key: "Meta-l", reason: "Lock screen" },
    // ...
  ],
  linux: [
    // Fewer hard reservations — varies by DE
    // Populated from common Hyprland/GNOME/KDE defaults
  ],
};
```

The resolver warns (not blocks) when a user binds to an OS-reserved key, since some users may have remapped their OS.

### Browser-Reserved Keys

Separate from OS reservations, **browser-level keys cannot be intercepted by JavaScript at all**:

```typescript
const browserReserved: ReservedKey[] = [
  { key: "Ctrl-w", reason: "Close tab (unreachable)" },
  { key: "Ctrl-t", reason: "New tab (unreachable)" },
  { key: "Ctrl-n", reason: "New window (unreachable)" },
  { key: "Ctrl-l", reason: "Address bar (unreachable)" },
  { key: "F5",     reason: "Reload (unreachable)" },
  { key: "Ctrl-r", reason: "Reload (unreachable)" },
  { key: "F6",     reason: "Address bar (unreachable)" },
  { key: "F11",    reason: "Fullscreen (unreachable)" },
  { key: "F12",    reason: "DevTools (unreachable)" },
  { key: "Ctrl-Shift-i", reason: "DevTools (unreachable)" },
];
```

Unlike OS reservations (which the resolver warns about), browser reservations are **hard blocks** — the resolver refuses to bind to these and shows an explanation.

### Physical vs Logical Keys

```typescript
interface PhysicalKey {
  code: string;       // KeyboardEvent.code — "KeyA", "BracketLeft"
  label: string;      // What's printed on the keycap in this layout
}

interface LogicalKey {
  key: string;        // KeyboardEvent.key — "a", "["
}
```

The **Keyboard API** (`navigator.keyboard.getLayoutMap()`) maps physical codes to logical keys on Chromium. On Firefox/Safari, fall back to user-selected layout.

This matters for the visualiser: on a French AZERTY keyboard, the physical key labelled `[` is in a different position than on QWERTY. The visualiser must show the right label on the right physical key.

### Keyboard Layouts

Ship layout data as JSON:

```
src/lib/keybindings/layouts/
  qwerty-us.json
  qwerty-uk.json
  dvorak.json
  colemak.json
  azerty-fr.json
  qwertz-de.json
```

Each file defines the physical key grid (rows, key widths, key codes) and the label mapping per key. Auto-detect via Keyboard API where available, user override in settings.

---

## Keyboard Visualiser Component

### Props

```typescript
interface KeyboardVisualiserProps {
  // Data
  layout: KeyboardLayoutId;
  bindings: Map<ActionId, ResolvedBinding>;
  categories: Record<ActionCategory, { color: string; label: string }>;

  // State
  mode: "view" | "edit";
  activeContexts?: Set<string>;       // Currently true context predicates
  pendingChord?: string;              // Leader key pressed, awaiting second stroke
  heatmap?: Map<string, number>;      // Usage counts per key

  // Interaction
  onKeyClick?: (keyCode: string, currentAction?: ActionId) => void;
  onRebind?: (action: ActionId, newKey: string) => RebindResult;

  // Display options
  formFactor?: "full" | "compact" | "laptop";
  showLegend?: boolean;
  showCommandList?: boolean;
  highlightKeys?: string[];           // Tutorial/focus highlighting
  conflicts?: Set<string>;            // Keys with conflicts (red highlight)
}
```

### Visual Modes

**View mode** (default):
- Keys show their bound action label/icon, colour-coded by category
- Unbound keys are dimmed
- Modifier-hold preview: hold Alt for 500ms → keys show Alt-layer bindings
- Context-reactive: as predicates change, bindings update live

**Edit mode**:
- Click a key → enters "listening" state (key pulses)
- Press a new combo → conflict check → confirm/swap/cancel inline
- Displaced actions animate to their new position
- Free keys get a subtle "available" glow

**Chord mode** (automatic):
- Triggered when a leader key is pressed
- All non-completion keys dim to ~20% opacity
- Completion keys light up with action labels
- Timeout progress indicator (subtle ring around leader key)

**Heatmap overlay** (toggle):
- Keys glow by usage intensity (cool → warm gradient)
- Shows which parts of the keymap are actually used
- Useful for identifying candidates for rebinding

### Form Factors

The visualiser renders different physical layouts:

- **Full** (104-key): Standard layout with numpad
- **Compact** (65-key): No numpad, no F-row
- **Laptop**: Compact with Fn key, smaller modifiers

Auto-detected from layout + user override in settings.

### Adaptation from DvorakKeyboard

The existing `DvorakKeyboard` component in `~/src/nous` provides the rendering foundation:

- Row-based key grid with width multipliers ✓
- Category colour coding ✓
- Modifier key awareness ✓
- Command list sidebar ✓
- Legend component ✓

Changes needed:
- Replace hardcoded Dvorak `ROWS` with data-driven layout loading
- Replace `getBindings()` signal dependency with resolver prop
- Add edit mode (click-to-rebind flow)
- Add chord mode (pending-leader state)
- Add heatmap overlay
- Add modifier-hold preview
- Extract to reusable sub-components: `<KeyRow>`, `<Key>`, `<Legend>`, `<CommandList>`
- Remove nous-specific dependencies (state signals, tutorial system, icon imports)

---

## Discoverability Features

### Modifier-Hold Hints

When a modifier key is held for 500ms without pressing a second key, a small floating overlay appears near the cursor showing available completions:

```
┌─────────────────────────┐
│ Alt + ...               │
│  Enter  Execute (quant) │
│  /      Toggle help     │
│  g      Toggle viz      │
│  f      Symbol docs     │
│  p      Toggle probe    │
│  s →    Structure...    │
└─────────────────────────┘
```

- Appears near cursor, not in a fixed panel position
- Disappears immediately on modifier release or second keypress
- Chords show `→` to indicate a sub-namespace
- Configurable delay (default 500ms), can be disabled

### Action Palette

`Mod-Shift-P` opens a fuzzy-searchable command palette:

- Lists all actions with their current binding shown alongside
- Type to filter by action name, description, or category
- Enter to execute the selected action
- Optional "rebind" icon next to each action to enter edit flow
- After palette execution, a transient toast shows the keyboard shortcut: `"Tip: Alt-p toggles probes"`

The palette ensures every action is reachable even if its binding is forgotten or conflicts with the OS.

### Usage Heatmap

Track action invocations per session (in memory, not persisted by default):

```typescript
interface UsageTracker {
  record(action: ActionId): void;
  counts(): Map<ActionId, number>;
  heatmapByKey(): Map<string, number>;  // For visualiser overlay
  reset(): void;
}
```

The keyboard visualiser's heatmap overlay consumes this data. After a performance session, the user can review which actions they used most and least, informing rebinding decisions.

---

## Accessibility

### Sticky Modifiers

In-app sticky modifier mode (independent of OS accessibility settings):

- Press and release Ctrl → it "sticks" for the next keypress
- Press Ctrl again to unstick
- Visual indicator on the keyboard visualiser (modifier key stays lit)
- Configurable per modifier key

### Simplified Profiles

A "reduced complexity" profile that:
- Avoids all three-key combos (no Ctrl-Shift-X)
- Uses chords instead of simultaneous modifiers where possible
- Prioritises home-row-adjacent keys
- Ships as a built-in profile alongside the default

### Screen Reader

- Action execution announces the action description via `aria-live` region
- Keyboard visualiser is navigable via arrow keys with role announcements
- Conflict warnings are announced, not just visual

---

## Non-Editor Keyboard Handling

Three keyboard handling paths exist **outside** CodeMirror and outside the action registry:

### Overlay Manager (Escape)

`overlayManager.ts` registers a global `document.addEventListener("keydown")` that dispatches Escape to the topmost overlay in a LIFO stack. This is a **UI primitive** — it doesn't belong in the action registry because it's not an "action" the user would rebind. Escape-dismisses-overlay is a universal expectation.

**Decision**: Leave as-is. Do not register as an action.

### Modal Focus Trapping (Tab/Shift-Tab)

`Modal.tsx` registers Tab and Shift-Tab to cycle focus within the modal. Standard accessibility pattern.

**Decision**: Leave as-is. Not rebindable.

### Picker Menu Navigation (Arrow/Enter/Space/Escape)

`PickerMenu.tsx` registers `window.addEventListener("keydown")` for arrow navigation, Enter/Space selection, and Escape dismissal. This is more interesting — the arrow keys are the same keys used for editor navigation, and a user who can't use arrow keys (RSI, non-standard keyboard) has no way to navigate pickers.

**Decision**: Register picker navigation as actions (`"picker.up"`, `"picker.down"`, `"picker.left"`, `"picker.right"`, `"picker.select"`, `"picker.cancel"`) scoped with `when: "picker.open"`. This lets them be rebound and appear on the keyboard visualiser. The default bindings remain Arrow/Enter/Escape.

### Conditional Precedence: Backspace Gate

The current `Prec.highest` Backspace gate conditionally bypasses clojure-mode's bracket-aware backspace based on `editor.preventBracketUnbalancing`. This is modelled as a context predicate:

```typescript
// Backspace dispatches to different handlers based on bracket protection setting
{ action: "edit.backspaceNormal", key: "Backspace", when: "!editor.bracketProtect" },
// When bracketProtect is true, clojure-mode's handler takes over (no explicit binding needed)
```

The `Prec.highest` gate becomes unnecessary because the context system handles dispatch.

---

## Gamepad Integration

### Shared Action Namespace

Gamepad bindings target the same `ActionId` strings as keyboard bindings:

```typescript
const defaultGamepadBindings: GamepadBinding[] = [
  { action: "eval.now",         combo: ["Start"] },
  { action: "nav.toggleMode",   combo: ["Back"] },
  { action: "edit.delete",      combo: ["Y"] },
  { action: "menu.openBefore",  combo: ["LB", "A"] },
  { action: "menu.openAfter",   combo: ["RB", "A"] },
  { action: "menu.radial",      combo: ["X"] },
];
```

### Gamepad Visualiser

A controller diagram component alongside the keyboard visualiser:
- Same category colour coding
- Same edit-mode click-to-rebind flow
- Hold-button hints (hold LB for 500ms → show LB-combo overlay)

### Gamepad-Specific Contexts

```typescript
"gamepad.connected":  () => gamepadConnected(),
"gamepad.navMode":    () => gamepadNavMode() === "structural",
"gamepad.stickActive":() => stickActive(),
```

---

## Profile System

### Layout vs Profile (Orthogonal Dimensions)

**Layout** controls what the visualiser displays — which symbols appear on which physical keys. A Dvorak user sees Dvorak labels. This has **no effect on bindings** — `Mod-Enter` is `Mod-Enter` regardless of layout.

**Profile** controls which default key→action bindings are active. A "compact" profile avoids keys that don't exist on a 65% keyboard. A "simplified" profile avoids three-key combos.

These are independent choices: a Dvorak user on a compact keyboard selects `layout: "dvorak"` + `profile: "compact"`.

### Built-In Profiles

```typescript
interface BindingProfile {
  id: string;
  name: string;
  description: string;
  formFactor: "full" | "compact" | "laptop";  // Hint for visualiser, not coupled to layout
  keyBindings: KeyBinding[];
  gamepadBindings: GamepadBinding[];
}

// Profiles are layout-independent — they define bindings, not key labels
const builtInProfiles = [
  "default",              // Standard full-keyboard bindings
  "compact",              // 65% keyboard — avoids F-keys, numpad, Home/End
  "laptop",               // Laptop-friendly — avoids F-keys
  "simplified",           // Accessibility: no 3-key combos, chords instead
];
```

### User Overrides

User customisations are stored as a sparse override map — only keys that differ from the active profile's defaults:

```typescript
// In AppSettings
interface AppSettings {
  keybindings?: {
    profile: string;                        // Base profile ID
    layout: KeyboardLayoutId;               // Independent of profile
    overrides?: Record<ActionId, string>;   // Key overrides
    gamepadOverrides?: Record<ActionId, string[]>;
    chordTimeout?: number;                  // Default 1500ms
    modifierHintDelay?: number;             // Default 500ms
    stickyModifiers?: boolean;              // Default false
  };
}
```

### Import/Export

```typescript
interface ExportedProfile {
  version: 1;
  name: string;
  baseProfile: string;
  overrides: Record<ActionId, string>;
  gamepadOverrides?: Record<ActionId, string[]>;
}
```

- JSON file import/export via settings panel
- URL-encodable: `?keymap=base64...` loads a shared profile
- Workshop mode: instructor shares URL, students load identical bindings

---

## Testing Strategy

### Contract Tests (Phase 1 — Critical)

The migration from hardcoded keymaps to registry-generated keymaps **must not lose or change any bindings**. A contract test captures the current binding set before migration and asserts the generated set is identical:

```typescript
// src/contracts/keybindings.test.ts
test("registry generates identical keymaps to legacy hardcoded set", () => {
  const legacy = extractBindingsFromLegacyKeymap();  // Snapshot of current keymaps.ts
  const generated = resolver.toKeymapExtensions();
  expect(generated).toMatchBindings(legacy);
});
```

### Resolver Unit Tests (Phase 2)

The binding resolver is the most algorithmic module. Test:
- Conflict detection (same key, overlapping vs non-overlapping contexts)
- Context expression evaluation (negation, conjunction, edge cases)
- Suggestion ranking (context-split > swap > chord > nearby)
- Free key discovery (correct exclusion of bound + reserved keys)
- OS reserved key warnings vs browser reserved key blocks
- Merge semantics (override replaces default, unset override falls through)

### Integration Tests (Phase 4)

- Keyboard visualiser renders correct layout for each keyboard layout file
- Edit mode rebinding flow: click → listen → conflict → resolve → persist
- Chord mode: leader press → timeout → fallback

### Snapshot Tests

Each keyboard layout JSON file should have a snapshot test that renders the visualiser and confirms the key count, row structure, and label mapping.

---

## Migration Path

### Phase 1: Foundation

Extract current hardcoded bindings into the action registry and default bindings modules. Generate CodeMirror keymaps from the registry instead of hardcoded arrays. Fix the stale KeybindingsTab by reading from the registry. No user-facing behaviour change — this is a refactor.

### Phase 2: User Customisation

Add the binding resolver with conflict detection. Persist overrides in settings. Build the rebinding UI in the keybindings panel. Add the action palette.

### Phase 3: Contexts & Chords

Implement context predicates and when-clause evaluation. Add chord sequence support with timeout. Update the resolver to handle context-aware conflict detection.

### Phase 4: Keyboard Visualiser

Port the DvorakKeyboard rendering logic. Make layout data-driven. Add view/edit/chord modes. Ship initial layout data files (QWERTY-US, Dvorak at minimum).

### Phase 5: Discoverability & Polish

Modifier-hold hints. Usage heatmap. Additional keyboard layouts. Gamepad visualiser. Profile import/export. Accessibility features (sticky modifiers, simplified profile, screen reader).

---

## Known Display Bugs (pre-existing)

These will be fixed as part of Phase 1 (`.6` Fix KeybindingsTab):

1. `Alt-h` is labelled "Toggle Help Panel" in KeybindingsTab but actually fires `expandCurrentProbeContext`
2. `Mod-Shift-Enter` (soft eval) is not shown in KeybindingsTab at all
3. Probe bindings (`Alt-p`, `Alt-Shift-p`, `Alt-s`) are not shown in KeybindingsTab at all

---

## Open Questions

1. **Chord timeout UX** — Is 1500ms right? Should the timeout be visual (countdown ring) or just a feel thing?
2. **Layout detection reliability** — The Keyboard API is Chromium-only. How important is auto-detection vs manual selection for Firefox/Safari users?
3. **Gamepad rebinding** — Do we need full gamepad rebinding, or is the default set sufficient for the small gamepad user base?
4. **Structural editing bindings** — The chord approach (`Alt-s [`, `Alt-s ]`) adds a keystroke vs the current direct bindings (`Ctrl-[`, `Ctrl-]`). Should chords be the default or an option?
5. **Clojure-mode keymap updates** — When the library adds new bindings, should they auto-register as actions or require explicit wrapping?
6. **Picker menu rebindability** — Are arrow keys for picker navigation worth making rebindable, or is this over-engineering for an edge case?
