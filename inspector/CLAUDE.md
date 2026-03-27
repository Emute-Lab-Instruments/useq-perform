# Inspector — Dev Review Tool

The Inspector is a same-repo Vite app for visually reviewing every aspect of uSEQ Perform in isolation. It renders real CodeMirror editors with the app's actual extensions, organized in a navigable tree of scenarios.

Run: `npm run inspector` (port 5555)

## Architecture

```
inspector/
  vite.config.ts              Vite config — @src alias maps to ../src
  index.html / main.tsx       SPA entry — mounts <Inspector />
  inspector.css               All Inspector styles (single file)
  scenario-runner.html/.tsx   Runs inside an iframe — renders one scenario at a time
  framework/
    scenario.ts               defineScenario() types — the authoring API
    editor.ts                 CodeMirror harness — extension registry + lazy loading
    registry.ts               import.meta.glob auto-discovery + nav tree builder
    context.ts                Context bundle assembly for clipboard
    approvals.ts              localStorage-backed approval state
  app/
    Inspector.tsx             Root layout: nav tree + viewport
    NavTree.tsx               Keyboard-navigable recursive tree
    ScenarioViewer.tsx        iframe bridge via postMessage
    ContextButton.tsx         Copy context to clipboard
    ApprovalBadge.tsx         Green dot for approved scenarios
  scenarios/                  All scenario files, organized by category
```

### How scenario rendering works

1. User selects a scenario in the nav tree
2. `ScenarioViewer` sends scenario data to the iframe via `postMessage`
3. `scenario-runner.tsx` receives the message, dynamically imports the scenario module
4. For editor scenarios: `createInspectorEditor()` boots a real CodeMirror instance with only the requested extensions, then pushes seed data (diagnostics, eval highlights, inline results)
5. For component scenarios with `render`: SolidJS `render()` mounts real JSX components
6. For component scenarios with `component` (legacy): the function returns a raw DOM element

### The iframe boundary

Scenarios render inside an iframe for full style/script isolation. This means:
- The main app's runtime (transport, WASM, stores) is NOT available in the iframe
- Extensions that depend on runtime globals must use dependency injection (see below)
- All imports from `@src/` in `editor.ts` use dynamic `import()` to avoid pulling in the full app module graph at load time

## Writing scenarios

### Editor scenarios

```typescript
import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',  // nav tree path
  name: 'Nested expressions',                             // leaf label
  type: 'canary',                                         // or 'contract'
  sourceFiles: ['src/editors/extensions/structure.ts'],    // for context copying
  description: 'What this tests and what to look for.',
  editor: {
    editorContent: '(+ (* 2 3) (- 10 (/ 8 4)))',
    extensions: ['structure-highlight'],  // ONLY load what this scenario tests
    cursorPosition: 4,
  },
});
```

### Component scenarios (real JSX — preferred)

Use `.tsx` files that import and render real SolidJS components with props. Most UI components have been refactored to accept props instead of importing singletons.

```tsx
// inspector/scenarios/toolbar/transport-playing.tsx
import { defineScenario } from '../../framework/scenario';
import { TransportToolbar } from '@src/ui/TransportToolbar';

export default defineScenario({
  category: 'Toolbar & Chrome / Transport Toolbar',
  name: 'Playing state',
  type: 'contract',
  sourceFiles: ['src/ui/TransportToolbar.tsx'],
  description: 'Transport toolbar in playing state with play button disabled.',
  component: {
    render: () => (
      <TransportToolbar
        state="playing"
        mode="hardware"
        progress={0.6}
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
        onRewind={() => {}}
        onClear={() => {}}
      />
    ),
    loadAppStyles: true,  // loads src/ui/styles/index.css in the iframe
    width: 500,
    height: 80,
  },
});
```

**Key points:**
- Use `render` (returns JSX), not `component` (returns DOM element). The `component` field is legacy.
- Set `loadAppStyles: true` for components that need the app's CSS.
- Pass all data and callbacks as props — no store imports in scenarios.
- Components already refactored to props: MainToolbar, TransportToolbar, ProgressBar, Modal, VisLegend, GeneralSettings (+ sub-panels), HelpPanel, KeyboardVisualiser.

### Component scenarios (legacy DOM — avoid)

The `component` field (returns raw DOM element) is legacy. Only the `_example/hello-world.ts` still uses it. All new component scenarios should use `render` (returns JSX).

### Key rules for scenarios

