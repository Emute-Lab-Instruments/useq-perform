# ADR-0004: Upsert-per-eval + document-sync lifecycle

Date: 2026-07-18 · Status: Accepted (v1)

## Context

The original draft specified SC-style "the evaluated program is the
whole truth" — incompatible with uSEQ's per-form eval surface
(evaluating one form would free every other node; deleting text is not
an eval, so nodes could otherwise never be freed). Live-coding practice
also wants the screen to be tidy-able without musical consequences.

## Decision

- Per-form eval **upserts** exactly the identities it declares — it
  never frees. Deleting/commenting code is visually silent.
- Freeing is deliberate: a **document-sync eval** action
  (`eval.document`, whole-truth semantics — absentees are freed, with
  announced blast radius), explicit `(free ...)`, per-node UI free, or
  `(useq-clear)`.
- Diff cases per identity: instantiate (fade-in), update-in-place (same
  def; param graphs swap without DSP reset), def-change
  (free+instantiate, overlapping fades), free (release fade). Racing
  fades resolve by resurrection on the same DSP instance.
- **Ghosts** (sounding, not in document) are first-class UI: gutter/
  ghost-surface entries with a hover card offering **stop** (abrupt),
  **fade out** (default release duration), and **restore code**
  (reinsert the identity's last-known-active source). The app retains
  last-active source per identity to power restore.
- Failed evals are no-ops (LKG parity); compile errors never silence
  running nodes.

## Consequences

- Screen-as-scratchpad, sound-as-rack: performers can tidy, prepare,
  and A/B without audible side effects; doc-sync becomes a deliberate
  "commit" performance gesture.
- What-you-see ≠ what-you-hear is a real gap; the ghost surface is
  load-bearing UI, not decoration.
- The eval contract of the rest of the app (text edits are inert until
  evaluated) is preserved exactly.

## Deferred / revisit triggers

If practice shows ghosts accumulating despite the affordances, consider
auto-sync-on-idle as an opt-in setting. Mute/solo as first-class node
operations are open.
