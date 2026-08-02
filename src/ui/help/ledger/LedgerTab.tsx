/**
 * Engine Ledger — the developer-facing canonical representation of ModuLisp
 * semantics.
 *
 * Spec: `docs/specs/engine-ledger.md`.
 *
 * Renders the language spec corpus (`src-useq/docs/specs/*.md`) as
 * interactive documents with per-clause witness badges asserted against the
 * bundled WASM engine at view time. Spec drift becomes a visible UI state.
 *
 * The whole surface is devmode-gated by `HelpPanel` (§1.3); the assets it
 * reads ship unconditionally. It is strictly read-only with respect to the
 * live session (§1.2): witness runs use a dedicated isolated engine.
 */

import { For, Show, createMemo, createResource, createSignal, batch } from "solid-js";

import { SpecDocument, clauseAnchorId } from "./SpecDocument";
import { WitnessDetail } from "./WitnessDetail";
import { ClauseBadge } from "./ClauseBadge";
import {
  cancelLedgerRun,
  clearLedgerResults,
  isLedgerRunning,
  ledgerProgress,
  ledgerResults,
  ledgerRunError,
  runLedgerWitnesses,
} from "./ledgerStore";
import { aggregateVerdict } from "../../../lib/witness/runner.ts";
import {
  loadSpecCorpus,
  loadWitnessIndex,
  witnessNamesForClause,
  witnessNamesForFile,
  type SpecCorpus,
} from "../../../lib/witness/loader.ts";
import type { ClauseVerdict, Witness, WitnessIndex } from "../../../lib/witness/types.ts";

interface LedgerAssets {
  corpus: SpecCorpus;
  index: WitnessIndex;
}

type View = { kind: "index" } | { kind: "document"; file: string; clause: string | null };

async function loadAssets(): Promise<LedgerAssets> {
  const [corpus, index] = await Promise.all([loadSpecCorpus(), loadWitnessIndex()]);
  return { corpus, index };
}

