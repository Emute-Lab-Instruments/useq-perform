---
stability: stable
layer: cross-cutting
---

# Input Dispatch

> Spec: the command router as the single chokepoint for all user intents. Counterpart to [MAIN.md](MAIN.md).
> See also [keybindings.md](keybindings.md) (binding resolution), [editor.md](editor.md) (editor instances), [gamepad.md](gamepad.md) (gamepad pipeline), [structural-editing.md](structural-editing.md) (structural operations).
>
> This spec defines the architectural invariant that all editor-directed user intents — regardless of input source — converge through a single typed command router that owns policy enforcement. The binding specs define *what* maps to *what*; this spec defines *how intents reach the editor*.

### Source files

- `src/editors/commands/editorCommandRouter.ts` — the command router: `executeEditorCommand()`, policy enforcement, bracket protection
- `src/editors/keymaps.ts` — CodeMirror keymap layer (keyboard translator)
- `src/editors/editorKeyboard.ts` — editor keyboard utilities
- `src/editors/commands/actionHandlers.ts` — source-aware `ActionId` translator and UI-effect mapping; `executeAction()` removes caller-specific handler-shape inference
- `src/lib/keybindings/resolver.ts` — binding resolver (key to ActionId)
- `src/lib/keybindings/actions.ts` — canonical action registry
- `src/lib/gamepad/dispatcher.ts` — gamepad dispatcher (reaches router via handler registry)
- `src/ui/keybindings/ActionPalette.tsx` — action palette (reaches router via handler registry)
- `src/lib/menu/editorTarget.ts` — radial-menu tree commits through the router
- `src/editors/extensions/liveEdit/markAction.ts` — live-edit widget commits through the router

---

## 1. Frame

1.1 The app has multiple input sources that produce editor intents: keyboard, gamepad, action palette, picker menus, radial menus, test harnesses, and (future) modal-editing modes. Each source resolves user input into an intent through its own logic. The **command router** is the sole point where resolved intents become editor state transitions.

1.2 The command router enforces **policy invariants** — constraints that hold regardless of which input source produced the intent. Examples: bracket protection, structural-mode gating, eval-blocking on holes. These policies live in the router, not in individual input sources. An input source that bypasses the router bypasses the policies.

1.3 The corollary: if a policy is enforced only in one input source's code path, it is not enforced — it is a suggestion that other paths ignore. This is a spec violation, not a design tradeoff.

---

## 2. Architecture

2.1 The dispatch pipeline has three layers:

```
Input Source → Translator → Command Router → CodeMirror
```

**Input source**: raw events from a device or UI surface. Key events, gamepad gestures, menu selections, palette picks, test harness steps.

**Translator**: per-source logic that resolves raw events into typed `EditorCommand` objects. For the keyboard, this is the binding resolver + keymap layer. For the gamepad, this is the three-stage pipeline in [gamepad.md](gamepad.md). For tests, this is the harness's action-to-command mapping. Translators have no policy logic — they map input to intent, nothing else.

**Command router** (`editorCommandRouter.ts`): receives `EditorCommand` objects and produces CodeMirror transactions. Owns all policy enforcement. Returns `true` (handled) or `false` (declined — no valid command for this input). (see `src/editors/commands/editorCommandRouter.ts`)

2.2 The `EditorCommand` union type is the **contract** between translators and the router. Its `source` is mandatory (`keyboard`, `gamepad`, `menu`, `palette`, `widget`, `test`, or `system`), so a translator cannot silently lose provenance. Every editor mutation or evaluation the app supports must be expressible as an `EditorCommand` variant. Adding one means adding a variant to the union — not adding a transaction in a translator.

2.3 **What belongs in the router** (policy enforcement):
- Bracket protection (blocking deletion of closing delimiters when enabled)
- Auto-pair insertion and deletion (matching bracket pairs)
- Structural operation dispatch
- Mode-dependent gating (future: vim-like normal/insert mode filtering)
- Number adjustment
- Manual control binding management
- Editor focus restoration for indirect user surfaces

