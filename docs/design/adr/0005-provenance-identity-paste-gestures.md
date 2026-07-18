# ADR-0005: Provenance-tracked identity + explicit paste gestures

Date: 2026-07-18 · Status: Accepted (v1)

## Context

Node identity across re-evals decides when DSP state survives an edit.
Explicit-names-only (TimeLines) is predictable but ceremonial.
Structure-keyed hashing of anonymous nodes (first draft) makes big
refactors re-key — surprise state resets punishing fluent editors. The
app already specifies the better mechanism for stateful expressions:
sidecar IDs mapped through CodeMirror transactions with copy/paste
fork-vs-preserve semantics (`docs/specs/state-identity.md` §7, §8,
§13.3).

## Decision

- Node identity is a state resource of kind `synth-node`; `:name` is
  sugar for `:id`.
- Anonymous nodes carry **hidden sidecar IDs that follow document
  provenance, not structure**: any edit the editor can trace (wrap,
  move, reformat, rewrite-in-place) preserves identity and DSP state.
  Structural context keys are a fallback only where provenance is
  absent (fresh text, programmatic insertion, reload recovery).
- **Paste gestures are explicit**: `Ctrl+V` **forks** (fresh ID —
  "another node like this one"); `Ctrl+Shift+V` **links** (same ID as a
  document variant — alternate versions of one node, switched by
  evaluating either; duplicate-active rules keep one live). Every paste
  containing synth forms shows visible feedback of which occurred.
- Naming a previously anonymous node **migrates** its hidden ID
  (state preserved). Changing an existing explicit `:name` is a
  deliberate identity change (free + instantiate).

## Consequences

- Zero naming ceremony *and* no surprise resets under normal editing;
  the remaining identity choices surface exactly where they arise (at
  paste), with an explicit gesture pair.
- Anonymous nodes still lack a human handle for reference/projection —
  naming remains worthwhile, and is now state-safe.
- Depends on state-identity Phase 3 machinery (sidecar IDs across
  transactions) — that spec's implementation is a prerequisite of this
  one.

## Deferred / revisit triggers

Identity-migrating rename for *explicit* names (`synth-nodes.md` §8.6).
Cross-buffer/cross-session provenance (paste into another document) is
fork-by-default; revisit if variant workflows span files.
