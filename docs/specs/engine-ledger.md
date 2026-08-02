---
stability: draft
layer: behavioural
---

# Engine Ledger (developer representation)

> Spec: the **developer-facing canonical representation** of ModuLisp
> semantics, compiler, and runtime — the living spec corpus rendered inside
> the app, with every normative clause backed by runnable witnesses asserted
> against the bundled WASM engine at view time. Spec drift becomes a visible
> UI state instead of an audit finding. Substrate: [witnesses.md](witnesses.md).
> User-facing counterpart: [the-machine.md](the-machine.md).
>
> Audience: developers and agents. The whole surface is devmode-gated
> ([settings.md](settings.md)); it must add no cognitive weight for users.

### Source files

- `src/ui/help/ledger/LedgerTab.tsx` — devmode Help tab: spec index + document view
- `src/ui/help/ledger/SpecDocument.tsx` — rendered spec markdown with clause anchors and witness badges
- `src/ui/help/ledger/ClauseBadge.tsx` — per-clause witness status chip
- `src/ui/help/ledger/WitnessDetail.tsx` — expandable steps / expected-vs-actual view
- `src/ui/help/ledger/ledgerStore.ts` — session-scoped run state (§3.3); never persisted
- `src/ui/styles/ledger.css` — Ledger styling, including the §3.1 verdict colours
- `src/lib/witness/` — shared runner + types ([witnesses.md](witnesses.md))
- `scripts/harvest-specs.mjs` — build-time copy of `src-useq/docs/specs/*.md` into a bundled asset
- `public/assets/spec-corpus.json` — (generated) the bundled spec corpus

## 1. Frame

1.1 The Engine Ledger renders the language/firmware spec corpus
(`src-useq/docs/specs/*.md`) as first-class interactive documents inside the
Help panel. For developers, "canonical" means **normative and checked**: where
the spec and the engine disagree, the spec wins and the implementation is the
bug — the Ledger's job is to make any such disagreement impossible to miss.

1.2 The Ledger is strictly read-only with respect to the live session.
Witness runs are isolated (witnesses.md §2.3). Browsing or running the entire
Ledger during a performance must be side-effect-free.

1.3 The Ledger tab appears in the Help panel **only when devmode is on**. The
witness index and spec assets ship in the bundle regardless (they are small);
gating is a UI concern, not a build split.

## 2. Spec rendering

2.1 The Ledger lists all spec files under `src-useq/docs/specs/` (harvested
at build time — the app never fetches the submodule at runtime). MAIN.md is
the entry document; the per-file list mirrors its sub-spec index.

2.2 Clause paragraphs (the `N.N` convention used throughout the corpus) are
addressable anchors: `#compilation-1.3` scrolls to and highlights
compilation.md §1.3. External deep links (`?spec=compilation.md&clause=1.3`
style, exact param design left to implementation) open Help → Ledger → that
clause.

2.2.1 M1 implements the in-Ledger half: clause anchors, scroll-and-highlight,
and navigation from intra-corpus links (§2.3). The **external URL deep link
is not implemented** — a new query parameter has to be registered in
[url-params.md](url-params.md) first, and that was outside the M1 change
scope. Also note that numbered section headings (`## 3. Sugars`) are
addressable in their own right, so a whole-section citation like
`failure-model.md §7` badges correctly.

2.3 Markdown rendering must preserve: intra-corpus links (rewritten to
in-Ledger navigation), code fences with ModuLisp highlighting (read-only
secondary editors per [editor.md](editor.md) §1.14 — no probe registration),
and tables.

2.3.1 Markdown is tokenised **at build time** by `scripts/harvest-specs.mjs`
into a block model (`heading` / `prose` / `code` / `table` / `rule`, each
tagged with the clause it belongs to), so the app needs no runtime markdown
parser and clause tagging cannot drift between renders. Links are rewritten
during the harvest: intra-corpus targets become `data-ledger-spec` /
`data-ledger-clause` attributes the document view turns into navigation;
targets outside the language corpus (e.g. `../../../docs/specs/synthesis.md`)
are defused so they cannot navigate the SPA away.

