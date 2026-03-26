# Inspector — Dev Review Tool

## Problem

uSEQ Perform development involves multiple parallel AI agent sessions working on different aspects of the app simultaneously (UI, editor extensions, functionality). The current workflow has two critical pain points:

1. **No visual overview**: There's no way to quickly scan all visual aspects of the app and verify they render correctly. The app itself is a single integrated experience — you can't isolate and inspect individual features.

2. **Context bootstrapping**: Each new agent session starts with zero visual context. Pointing an agent at "the hover state of structure highlights in nested expressions" requires verbose natural-language descriptions. There's no way to hand an agent a precise, machine-readable pointer to a specific visual scenario.

Storybook exists in the repo but is broken and doesn't address the core need: it's component-focused, not feature-focused, and lacks review workflow support.

## Solution

**Inspector** is a same-repo Vite app that presents every visual aspect of the app as reviewable scenarios, organized by user-facing concept rather than source tree structure. It supports a review workflow where scenarios are marked as approved/unreviewed, and provides one-click context copying for dispatching agent work.

## Core Concepts

### Scenarios

A **scenario** is an explicit TypeScript module that configures an embedded app slice to demonstrate a specific visual aspect in a specific state. Scenarios use real CodeMirror instances and WASM interpreters where needed — no mocking of rendering.

Each scenario declares:
- **Category** — where it appears in the nav tree
- **Name** — human-readable description
- **Type** — `canary` (visual edge case; breaking = review needed) or `contract` (core behavior; breaking = regression)
- **Setup** — editor content, settings overrides, mock data, WASM state
- **Source files** — which source files are relevant to this scenario (used in context bundles)

```typescript
// inspector/scenarios/editor/structure-highlights-nested.ts
import { defineScenario } from '../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Nested expression highlighting',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure.ts',
    'src/editors/extensions/structure/decorations.ts',
  ],
  setup: {
    editorContent: '(+ (* 2 3) (- 10 (/ 8 4)))',
    settings: {
      'editor.structureHighlights': true,
      'editor.theme': 'dark',
    },
    cursorPosition: 4, // inside (* 2 3)
  },
});
```

### Nav Tree

A custom taxonomy organized by user-facing concept, not source tree:

```
Editor Decorations
  Structure Highlights
    Nested expressions
    Top-level forms
    Cursor at boundary
  Probe Oscilloscopes
    Single probe
    Multiple probes
    Probe on error output
  Diagnostics
    Syntax error squiggles
    Warning with suggestion
    Multiple errors
  Eval Highlights
    Flash on eval
    Error highlight
  Inline Results
    Numeric result
    Error result
    Long result truncation
Settings UI
  General Settings
    Default state
    Modified state
  Visualisation Settings
    All controls
  Theme Settings
    Light theme
    Dark theme
    Custom theme
Visualisation
  Serial Vis
    Sine wave
    Square wave
    Multiple channels
  Vis Legend
    All channel types
Help & Reference
  Help Panel
    Reference tab
    Snippets tab
    Keybindings tab
  Code Snippets
    Snippet with highlighting
Toolbar & Chrome
  Main Toolbar
    Connected state
    Disconnected state
  Transport Toolbar
    All transport states
  Panel Chrome
    Collapsed
    Expanded
Modals & Overlays
  Modal Dialog
    Confirmation
    Form
  Picker Menu
    Flat list
    Hierarchical
  Radial Menu
    Single ring
    Double ring
```

Categories and their contents are derived from scenario file metadata — the tree is auto-built from the `category` fields.

### Approval Tracking

A `.gitignore`'d JSON file (`inspector/.approvals.json`) maps scenario IDs to approval status. This keeps approval state local and out of the repo:

```json
{
  "editor/structure-highlights-nested": {
    "status": "approved",
    "approvedAt": "2026-03-26T14:30:00Z"
  },
  "editor/probe-single": {
    "status": "unreviewed"
  }
}
```

When navigating the tree:
- **Approved** scenarios show a green indicator
- **Unreviewed** scenarios show no indicator (neutral)
- The nav tree can be filtered to show only unreviewed scenarios

Status is manually toggled — press Enter or click a button to approve. No automatic invalidation in MVP (content-hash invalidation is a future enhancement).

### Context Copying

Each scenario has a "Copy Context" button that assembles a medium-depth context bundle to the clipboard:

```markdown
## Scenario: Nested expression highlighting
Category: Editor Decorations / Structure Highlights
Type: canary

### Source Files
- `src/editors/extensions/structure.ts`
- `src/editors/extensions/structure/decorations.ts`

### Scenario Config
```typescript
{
  editorContent: '(+ (* 2 3) (- 10 (/ 8 4)))',
  settings: { 'editor.structureHighlights': true, 'editor.theme': 'dark' },
  cursorPosition: 4,
}
```

### Relevant Source
<contents of src/editors/extensions/structure.ts>
<contents of src/editors/extensions/structure/decorations.ts>
```

