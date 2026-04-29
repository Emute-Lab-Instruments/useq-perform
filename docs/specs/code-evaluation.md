# Code Evaluation

> Spec: eval lifecycle, diagnostics, output health, probes. Counterpart to [MAIN.md](MAIN.md).
> See also [editor.md](editor.md) for editor surface behaviour.

1.1 The user has **three eval strategies**, each surface-bound to a distinct keybinding and visually distinct:
- **Quantised** (default eval): submits the top-level form for execution at the next bar boundary on hardware; on WASM, runs immediately.
- **Immediate**: prepends the runtime's "execute now" semantics; fires immediately on either runtime.
- **Soft**: WASM-only preview that does not affect hardware. Used to inspect what an expression would produce without committing it.

1.2 Each eval **fans out** to the active runtime(s). On hardware, the code is sent over the JSON eval request. On WASM (always, when enabled), the code is also evaluated locally for inline result display, diagnostics, and visualisation sampling.

1.3 **An eval that produces a runtime error must not stop the music** (see [MAIN.md §2.1](MAIN.md)). The previously active output programs continue to run (subject to LKG fallback per language semantics §14 in `../../src-useq/docs/SEMANTICS.md`).

1.4 **Inline result display.** After a successful eval, a small ephemeral widget shows the truncated result text adjacent to the evaluated range. Display mode and lifetime are controlled by `evalResults.mode` (default `inline-ephemeral`) and `evalResults.autoDismissMs` (default 3000).

1.5 **Eval highlight.** A flash decoration animates over the evaluated range on every eval. Soft eval uses a visually distinct flash to signal "preview, not committed."

1.6 **Diagnostics flow.** After eval, the WASM interpreter's `useq_last_diagnostics` is read; structured diagnostics are pushed to the editor as inline annotations bound to a source range. Diagnostics persist per-range until that range is re-evaluated successfully.

1.7 **Output health.** Per-output state (`idle` / `running` / `fallback` / `error`) is polled via `useq_active_diagnostics` and surfaced in the UI. A successful eval clears prior diagnostics for the affected outputs.

1.8 **Output assignment recognition.** When the evaluated form assigns to a recognised output (`a1`..`a8`, `d1`..`d8`, `s1`..`s8`), the app marks that output as "running" so visualisation knows to sample it. Recognition is syntactic and conservative — false negatives are acceptable, false positives are not.

1.9 **Probes.** Inserting a probe on a subexpression registers a visualisation channel that batch-samples that expression at a configurable cadence (`visualisation.probeRefreshIntervalMs`, default 33ms). Removing the probe unregisters; renaming/editing the probed expression re-registers with the new text. Full probe contract — modes, depth, persistence, from-list highlights — lives in [probes.md](probes.md).

1.10 **One in-flight eval per editor.** Concurrent evals are serialised at the runtime port boundary; results are matched to requests by request ID so a slow eval cannot misattribute its output to a later eval.
