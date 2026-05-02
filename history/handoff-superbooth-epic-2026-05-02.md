# Handoff — Superbooth 2026 push epic

**Filed**: 2026-05-02
**Author of this handoff**: agent session that planned the push and built the bd epic
**Audience**: next agent picking up `useq-perform-gii8` (the Superbooth 2026 push epic)

---

## Read these first

1. **`bd show useq-perform-gii8 --json`** — the epic with full notes. The "High-level context (filed 2026-05-02 by handoff session)" block in the notes is the source of truth for decisions, scope, structure, and known caveats. Read it end to end.

2. **`docs/specs/MAIN.md`** — normative app-behaviour spec. §4 is the new home of the stable core (`docs/STABLE_CORE.md` was deleted; content folded into MAIN.md, runtime-modes.md, bootstrap.md). Sub-specs gamepad.md, structural-editing.md, live-edit.md, gamepad-handoff.md were significantly reworked 2026-05-01/02 — this epic implements against those rewrites.

3. **`history/factory-droid-bug-hunt-2026-05-02.md`** and **`history/factory-droid-architecture-smells-2026-05-02.md`** — adversarial audits whose findings drove Phase 0 preflight.

4. **`MAP.md`** and **`ALIGNMENT.md`** — codebase index + dated diagnosis. ALIGNMENT.md last full pass was 2026-04-29; will be refreshed in P6.3.

---

## Verify before starting any work

The epic and its children were created in one session. A few things need confirmation before treating the bd structure as load-bearing:

**Update from hygiene pass, 2026-05-02 11:27 UTC**: the cross-phase ready-set
leak was repaired. `bd ready --json` now shows Phase 0 work plus the epic,
with no Phase 1+ child ready. `bd dep cycles --json` is clean. The three
Phase 4 edges `gii8.46 -> gii8.47/.48/.50` had to be added through the Dolt
SQL server because `bd dep` timed out during cycle-check.

Also added `useq-perform-gcmx` as a Phase 0 blocker for the pre-existing
`npm run typecheck` baseline failure; do not close the Phase 0 gate until
that is resolved or the gate language is deliberately narrowed.

### A. Cross-phase dependency edges may be incomplete

A bug in the dep-creation flow caused all phase-gate edges to be created with reversed direction (`--deps blocks:X` on issue Y means "Y blocks X", not "Y blocked by X" as expected). A fix script ran 2026-05-02 reversing **within-phase** edges (children block gate). **Cross-phase** edges (gate N blocks first issue of phase N+1) were partially repaired but Dolt backend timeouts caused some adds to silently fail.

**Verify with**:
```bash
bd ready --json | jq -r '.[] | select(.id | startswith("useq-perform-gii8.")) | "\(.priority) \(.id) \(.title[:70])"'
```

**Expected**: only Phase 0 issues (gii8.1–gii8.10) plus the epic itself appear ready. Anything from Phase 1+ appearing means a cross-phase edge is missing.

**To repair**: for each missing edge from gate-N to first child of phase-N+1, run:
```bash
bd dep useq-perform-gii8.<gate-N> --blocks useq-perform-gii8.<child-N+1>
```

The full set is:
- gii8.11 → gii8.12..gii8.18 (P0 gate → all P1 children)
- gii8.19 → gii8.20..gii8.32 (P1 gate → all P2 children)
- gii8.33 → gii8.34..gii8.45 (P2 gate → all P3 children)
- gii8.46 → gii8.47..gii8.51 (P3 gate → all P4 children)
- gii8.52 → gii8.53..gii8.60 (P4 gate → all P5 children)
- gii8.61 → gii8.62..gii8.65 (P5 gate → all P6 children)

If the Dolt backend keeps timing out, retry with delays between calls. The `bd dep cycles` command should report no cycles after each batch.

### B. Some within-phase deps may point at the wrong sibling

Where I added internal-phase deps with `--deps blocks:` at create time, the IDs were guessed before all sibling IDs existed, so a few are off (e.g. P2.7 should depend on P2.6 holes node kind, not P2.3 nav migration). The most critical one (P2.7 → P2.6) was fixed manually via `bd dep`. The rest are benign — they make a child wait for an unrelated sibling that's in the same phase, slowing within-phase parallelism but not breaking correctness. The phase verification gate is the safety net.

If you want to fix systematically, read each child's spec ref, identify what it actually needs, and use `bd dep <blocker> --blocks <blocked>` (correct direction).

### C. Doc edits were pending in the original handoff

The original handoff session deleted `docs/STABLE_CORE.md` and modified ~10
other docs. The follow-up hygiene pass committed these together with the
tracker/spec fixes, so treat the committed tree as the current baseline.

### D. A few `bd update` operations may have been swallowed

Three existing beads referenced in `ALIGNMENT.md` (`sw0`, `cf4`, `oxk`) don't exist in the database — they may have been renamed or never created. P1.6 (gii8.17) tracks the work conceptually under three workstreams; the assignee will need to file three sub-issues when starting it. See P1.6's description.

---

## Where to start

If A above is clean (Phase 0 issues ready), pick from `bd ready` filtered to the epic. Recommended order:

1. **gii8.1 (P0.1)** — set the `__useqWasmRuntime` global. P0 critical, ~1 line, unblocks WASM-mode squiggles for all subsequent demos and tests.
2. The rest of Phase 0 in any order. Most are 30 minutes to 2 hours each.
3. Close gii8.11 (P0 gate) when the verification checklist passes.
4. Phase 1 unblocks. Pick gii8.12 (P1.1 vis stutter investigation) and gii8.13 (P1.2 firmware capability discovery) early — they're the longest leads in Phase 1 and gate later phases.

---

## Things the user explicitly does not want re-litigated

- **Inspector and cognitive-load refactor are out of scope** — parent epics parked at priority 4 with label `post-superbooth`. Do not pick up children of `useq-perform-126`, `useq-perform-gpt54`, `useq-perform-des`, `useq-perform-7m0`, `protocol-3vv`, `protocol-6eo`, `protocol-uj1`, `useq-perform-9fu`, `useq-perform-fm5` even if `bd ready` surfaces them. (Some children of parked parents may surface as ready because parking didn't cascade — ignore them.)
- **WebGL is the only renderer**. No canvas-2D fallback. Phase 4.5 is the explicit verification.
- **Multi-cursor UI is deferred** to a future version. The cursor-set algebra stays in Phase 2 (so we don't refactor later) but no UI gestures for building multi-cursor sets in v1.
- **MIDI is input-only, browser-side**. No MIDI output, no firmware-side MIDI.

---

## How to wrap up your own session when the time comes

Per `~/src/CLAUDE.md` "Landing the plane":
1. File issues for any new follow-ups discovered.
2. Run quality gates (`npm run lint && npm run typecheck && npm run test:all`).
3. Update bd status (close finished issues, mark in-progress for ongoing work).
4. `git pull --rebase && bd vc commit -m "session close" && git push` — work isn't done until pushed.
5. Append your own handoff note to this file (or write a fresh one) so the *next* agent has continuity.
