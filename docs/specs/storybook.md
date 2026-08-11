---
stability: stable
layer: cross-cutting
---

# Storybook — Isolated Review Surface

## Source files

- `.storybook/` — Storybook configuration and Vitest browser-test setup
- `stories/` — feature-oriented stories built from production components
- `harness/` — reusable editor and extension setup for stories that need a live CodeMirror surface
- `vite.config.ts` — declares the `storybook` Vitest project

1.1 **Storybook is the canonical isolated visual review surface.** Components and editor features that need representative states outside the full application belong in feature-oriented stories under `stories/`.

1.2 **Stories exercise production seams.** A story uses production components and the shared harness, with props or explicit dependency injection providing the state that the full application would normally own. A parallel review-only component implementation is not acceptable.

1.3 **Storybook has two automated gates.** `npx vitest run --project storybook` exercises stories in Chromium, and `npm run build-storybook` proves that the isolated surface can be assembled as a static artifact.

1.4 **Isolated health is not full-runtime acceptance.** Storybook does not establish Web Serial, physical hardware, production Worker/WASM, audio routing, or integrated application behaviour. Those claims require their dedicated runtime, browser, or hardware gates.

1.5 **Inspector is retired.** Its one production-component coverage gap—the synthesis engine indicator's off, suspended, running, and recovery states—lives in `stories/toolbar/engine-indicator.stories.tsx`; the simultaneous hardware plus WASM-shadow state lives in `stories/toolbar/main-toolbar.stories.tsx`.

1.6 **Stale isolated scenarios are not retained.** Inspector scenarios importing the removed `PickerMenu`, `DoubleRadialPicker`, `RadialMenu`, or Canvas2D `serialVis` implementations, and the old Storybook `InternalVis` story, described obsolete surfaces rather than current product contracts.

1.7 **Inspector-local workflow features are not product contracts.** Approval badges, browser-local approval state, and copied agent-context bundles were intentionally removed with Inspector. If review-state tracking becomes a requirement, it needs a named durable owner rather than another visual-surface implementation.