- **One concern per scenario.** Each scenario should test exactly one visual feature. Don't combine structure highlights with diagnostics.
- **Declare extensions explicitly.** Use the `extensions` field to load only what the scenario needs. Available names: `structure-highlight`, `eval-highlight`, `diagnostics`, `gutter`, `inline-results`. Omit for bare syntax-only editors (e.g., theme showcases).
- **Use realistic code.** The code content should look like real uSEQ patches, not contrived `(a (b (c)))` unless testing a specific edge case.
- **Describe what to look for.** The `description` field should say what the reviewer should verify visually.
- **Use `canary` for edge cases** (breaking = needs review) and `contract` for core behaviors (breaking = regression).
- **Verify `sourceFiles` paths exist.** These are used in the context-copy bundle — wrong paths make the copy useless.
- **Add `grepTerms`** — function names, class names, CSS classes, prop names that help an agent find the relevant code. Include them with the dot prefix for CSS (`.cm-evaluated-code`). These appear in the "Copy Context" clipboard bundle.

### Seed data — making extensions visually active

Extensions like diagnostics, eval highlight, and inline results only produce visible output when data is pushed into them. In the real app this happens after evaluation; in Inspector, you declare the seed data declaratively in the scenario.

**Available seed data fields** (all on `editor`):

```typescript
editor: {
  editorContent: '...',
  extensions: ['diagnostics'],

  // Squiggly underlines — pushed via pushDiagnostics()
  diagnostics: [
    { start: 0, end: 7, severity: 'error', message: 'Unmatched paren',
      suggestion: 'Add a closing )', example: '(+ 1 2)' },
  ],

  // Eval flash — triggered via flashEvalHighlight()
  evalHighlight: { from: 0, to: 10, isPreview: false },

  // Inline result widgets — dispatched via showInlineResult effect
  inlineResults: [
    { text: '3', pos: 7 },                    // normal result
    { text: '{error}', pos: 15, isError: true }, // error result
  ],

  // Gutter "last evaluated" markers — dispatched via expressionEvaluatedAnnotation
  evaluatedExpressions: [
    { expressionType: 'a1', position: { from: 0, to: 14, line: 1 } },
  ],
}
```

**When to use seed data:**
- Diagnostics: always needed — WASM interpreter isn't running in the iframe
- Eval highlight: always needed — nothing triggers evaluation
- Inline results: always needed — no eval loop
- Gutter: the gutter pattern-matches `a1-a8`, `d1-d8`, `s1-s8` from the code, so colored bars appear automatically. Use `evaluatedExpressions` to show the "last evaluated" visual state.
- Structure highlights: NOT needed — these respond to cursor position, which is set via `cursorPosition`

### Category taxonomy

Categories use ` / ` as separator. Current taxonomy:

```
Editor Decorations / Structure Highlights
Editor Decorations / Expression Gutter
Editor Decorations / Eval Highlight
Editor Decorations / Diagnostics
Editor Decorations / Inline Results
Editor Decorations / Probes
Themes
Settings UI / ...
Help & Reference / ...
Toolbar & Chrome / ...
Modals & Overlays / ...
Keybindings / ...
Visualisation / ...
```

Don't invent new top-level categories without reason. Add subcategories freely.

## Extension registry

The editor harness (`framework/editor.ts`) uses a named registry of extensions. Each entry is a lazy factory — the extension's module is only loaded when a scenario requests it.

To add a new extension to the registry:

```typescript
// In framework/editor.ts extensionRegistry
'my-extension': async () => {
  const { myField } = await import('@src/editors/extensions/myExtension');
  return myField;
},
```

Then scenarios can use `extensions: ['my-extension']`.

**Critical: use dynamic `import()` in the registry**, not top-level imports. The iframe context doesn't have the full app runtime, so any module that transitively imports transport, WASM, or stores will crash at load time if imported eagerly.

## Refactoring main app extensions for Inspector use

When an extension in `src/editors/extensions/` can't render in the Inspector because it imports runtime globals, the fix is dependency injection — NOT mocking.

### The pattern

1. **Define a config interface** declaring exactly what the extension needs:

```typescript
export interface GutterConfig {
  isGutterEnabled: () => boolean;        // not getAppSettings().ui.expressionGutterEnabled
  getExpressionColor: (match: RegExpExecArray) => string;  // not getMatchColor()
  onPlayExpression: (view: EditorView, exprType: string) => void;  // not handlePlayExpression()
}
```

2. **Create a factory** that accepts the config:

```typescript
export function createExpressionGutter(config: GutterConfig): Extension[] { ... }
```

3. **Create a backward-compatible default** that wires the existing globals:

```typescript
export function createDefaultGutterConfig(): GutterConfig {
  return {
    isGutterEnabled: () => getAppSettings()?.ui?.expressionGutterEnabled !== false,
    // ...
  };
}
```

4. **Keep the old export** for the main app:

```typescript
export const structureExtensions = [
  ...createExpressionGutter(createDefaultGutterConfig()),
];
```

### Principles

