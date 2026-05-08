# Editor

> Spec: main and secondary editor instances. Counterpart to [MAIN.md](MAIN.md).
> See also [code-evaluation.md](code-evaluation.md) for evaluation behaviour.

### Source files

- `src/editors/extensions.ts` — master extension-set assembly for main and secondary editors
- `src/editors/keymaps.ts` — CodeMirror keymap wiring
- `src/editors/editorKeyboard.ts` — keyboard utilities and event handling
- `src/editors/themes.ts` — theme compartment and hot-switching
- `src/editors/gamepadNavigation.ts` — gamepad-driven editor navigation
- `src/editors/holeFocusEmitter.ts` — `holeFocused` event publisher
- `src/editors/commands/editorCommandRouter.ts` — command dispatch (bracket protection, deletion policy)
- `src/editors/bracketProtection.test.ts` — bracket protection tests
- `src/editors/extensions/expressionHighlights.ts` — expression gutter marks
- `src/editors/extensions/expressionEval.ts` — expression evaluation extension
- `src/editors/extensions/inlineResults.ts` — inline eval-result widgets
- `src/editors/extensions/diagnostics.ts` — inline diagnostic annotations
- `src/editors/extensions/probes.ts` — probe inline widgets
- `src/editors/extensions/evalHighlight.ts` — eval flash decoration
- `src/editors/extensions/visReadability.ts` — visualisation readability extension
- `src/effects/editor.ts` — editor side-effect module (autosave, focus, lifecycle)
- `src/lib/persistence.ts` — persistence service (localStorage access)

1.1 The app uses CodeMirror 6 as the substrate for **multiple editor instances** that share a common foundation but differ in role and in which extensions they carry. There is exactly one **main editor** (the user's live-coding surface); additional **secondary editors** appear inline in the help guide as code examples, tutorial playgrounds, theme demos/previews, snippet previews, and similar contexts.

1.2 **Each editor declares which extensions it needs.** Extensions that depend on runtime globals (settings, WASM, stores) follow a Config-interface + factory pattern (`createXxxConfig()`/`createXxxExtensions()`), so the same extension can be configured differently per editor — or omitted entirely. There is no single hardcoded extension set; the main editor wires the full app stack, secondary editors opt in to a subset. (See `src/editors/extensions.ts`)

1.3 **Main editor.** The user's primary live-coding surface. Wires the full extension set: themes, autosave, bracket protection, structural editing, expression gutter, probes, eval results, diagnostics, evaluation, gamepad navigation. There is exactly one main editor in the app at a time. Sections 1.4–1.12 below specify behaviours of the main editor.

1.4 The main editor's content on first load is determined by precedence: explicit URL load (`?gist`/`?txt`) > persisted user code > startup-context default > empty.

1.5 **Autosave** (main editor only). With `storage.saveCodeLocally && storage.autoSaveEnabled` (both default true), the main editor persists its full content every `storage.autoSaveInterval` ms (default 5000, min 1000, max 60000). The interval is reconfigured live when settings change. Secondary editors do not autosave. (See `src/effects/editor.ts`, `src/lib/persistence.ts`)

1.6 The main editor is themed via a CodeMirror compartment driven by `editor.theme`. Theme switches must be hot — no reload, no flash of unstyled content — and must coincide with chrome theme changes (see [themes.md](themes.md)). Secondary editors may either follow the global theme or be pinned to a specific theme (e.g. theme-demo previews show one theme regardless of the user's active theme). (See `src/editors/themes.ts`)

1.7 **Bracket protection** (`editor.preventBracketUnbalancing`, default true) gates Backspace and Delete in the main editor: when on, the command router blocks deletion of closing delimiters and removes matched auto-inserted pairs; when off, deletion is normal. Policy enforcement lives in the command router, not in any keymap handler or third-party extension — see [input-dispatch.md](input-dispatch.md) §4.1. Secondary editors decide independently whether to enable bracket protection. (See `src/editors/commands/editorCommandRouter.ts`, `src/editors/bracketProtection.test.ts`)

1.8 The main editor has a left **expression gutter** (`ui.expressionGutterEnabled`, default true) that visually marks evaluable top-level forms with per-channel rails and play buttons. The gutter must remain in sync with the AST as the user types. Secondary editors may or may not include the gutter depending on whether evaluation is in scope for that editor. Full contract — rail-active semantics, failure/stale pulses, vis-toggle exclusivity, implicit soft sampling, persistence, action surface — lives in [expression-gutter.md](expression-gutter.md). (See `src/editors/extensions/expressionHighlights.ts`)

1.9 The main editor surfaces inline **eval results** and **diagnostics** as widgets/decorations attached to evaluated ranges. These do not modify the document; they are presentation only. Secondary editors that support evaluation (e.g. tutorial playgrounds) may surface these too; read-only example editors do not. (See `src/editors/extensions/inlineResults.ts`, `src/editors/extensions/diagnostics.ts`)

1.10 The main editor wires the **structural editing** stack — focus-primary AST navigation and mutation, the Metas annotation layer, and structural vs insertion modes. Full ontology and operation algebra in [structural-editing.md](structural-editing.md). Secondary editors may opt in. (See `src/editors/extensions/structure/`)

1.11 **Probes** are inline, time-following sample widgets attached to user-marked subexpressions. They display the value of the marked expression sampled at the current transport time. Probes are a main-editor feature; tutorial playgrounds may also include them where pedagogically useful. Full probe contract — modes, depth, persistence, from-list highlights — lives in [probes.md](probes.md). (See `src/editors/extensions/probes.ts`, `src/editors/extensions/probeHelpers.ts`)

1.12 The main editor **auto-focuses on initial load** — the user should land in a ready-to-type editor. After initial mount, the editor is **focus-respectful**: if the user is typing, no UI surface (modal, picker, autoload) may steal focus without an explicit user gesture. After a modal/picker dismisses, focus must return to the main editor unless the user moved it elsewhere. Secondary editors take focus only on direct user interaction (click, tab) and never auto-focus on mount.

1.13 **Secondary editor classes** in current use: (See `src/editors/extensions.ts` for per-class extension selection)
- **Code examples** (help guide, reference): typically read-only or single-line-edit; usually omit autosave, gutter, probes, gamepad nav; may include syntax highlighting and a "copy" or "send to main editor" affordance.
- **Tutorial playgrounds** (guide chapters): editable, evaluable, may include probes; do **not** persist to main-editor storage; their state is scoped to the lesson/playground instance. Each playground gets its own isolated vis store and probe registry. Evals route to WASM only (never hardware). Results are scoped to that playground's UI context.
- **Theme demo/preview** (settings, theme picker): editable but ephemeral; pinned to a specific theme regardless of the user's active theme; render representative syntax to convey the theme's look.
- **Snippet preview** (snippets tab): typically read-only; may render with the user's active theme; the snippet is inserted into the main editor on a user gesture.

1.14 **What secondary editors must never do**: write to main-editor persistence keys; mutate global settings; send eval requests to hardware; register probes against the global visualisation store; interfere with the main editor's focus or selection.