2.4 Each clause that has witnesses (per the harvest aggregation,
witnesses.md §3.3) shows a **clause badge**: witness count plus aggregate
verdict. Clauses without witnesses show an unobtrusive "no witnesses" mark —
visible coverage gaps are part of the point.

## 3. Verification

3.1 Badge verdicts follow witness verdicts (witnesses.md §2.2): green (all
pass), red (any fail), grey (all unsupported/unrun), amber (runner error).
A red badge means the shipped engine and the spec disagree — the Ledger
renders this prominently, with the failing expected-vs-actual values.

3.2 Witnesses run **on demand**: per-clause "run" affordance, per-document
"run all", and a whole-corpus run from the Ledger index. No automatic
background running on app start; a document view may auto-run its own
witnesses when opened if the engine is idle (implementation choice, but must
be interruptible and must not contend with live evaluation).

3.2.1 M1 takes the conservative option: nothing auto-runs, including on
opening a document. Every run is user-initiated and cancellable. Because the
runner drives its own isolated engine (witnesses.md §2.3.1) it never contends
with live evaluation for engine state, only for the main thread.

3.3 Run results are session-scoped state (not persisted). The Ledger index
shows a per-spec-file summary of the latest session results.

3.4 Witness detail view shows: the case name, its steps (eval'd code as
read-only editors, sample times, expected values), actual values from the
last run, and its `spec:`/`guide:` cross-references.

## 4. Diagnostics deep-linking

4.1 Diagnostics surfaced in the main editor may carry a spec-clause
reference. With devmode on, the rendered diagnostic offers a link that opens
the Ledger at that clause. (User-facing guide links are the Machine's
concern — [the-machine.md](the-machine.md) §5.)

4.2 M1 wires the affordance for diagnostics that already carry a mappable
category; enriching the WASM diagnostic payload with explicit clause refs is
deferred (§6.2).

4.3 **Not implemented.** The Ledger landed without §4: no diagnostic in the
main editor yet offers a Ledger link. It needs a category → clause map plus
the external deep-link entry point that §2.2.1 also blocks on.

## 5. Acceptance (M1)

5.1 Devmode on → Help shows the Ledger tab; devmode off → no trace of it.

5.2 All 13 spec-area corpus files harvest cleanly; every witness with
`eval`/`sample` steps runs in-app; the aggregate whole-corpus run matches the
native runner's verdicts on the same pinned submodule (spot-checked in tests
against a fixture subset).

5.2.1 As of 2026-08-02, 13 files / 85 witnesses harvest cleanly with no
validation warnings, and every clause the corpus cites resolves to a clause
the spec corpus actually defines (asserted in `harvest.test.ts`). A
whole-corpus run against the bundled engine gives **55 pass, 0 fail, 30
unsupported, 0 error** — the 30 being the step kinds inventoried in
witnesses.md §5.1. Zero failures means the shipped engine agrees with the
spec everywhere the in-app runner can check, matching the native runner.
`src/lib/witness/realEngine.test.ts` asserts this against the real WASM
artefact.

5.3 Running the full corpus from the Ledger leaves the live session
observably untouched (outputs, cells, transport, probes).

5.4 `npm run typecheck`, `npm run lint` (import boundaries — `src/lib/witness`
must not import upward), `npm run test:unit` green.

## 6. Open / Deferred

6.1 **Glass-compiler introspection (M2).** A dev-gated `useq_explain` WASM
export exposing the real pass pipeline (tokens → resolution → folds →
time-context → lowering → CSE → slots → topo order) per
`src-useq/docs/specs/compilation.md` §1.2, rendered as per-clause explain
traces and a node-DAG view with live per-node values. Requires C++ work in
the submodule; explicitly out of M1.

6.2 Clause references carried inside the diagnostics ABI payload.

6.3 Editable witness playgrounds (tweak-and-rerun) in the detail view.

6.4 Ledger rendering of the app-side spec corpus (`docs/specs/*.md`) in
addition to the language corpus.

6.5 External deep links into a clause (§2.2.1) — blocked on registering the
query parameter in [url-params.md](url-params.md).

6.6 Cheaper whole-corpus runs. Each witness currently costs a full WASM
module instantiation (witnesses.md §2.3.1). It is fast enough today
(sub-second for the whole corpus) but scales linearly with corpus size; a
`useq_clear` export would remove it.
