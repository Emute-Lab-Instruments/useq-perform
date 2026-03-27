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
4. For editor scenarios: `createInspectorEditor()` boots a CodeMirror instance with only the requested extensions
5. For component scenarios: the scenario's `component()` function produces a DOM element

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
    diagnostics: [                        // optional — pushed after editor creation
      { start: 0, end: 7, severity: 'error', message: 'Something wrong' },
    ],
  },
});
```

### Component scenarios

```typescript
export default defineScenario({
  category: 'Settings UI / General Settings',
  name: 'Default state',
  type: 'contract',
  sourceFiles: ['src/ui/settings/GeneralSettings.tsx'],
  component: {
    component: () => {
      const el = document.createElement('div');
      el.innerHTML = '<p>Placeholder — full SolidJS rendering pending</p>';
      return el;
    },
    width: 400,
    height: 600,
  },
});
```

### Key rules for scenarios

- **One concern per scenario.** Each scenario should test exactly one visual feature. Don't combine structure highlights with diagnostics.
- **Declare extensions explicitly.** Use the `extensions` field to load only what the scenario needs. Available names: `structure-highlight`, `eval-highlight`, `diagnostics`, `gutter`, `inline-results`. Omit for bare syntax-only editors (e.g., theme showcases).
- **Use realistic code.** The code content should look like real uSEQ patches, not contrived `(a (b (c)))` unless testing a specific edge case.
- **Describe what to look for.** The `description` field should say what the reviewer should verify visually.
- **Use `canary` for edge cases** (breaking = needs review) and `contract` for core behaviors (breaking = regression).
- **Verify `sourceFiles` paths exist.** These are used in the context-copy bundle — wrong paths make the copy useless.

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

## Approval workflow

- Approvals are stored in localStorage (key: `inspector-approvals`)
- Green dot in nav tree = approved, no dot = unreviewed
- Filter button (top of nav) toggles showing only unreviewed scenarios
- Approval state is local-only, not committed to git

## Build and verify

```bash
npm run inspector                                    # dev server on port 5555
npx vite build --config inspector/vite.config.ts     # production build
```

The Inspector shares the main app's `src/` via the `@src` alias. Changes to app source code are reflected via Vite HMR.