2.4 **What does NOT belong in the router**:
- Binding resolution (which key maps to which action) — lives in the resolver ([keybindings.md](keybindings.md))
- Gesture recognition (which button sequence is a tap vs hold) — lives in the gamepad pipeline ([gamepad.md](gamepad.md))
- Extension ordering, theme application, gutter rendering — lives in the editor extension stack ([editor.md](editor.md))

---

## 3. Keyboard Translator

3.1 The keyboard translator is the keymap layer in `keymaps.ts`. Its sole job is intercepting key events that have bindings and routing them to the command router as `EditorCommand` objects. It must not contain policy logic (bracket checking, mode gating, structural awareness). (see `src/editors/keymaps.ts`)

3.2 **Keys with action bindings** (registered in the action registry): the binding resolver maps the key to an `ActionId`; `executeAction()` translates the action with source `keyboard`; editor-directed handlers call `executeEditorCommand()`. The keymap layer provides the CodeMirror `keymap.of()` entries that trigger this chain. Gamepad and palette dispatch use the same `executeAction()` entry with their own source instead of inspecting handler arity. (see `src/lib/keybindings/resolver.ts`, `src/editors/commands/actionHandlers.ts`)

3.3 **Keys with implicit editor semantics** (Backspace, Delete, Enter, closing brackets): these are not bound to named actions in the default state but carry policy-sensitive behaviour. The keymap layer must route them through the command router as `{kind: "key", key: "Backspace"}` etc., rather than delegating to third-party keymap handlers directly.

3.4 **Regular typing** (printable characters without modifier bindings): falls through to CodeMirror's default input handling. The command router is not involved — there is no policy to enforce on a plain character insertion. The `closeBrackets` extension from clojure-mode handles auto-pairing at the CodeMirror extension level; this is extension behaviour, not policy.

3.5 **Third-party keymap passthrough**: clojure-mode provides bracket-aware editing (auto-pair, indentation, close-bracket skip-over). These are CodeMirror extensions that operate on the input event stream. They handle **input composition** (what text to insert when the user types `(`), not **policy** (whether to allow deletion of `)`). The boundary: if the behaviour is "shape what gets inserted," it is input composition and belongs in extensions. If the behaviour is "block or transform an edit to preserve an invariant," it is policy and belongs in the router.

3.6 The keymap layer must not include `deleteCharBackward` or `deleteCharForward` as direct keymap entries at any precedence. These are the router's fallback — if the router decides a deletion is safe, it calls them. Having them in the keymap creates a parallel code path that bypasses the router's policy checks.

---

## 4. Policy Enforcement

4.1 **Bracket protection** (`editor.preventBracketUnbalancing`, default true). When enabled: (see `src/editors/commands/editorCommandRouter.ts` — `pressEditorKey()`)
- Backspace before a closing delimiter (`)`/`]`/`}`) with an empty selection: blocked (no-op, returns true).
- Delete on a closing delimiter: blocked.
- Backspace/Delete between a matched auto-inserted pair (cursor between `()`): both delimiters removed.
- All other deletions: permitted, delegated to `deleteCharBackward`/`deleteCharForward`.

This policy is enforced in the command router's `pressEditorKey()` path, which all input sources traverse. It is not enforced by relying on a third-party extension's keymap handler.

4.2 **Close-bracket skip-over**. When the user types a closing bracket and the next character is that same closer, the cursor advances past it instead of inserting a duplicate. This is enforced in the router's `handleBracketKey()`. (see `src/editors/commands/editorCommandRouter.ts`)

4.3 **Open-bracket auto-pair**. When the user types an opening bracket, the matching closer is inserted and the cursor placed between them. If text is selected, the selection is wrapped. Enforced in `handleBracketKey()`.