The bundle includes enough context for an AI agent to understand what component/feature is involved, find the relevant code, and reproduce the scenario.

### Debug Overlays

Any scenario can toggle an inline debug overlay that shows reactive store snapshots:

- SolidJS store state rendered as a collapsible JSON tree
- Stores shown: settingsStore, visualisationStore, outputHealthStore, consoleStore (configurable per scenario)
- Updates reactively as the scenario runs
- Positioned as a slide-out panel on the right side of the scenario viewport

## Architecture

### Project Structure

```
inspector/
  index.html              — Entry point
  main.tsx                — App bootstrap
  framework/
    scenario.ts           — defineScenario() + types
    registry.ts           — Auto-discovers and indexes scenarios
    context.ts            — Context bundle assembly + clipboard
    approvals.ts          — Read/write approvals.json
    debug-overlay.tsx      — Store snapshot overlay component
  app/
    Inspector.tsx          — Root layout: nav tree + scenario viewport
    NavTree.tsx            — Keyboard-navigable tree component
    ScenarioViewer.tsx     — Lazy-loads and renders one live scenario
    ApprovalBadge.tsx      — Green/neutral indicator
    ContextButton.tsx      — Copy-context button
  scenarios/
    editor/
      structure-highlights-nested.ts
      structure-highlights-toplevel.ts
      probe-single.ts
      probe-multiple.ts
      diagnostics-syntax-error.ts
      ...
    settings/
      general-default.ts
      visualisation-all.ts
      ...
    visualisation/
      serial-vis-sine.ts
      ...
  .approvals.json         — Local approval state (.gitignore'd)
  vite.config.ts          — Separate Vite config
```

### Tech Stack

- **SolidJS** — same as the main app
- **Vite** — separate entry point, shares source tree via aliases
- **No Storybook** — completely independent. Storybook can be removed later.
- **HMR** — Vite's built-in HMR for live updates as code changes

### Scenario Rendering

Each scenario is rendered inside an iframe for full style and script isolation:

1. Boots the relevant app slice (CodeMirror + extensions, or UI component tree)
2. Applies the scenario's settings overrides
3. Sets up the scenario's editor content and cursor position
4. Renders at a fixed viewport size for consistency

Only one scenario is live at a time (lazy loading). Selecting a new scenario in the nav tree unmounts the previous one and mounts the new one.

### Scenario Discovery

Scenarios are auto-discovered via Vite's `import.meta.glob`:

```typescript
const scenarios = import.meta.glob('./scenarios/**/*.ts', { eager: false });
```

The registry builds the nav tree from the `category` fields of all discovered scenarios.

## MVP Scope

### Must Have (MVP)
- [ ] Inspector framework: `defineScenario()`, registry, Vite config
- [ ] Inspector app shell: nav tree + scenario viewport
- [ ] Keyboard navigation in nav tree (arrow keys)
- [ ] Lazy scenario rendering with embedded app slices
- [ ] Copy-context button with medium bundle
- [ ] Approval tracking (green/unreviewed) with `.gitignore`'d local JSON
- [ ] Filter nav tree by approval status
- [ ] 10 real scenarios covering key app aspects:
  1. Structure highlights — nested expressions
  2. Structure highlights — top-level forms
  3. Probe oscilloscope — single probe
  4. Diagnostics — syntax error with squiggles
  5. Inline results — numeric result display
  6. Settings panel — general settings default state
  7. Visualisation — serial vis with sine wave data
  8. Help panel — reference tab
  9. Main toolbar — connected vs disconnected
  10. Theme — dark vs light comparison

### Future Enhancements
- Content-hash auto-invalidation of approvals
- Inline debug overlays (store snapshots)
- Screenshot diffing / visual regression
- Scenario search
- Batch context copying (select multiple scenarios)
- CI integration
- Cross-branch approval comparison

## Non-Goals

- Replacing unit/contract tests — this is a visual review tool, not a test runner
- Automated visual regression in CI — human-only for now
- Component API documentation — this is about visual verification, not docs
- Supporting non-visual scenarios — every scenario must produce visible output

## Decisions

- **Scenario isolation**: Iframes for full style/script isolation. Each scenario gets its own mini-page.
- **Scenario format**: TypeScript modules with `defineScenario()`. Type-safe, IDE-friendly.
- **Nav tree**: Custom taxonomy derived from scenario `category` fields. Not mirroring source tree.
- **Approval storage**: `.gitignore`'d local JSON (`inspector/.approvals.json`). No auto-invalidation in MVP.
- **Context bundle**: Medium depth — file paths, source snippets, scenario config. No annotation UI.

## Open Questions

1. **WASM lifecycle**: How to handle WASM interpreter initialization per scenario without excessive startup cost?
2. **Storybook removal**: When to rip out the existing broken Storybook? Before, during, or after Inspector is stable?
3. **Iframe communication**: How does the Inspector shell communicate with the scenario iframe (postMessage, shared Vite module graph, or srcdoc with inlined code)?