- **Each extension declares its own config type.** Don't pass `AppSettings` — pass the specific values. A gutter doesn't need to know about theme settings.
- **Use getter functions for reactive values** (`isGutterEnabled: () => boolean` not `gutterEnabled: boolean`), since the main app reads them dynamically.
- **Optional callbacks for side effects.** If the Inspector doesn't need play buttons, `onPlayExpression` can be `() => {}`.
- **No mocks.** The Inspector provides real (simple) values, not mock objects pretending to be something they're not.
- **Run typecheck and lint** after refactoring: `npx tsc --noEmit`, `npx eslint src/editors/extensions/<file>`.
- **Run tests**: `npm run test:unit` — pre-existing failures in probes.test.ts and appLifecycle.test.ts are known and unrelated.

### Already refactored

| Extension | Config type | Factory | File |
|---|---|---|---|
| Structure decorations | `GutterConfig` | `createExpressionGutter()` | `structure/decorations.ts` |
| Inline results | `InlineResultsConfig` | `createInlineResultsField()` | `inlineResults.ts` |
| Probes | `ProbeConfig` | `createProbeExtensions()` | `probes.ts` |

### Still coupled (need refactoring to integrate)

| Extension | Coupling | Priority |
|---|---|---|
| Vis readability | `getAppSettings`, vis panel visibility | Low — niche feature |

### Already standalone (no refactoring needed)

- `evalHighlight.ts` — zero external deps
- `diagnostics.ts` — only type imports from wasmInterpreter
- `structure/ast.ts` — pure AST helpers
- `structure/decorations.ts:nodeHighlightPlugin` — pure geometry + AST
- `themes.ts` — pure theme specs

## Refactoring UI components for Inspector use

UI components in `src/ui/` that import singletons (stores, services, adapters) can't render in the Inspector iframe. The fix is **props** — push the "where does this data come from" question to the adapter layer.

### The pattern

1. **Define a props interface** with the data and callbacks the component needs
2. **Refactor the component** to read from props instead of importing singletons
3. **Update the adapter** (`src/ui/adapters/`) to wire the real implementations into props
4. **Keep backward compat** — make props optional with defaults where possible

### Already refactored to props

| Component | Props interface | Adapter |
|---|---|---|
| ProgressBar | `ProgressBarProps` (progress) | TransportToolbar passes visStore.bar |
| TransportToolbar | `TransportToolbarProps` (state, mode, progress, callbacks) | `ConnectedTransportToolbar` in toolbars.tsx |
| MainToolbar | `MainToolbarProps` (connectionState, 8 callbacks) | `WiredMainToolbar` in toolbars.tsx |
| Modal | `ModalProps` (title, onClose, optional onOverlayRegister) | modal.tsx passes pushOverlay |
| VisLegend | `VisLegendProps` (channels array) | Not mounted in app yet |
| GeneralSettings | `GeneralSettingsProps` (settings, callbacks) | Optional props, defaults to globals |
| HelpPanel | `HelpPanelProps` (optional tabs) | Optional, defaults to real tabs |
| KeyboardVisualiser | `KeyboardVisualiserProps` (layout, bindings) | Optional, defaults to real bindings |

### Still coupled (components not yet refactored)

| Component | Coupling | Notes |
|---|---|---|
| PickerMenu | `pushOverlay`, gamepad channels | Props-friendly shape, needs overlay decoupling |
| DoubleRadialPicker | `pushOverlay`, gamepad channels | Same pattern as PickerMenu |
| RadialMenu | Already props-only | Just needs a scenario |
| ActionPalette | Action registry, keybinding store | Complex — may need scoped refactor |
| ModifierHints | Keybinding store | Same pattern as ActionPalette |
| ThemeSettings | settingsStore, editor themes, panel adapters | Medium complexity |
| FormControls | settingsSearch signal | Minor coupling |

## Approval workflow

- Approvals are stored in localStorage (key: `inspector-approvals`)
- Green dot in nav tree = approved, no dot = unreviewed
- Filter button (top of nav) toggles showing only unreviewed scenarios
- Approval state is local-only, not committed to git

## Validation

Run `npm run inspector:validate` to check all scenarios (runs in ~1.6s):

```bash
npm run inspector:validate
```

The Vitest test (`inspector/scenarios.test.ts`) validates:
- Required fields exist (name, category, type, sourceFiles)
- `type` is `'canary'` or `'contract'`
- `cursorPosition` is within `editorContent` length
- `extensions` names are registered in the registry
- Diagnostic/evalHighlight/inlineResult ranges are within document bounds
- All `sourceFiles` paths exist on disk

TSX component scenarios are skipped during validation (they need Vite's `@src` alias which isn't available in the jsdom test runner).

**Run validation after creating or modifying scenarios.** It catches bugs like out-of-bounds cursor positions that would silently fail in the browser.

## Build and verify

```bash
npm run inspector                                    # dev server on port 5555
npm run inspector:validate                           # validate all scenarios
```

**Known issue**: `npx vite build --config inspector/vite.config.ts` (production build) fails because real JSX component scenarios pull in the entire app module graph. Dev server works fine. This is not urgent — Inspector is a dev-only tool.

The Inspector shares the main app's `src/` via the `@src` alias. Changes to app source code are reflected via Vite HMR.