export function LedgerTab() {
  const [assets] = createResource(loadAssets);
  const [view, setView] = createSignal<View>({ kind: "index" });
  // Witness list surfaced under a document, when a clause badge is inspected.
  const [inspectedClause, setInspectedClause] = createSignal<string | null>(null);

  const index = () => assets()?.index;
  const corpus = () => assets()?.corpus;

  const witnessByName = createMemo(() => {
    const idx = index();
    return new Map((idx?.witnesses ?? []).map((w) => [w.name, w]));
  });

  const witnessesNamed = (names: readonly string[]): Witness[] => {
    const map = witnessByName();
    return names.map((n) => map.get(n)).filter((w): w is Witness => w !== undefined);
  };

  const verdictFor = (names: readonly string[]): ClauseVerdict =>
    aggregateVerdict(names.map((n) => ledgerResults[n]));

  const openClause = (file: string, clause: string | null) => {
    batch(() => {
      setInspectedClause(null);
      setView({ kind: "document", file, clause });
    });
    if (!clause) return;
    // Scroll after the document view has rendered.
    queueMicrotask(() => {
      document.getElementById(clauseAnchorId(file, clause))?.scrollIntoView({ block: "start" });
    });
  };

  // --- Index view -----------------------------------------------------------

  function LedgerIndex() {
    const rows = createMemo(() => {
      const idx = index();
      const c = corpus();
      if (!idx || !c) return [];
      return c.index.map((entry) => {
        const names = witnessNamesForFile(idx, entry.file);
        return { entry, names, verdict: verdictFor(names) };
      });
    });

    const totals = createMemo(() => {
      const idx = index();
      if (!idx) return { pass: 0, fail: 0, unsupported: 0, error: 0, unrun: 0 };
      const counts = { pass: 0, fail: 0, unsupported: 0, error: 0, unrun: 0 };
      for (const w of idx.witnesses) {
        const r = ledgerResults[w.name];
        if (!r) counts.unrun += 1;
        else counts[r.verdict] += 1;
      }
      return counts;
    });

    return (
      <div class="ledger-index">
        <header class="ledger-index__head">
          <div>
            <h2 class="ledger-index__title">Engine Ledger</h2>
            <p class="ledger-index__subtitle">
              {index()?.witnessCount ?? 0} conformance witnesses over{" "}
              {corpus()?.index.length ?? 0} spec documents, run against the bundled WASM engine.
              Results are session-scoped.
            </p>
          </div>
          <div class="ledger-index__actions">
            <button
              type="button"
              class="ledger-button ledger-button--primary"
              disabled={isLedgerRunning()}
              onClick={() => runLedgerWitnesses(index()?.witnesses ?? [])}
            >
              Run whole corpus
            </button>
            <Show when={isLedgerRunning()}>
              <button type="button" class="ledger-button" onClick={cancelLedgerRun}>
                Cancel
              </button>
            </Show>
            <button type="button" class="ledger-button" disabled={isLedgerRunning()} onClick={clearLedgerResults}>
              Clear
            </button>
          </div>
        </header>

        <Show when={isLedgerRunning()}>
          <p class="ledger-progress">
            Running {ledgerProgress().done}/{ledgerProgress().total}
            <Show when={ledgerProgress().current}> — {ledgerProgress().current}</Show>
          </p>
        </Show>

        <Show when={ledgerRunError()}>
          <p class="ledger-error">Run failed: {ledgerRunError()}</p>
        </Show>

        <ul class="ledger-summary">
          <li class="ledger-summary__item ledger-summary__item--pass">{totals().pass} pass</li>
          <li class="ledger-summary__item ledger-summary__item--fail">{totals().fail} fail</li>
          <li class="ledger-summary__item ledger-summary__item--error">{totals().error} error</li>
          <li class="ledger-summary__item ledger-summary__item--unsupported">
            {totals().unsupported} unsupported
          </li>
          <li class="ledger-summary__item ledger-summary__item--unrun">{totals().unrun} not run</li>
        </ul>

        <ul class="ledger-doclist">
          <For each={rows()}>
            {(row) => (
              <li class="ledger-doclist__row">
                <button
                  type="button"
                  class="ledger-doclist__link"
                  onClick={() => openClause(row.entry.file, null)}
                >
                  <span class="ledger-doclist__number">{row.entry.number ?? "—"}</span>
                  <span class="ledger-doclist__title">{row.entry.title}</span>
                  <span class="ledger-doclist__file">{row.entry.file}</span>
                </button>
                <p class="ledger-doclist__description">{row.entry.description}</p>
                <div class="ledger-doclist__badge">
                  <ClauseBadge
                    clause={row.entry.file}
                    count={row.names.length}
                    verdict={row.verdict}
                    disabled={isLedgerRunning()}
                    onRun={
                      row.names.length > 0
                        ? () => runLedgerWitnesses(witnessesNamed(row.names))
                        : undefined
                    }
                    onInspect={() => openClause(row.entry.file, null)}
                  />
                </div>
              </li>
            )}
          </For>
        </ul>
      </div>
    );
  }

  // --- Document view --------------------------------------------------------

  function LedgerDocument(props: { file: string; clause: string | null }) {
    const doc = () => corpus()?.documents[props.file];

    const namesForClause = (clause: string) => {
      const idx = index();
      return idx ? witnessNamesForClause(idx, props.file, clause) : [];
    };

    const docNames = createMemo(() => {
      const idx = index();
      return idx ? witnessNamesForFile(idx, props.file) : [];
    });

    const inspected = createMemo(() => {
      const clause = inspectedClause();
      return clause ? witnessesNamed(namesForClause(clause)) : [];
    });

    return (
      <div class="ledger-doc-view">
        <header class="ledger-doc-view__head">
          <button type="button" class="ledger-button" onClick={() => setView({ kind: "index" })}>
            ← Index
          </button>
          <h2 class="ledger-doc-view__title">
            {doc()?.title ?? props.file} <span class="ledger-doc-view__file">{props.file}</span>
          </h2>
          <button
            type="button"
            class="ledger-button ledger-button--primary"
            disabled={isLedgerRunning() || docNames().length === 0}
            onClick={() => runLedgerWitnesses(witnessesNamed(docNames()))}
          >
            Run all ({docNames().length})
          </button>
        </header>

        <Show when={inspectedClause()}>
          {(clause) => (
            <section class="ledger-clause-witnesses">
              <header class="ledger-clause-witnesses__head">
                <h3>§{clause()} — {inspected().length} witness(es)</h3>
                <button type="button" class="ledger-button" onClick={() => setInspectedClause(null)}>
                  Close
                </button>
              </header>
              <For each={inspected()}>
                {(w) => (
                  <WitnessDetail
                    witness={w}
                    result={ledgerResults[w.name]}
                    running={isLedgerRunning()}
                    onRun={() => runLedgerWitnesses([w])}
                    onOpenClause={openClause}
                  />
                )}
              </For>
            </section>
          )}
        </Show>

        <Show when={doc()} fallback={<p class="ledger-error">No such spec document: {props.file}</p>}>
          {(d) => (
            <SpecDocument
              doc={d()}
              witnessNamesForClause={namesForClause}
              verdictForClause={(clause) => verdictFor(namesForClause(clause))}
              onRunClause={(clause) => runLedgerWitnesses(witnessesNamed(namesForClause(clause)))}
              onInspectClause={(clause) => setInspectedClause(clause)}
              onNavigate={openClause}
              running={isLedgerRunning()}
              highlightClause={props.clause}
            />
          )}
        </Show>
      </div>
    );
  }

  // --- Shell ----------------------------------------------------------------

  return (
    <div class="ledger-tab">
      <Show
        when={assets()}
        fallback={
          <Show
            when={assets.error}
            fallback={<p class="ledger-loading">Loading the Engine Ledger…</p>}
          >
            <p class="ledger-error">
              Could not load the Ledger assets: {String(assets.error)}. Run{" "}
              <code>npm run build:assets</code>.
            </p>
          </Show>
        }
      >
        <Show when={view().kind === "index"}>
          <LedgerIndex />
        </Show>
        <Show when={view().kind === "document" ? (view() as Extract<View, { kind: "document" }>) : null}>
          {(v) => <LedgerDocument file={v().file} clause={v().clause} />}
        </Show>
      </Show>
    </div>
  );
}
