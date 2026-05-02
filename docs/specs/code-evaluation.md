# Code Evaluation

> Spec: eval lifecycle, diagnostics, output health, probes. Counterpart to [MAIN.md](MAIN.md).
> See also [editor.md](editor.md) for editor surface behaviour.

1.1 The user has **three eval strategies**, each surface-bound to a distinct keybinding and visually distinct:
- **Immediate** (default eval): submits the top-level form for execution as soon as the runtime receives it. Fires immediately on either runtime. On the wire this is an eval request with no `quant` flag (see [`wire-protocol.md` §5.7](../../src-useq/docs/specs/wire-protocol.md)).
- **Quantised**: submits the top-level form with the wire-level `quant: true` flag. The runtime (hardware or WASM) queues the form and drains the queue on the next wrap of the **global quant phasor** — a single runtime-side phasor that defaults to `bar` and is changed via the ModuLisp builtin `(set-quant-phasor expr)` (e.g. `(set-quant-phasor (slow 2 bar))`). Quantisation timing is therefore identical on hardware and WASM by construction — both runtimes evaluate the same phasor against the same time source. There is no per-expression override at the editor surface in v1; if the user wants different musical periods for different forms they change the global phasor.
- **Soft**: WASM-only local preview that does not send to hardware. Updates all local visual surfaces (inline results, vis panel, probes, from-list highlights, output health) — everything except hardware send. Used to inspect what an expression would produce without committing it to hardware.

Forms whose subtree contains any `hole` leaf (per [structural-editing.md §2.9](structural-editing.md)) are **rejected at submission** with an inline diagnostic at each unfilled hole position ("fill this hole first"). The gate is **per top-level form**, not per-document — sibling forms without holes evaluate normally on the same submission. This applies to all three strategies (quantised, immediate, soft).

1.2 Each eval **fans out** to the active runtime(s). By default, all code the user explicitly sends is evaluated on both hardware and WASM (when both are active). WASM may additionally receive implicit code at the editor's discretion (e.g. probe sampling, from-list highlight evaluation). Hardware may receive code that WASM does not (e.g. hardware-specific diagnostics). In `both` mode, hardware is authoritative for output health; WASM diagnostics are shown but do not override hardware state.

1.3 **An eval that produces a runtime error must not stop the music** (see [MAIN.md §2.1](MAIN.md)). The previously active output programs continue to run (subject to LKG fallback per language semantics §14 in `../../src-useq/docs/SEMANTICS.md`).

1.4 **Inline result display.** After a successful eval, a small ephemeral widget shows the truncated result text adjacent to the evaluated range. Display mode and lifetime are controlled by `evalResults.mode` (default `inline-ephemeral`) and `evalResults.autoDismissMs` (default 3000).

1.5 **Eval highlight.** A flash decoration animates over the evaluated range on every eval. Soft eval uses a visually distinct flash to signal "preview, not committed."

1.6 **Diagnostics flow.** After eval, the WASM interpreter's `useq_last_diagnostics` is read; structured diagnostics are pushed to the editor as inline annotations bound to a source range. Diagnostics are position-mapped: they move with the text as the user edits (via CodeMirror position mapping). They persist until the range is re-evaluated successfully — editing the text within a diagnostic range does NOT clear the diagnostic.

1.7 **Output health.** Per-output state (`idle` / `running` / `fallback` / `error`) is polled via `useq_active_diagnostics` and surfaced in the UI. A successful eval clears prior diagnostics for the affected outputs.

1.8 **Output assignment recognition.** When the evaluated form assigns to a recognised output (pattern `/\b([ads])([1-8])(?=[\s)(]|$)/g`), the app marks that output as "running" so visualisation knows to sample it. The pattern is fixed and broad (a1–a8, d1–d8, s1–s8) — it covers the full theoretical range including future expanders. If a recognised output is not in the connected hardware's reported I/O config, the app still tracks it for WASM visualisation but flags a warning. Recognition is syntactic and conservative — false negatives are acceptable, false positives are not.

1.9 **Probes.** Inserting a probe on a subexpression registers a visualisation channel that batch-samples that expression at a configurable cadence (`visualisation.probeRefreshIntervalMs`, default 33ms). Removing the probe unregisters; renaming/editing the probed expression re-registers with the new text. Full probe contract — modes, depth, persistence, from-list highlights — lives in [probes.md](probes.md).

1.10 **One in-flight eval per editor.** Concurrent evals are serialised at the runtime port boundary; results are matched to requests by request ID so a slow eval cannot misattribute its output to a later eval.

1.11 **Quantised eval queuing.** Multiple quantised evals submitted before a quant-phasor wrap are queued in the runtime in submission order. All queued evals execute on the wrap in order; the final eval's result is the one the user sees for a given output. There is no "latest wins" coalescing — every queued eval runs. Queue ownership lives on the runtime side ([`wire-protocol.md` §5.7](../../src-useq/docs/specs/wire-protocol.md), [`firmware.md` §6](../../src-useq/docs/specs/firmware.md)); the editor sends the request and waits for the response like any other eval.
