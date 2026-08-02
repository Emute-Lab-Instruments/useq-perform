/**
 * Rendered spec markdown with clause anchors and witness badges.
 *
 * Spec: `docs/specs/engine-ledger.md` §2.2–§2.4.
 *
 * The markdown is pre-tokenised at build time (`scripts/harvest-specs.mjs`),
 * so this component only has to place anchors, badges and read-only editors.
 * Prose HTML comes from our own repo's docs via the build, never from user
 * input, and its links were already rewritten to in-Ledger navigation — the
 * click handler below turns those into navigation callbacks.
 */

import { For, Show } from "solid-js";
import { CodeMirrorEditor } from "../CodeMirrorEditor";
import { ClauseBadge } from "./ClauseBadge";
import type { SpecDocument as SpecDocumentData, SpecBlock } from "../../../lib/witness/loader.ts";
import type { ClauseVerdict } from "../../../lib/witness/types.ts";

export interface SpecDocumentProps {
  doc: SpecDocumentData;
  /** Witness names citing each clause of this document. */
  witnessNamesForClause: (clause: string) => readonly string[];
  /** Aggregate badge verdict for a clause. */
  verdictForClause: (clause: string) => ClauseVerdict;
  onRunClause: (clause: string) => void;
  onInspectClause: (clause: string) => void;
  /** Follow an intra-corpus link (engine-ledger.md §2.3). */
  onNavigate: (specFile: string, clause: string | null) => void;
  running?: boolean;
  /** Clause to scroll to and highlight (§2.2). */
  highlightClause?: string | null;
}

/** Anchor id for a clause: `compilation-1.3` (engine-ledger.md §2.2). */
export function clauseAnchorId(file: string, clause: string): string {
  return `${file.replace(/\.md$/, "")}-${clause}`;
}

/**
 * Intercept clicks on the links the harvest rewrote. Unresolved links (targets
 * outside the language corpus) are inert by construction — swallow the click so
 * they cannot navigate the SPA away.
 */
function handleLinkClick(event: MouseEvent, onNavigate: SpecDocumentProps["onNavigate"]): void {
  const anchor = (event.target as HTMLElement | null)?.closest?.("a");
  if (!anchor) return;

  const spec = anchor.getAttribute("data-ledger-spec");
  if (spec) {
    event.preventDefault();
    onNavigate(spec, anchor.getAttribute("data-ledger-clause"));
    return;
  }
  if (anchor.hasAttribute("data-ledger-unresolved")) {
    event.preventDefault();
  }
}

function Block(props: {
  block: SpecBlock;
  file: string;
  parent: SpecDocumentProps;
}) {
  const clause = () => props.block.clause;

  const badge = () => {
    const c = clause();
    if (!c || !props.block.clauseOpener) return null;
    const names = props.parent.witnessNamesForClause(c);
    return { clause: c, count: names.length, verdict: props.parent.verdictForClause(c) };
  };

  return (
    <Show
      when={props.block.kind !== "code"}
      fallback={
        // Read-only secondary editor. Probes are deliberately not enabled:
        // editor.md §1.14 forbids secondary editors from registering probes,
        // and the Ledger must stay side-effect-free (engine-ledger.md §1.2).
        <div class="ledger-code" data-lang={props.block.lang || undefined}>
          <CodeMirrorEditor code={props.block.code ?? ""} readOnly minHeight="20px" maxHeight="320px" />
        </div>
      }
    >
      <Show when={props.block.kind === "rule"}>
        <hr class="ledger-rule" />
      </Show>

      <Show when={props.block.kind === "heading"}>
        {(() => {
          const depth = Math.min(Math.max(props.block.depth ?? 2, 1), 6);
          const id = clause() ? clauseAnchorId(props.file, clause()!) : props.block.id;
          const cls = `ledger-heading ledger-heading--h${depth}${
            props.parent.highlightClause && props.parent.highlightClause === clause()
              ? " ledger-heading--highlight"
              : ""
          }`;
          return (
            <div id={id} class={cls} role="heading" aria-level={depth}>
              {props.block.text}
            </div>
          );
        })()}
      </Show>

      <Show when={props.block.kind === "prose" || props.block.kind === "table"}>
        <div
          id={badge() ? clauseAnchorId(props.file, badge()!.clause) : undefined}
          class={`ledger-block ledger-block--${props.block.kind}${
            props.parent.highlightClause && props.parent.highlightClause === clause()
              ? " ledger-block--highlight"
              : ""
          }`}
        >
          <Show when={badge()}>
            {(b) => (
              <ClauseBadge
                clause={b().clause}
                count={b().count}
                verdict={b().verdict}
                disabled={props.parent.running}
                onRun={b().count > 0 ? () => props.parent.onRunClause(b().clause) : undefined}
                onInspect={b().count > 0 ? () => props.parent.onInspectClause(b().clause) : undefined}
              />
            )}
          </Show>
          {/* innerHTML is safe here: the markup is generated at build time
              from our own spec corpus by scripts/harvest-specs.mjs, never
              from user input, and its links were rewritten there. */}
          <div class="ledger-prose" innerHTML={props.block.html ?? ""} />
        </div>
      </Show>
    </Show>
  );
}

export function SpecDocument(props: SpecDocumentProps) {
  return (
    <article
      class="ledger-document"
      onClick={(event) => handleLinkClick(event, props.onNavigate)}
    >
      <For each={props.doc.blocks}>
        {(block) => <Block block={block} file={props.doc.file} parent={props} />}
      </For>
    </article>
  );
}