4.4 **Future: modal mode gating**. When a vim-like modal system is introduced, mode determines which commands are valid. A key that means "delete line" in normal mode and "type the letter d" in insert mode produces different `EditorCommand` variants from the translator — the router does not need to know about modes. But mode-dependent *policies* (e.g. "in visual mode, all navigation extends selection") belong in the router.

---

## 5. Input Source Inventory

Current input sources and their translator paths:

| Source | Translator | Reaches router via |
|---|---|---|
| Keyboard (bound actions) | Binding resolver → handler registry | `actionHandlers.ts` calls `executeEditorCommand()` |
| Keyboard (policy keys) | Keymap layer | Must call `executeEditorCommand()` directly |
| Gamepad | Three-stage pipeline → dispatcher | Same handler registry as keyboard |
| Action palette | Palette selection → handler registry | `executeEditorCommand()` via handler |
| Radial menu | Menu selection → dispatcher | `executeEditorCommand()` |
| Live-edit widget | Widget interaction → mutation planner | `executeEditorCommand()` |
| Test harness (YAML) | `testHarness.mjs` action mapping | `executeEditorCommand()` |
| Test harness (Vitest) | Direct call | `executeEditorCommand()` |

5.1 Every row in this table must reach the same `executeEditorCommand()` entry point for app-authored document mutations, evaluation, or structural movement. CodeMirror-native text composition (§3.4) and effect-only extension state (decorations and mode indicators) are the explicit boundaries. If an input source creates an app-authored document transaction through another path, that is a bug.

5.2 Successful commands from `gamepad`, `menu`, `palette`, and `widget` restore focus to the editor. `keyboard`, `test`, and `system` commands do not steal focus. This policy belongs to the router and must not be reimplemented by input surfaces.

---

## 6. Testing Invariant

6.1 Because all input sources converge through the command router, a test that calls `executeEditorCommand()` with a given `EditorCommand` is testing the same code path that a real user triggers. There is no "harness path vs real path" divergence.

6.2 Tests should construct `EditorCommand` objects and call `executeEditorCommand()`. Tests should NOT: simulate DOM key events, call `deleteCharBackward` directly, or invoke CodeMirror keymap handlers — these bypass the router and test implementation details rather than user-facing behaviour.

6.3 The YAML structural test harness maps policy keys, text commands, and structural action names to `EditorCommand` objects and dispatches them through `executeEditorCommand()`. Pure menu-verb planning remains directly testable, but committing its result to CodeMirror uses the router in production.

---

## 7. Conformance Boundary

7.1 Keyboard policy keys are installed at `Prec.highest` and route through `{kind: "key"}`. The third-party passthrough excludes Backspace, Delete, Enter, brackets, and quote.

7.2 Structural names accepted by `EditorCommand` come from the adapter's `STRUCTURAL_ACTIONS` catalog. Callers cannot introduce an unchecked structural spelling through the typed router.

7.3 Evaluation is `{kind: "evaluate"}`. Keyboard, gamepad channel, and palette execution therefore share the same entry point even though evaluation's asynchronous runtime work remains owned by `editorEvaluation.ts`.

7.4 Radial-menu and live-edit modules retain their pure/domain mutation planners. They hand only the resulting source change to the router; reducer and widget state effects are not document intents.

---

## 8. Open / Deferred

8.1 **Modal editing system.** When introduced, the translator layer gains a mode-aware stage: the same physical key produces different `EditorCommand` variants depending on the active mode. The router and policy layer remain unchanged. Design deferred until the modal system is specced.

8.2 **Kill-to-end-of-list.** Currently delegates to clojure-mode's `Ctrl-k` handler directly (`actionHandlers.ts`). Should be reimplemented as a router-native operation so it participates in policy enforcement (e.g. respecting bracket protection).

8.3 **Multi-cursor dispatch.** The router currently operates on the primary selection only. Structural operations on multiple cursors may require the router to iterate over selections. Deferred until multi-cursor structural editing is specced ([structural-editing.md](structural-editing.md) §5).
