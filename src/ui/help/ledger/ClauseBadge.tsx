/**
 * Per-clause witness status chip.
 *
 * Spec: `docs/specs/engine-ledger.md` §2.4, §3.1.
 *
 * Colour follows the aggregate witness verdict: green (all pass), red (any
 * fail), grey (all unsupported/unrun), amber (runner error). A clause with no
 * witnesses gets an unobtrusive "no witnesses" mark — visible coverage gaps
 * are part of the point (§2.4).
 */

import { Show } from "solid-js";
import type { ClauseVerdict } from "../../../lib/witness/types.ts";

export interface ClauseBadgeProps {
  /** Clause this badge belongs to, e.g. `3.1`. */
  clause: string;
  /** Number of witnesses citing the clause. */
  count: number;
  verdict: ClauseVerdict;
  /** Run the clause's witnesses. Absent when there is nothing to run. */
  onRun?: () => void;
  /** Open the clause's witness list. */
  onInspect?: () => void;
  disabled?: boolean;
}

const LABEL: Record<ClauseVerdict, string> = {
  pass: "pass",
  fail: "FAIL",
  error: "error",
  unsupported: "unsupported",
  unrun: "not run",
  none: "no witnesses",
};

const TITLE: Record<ClauseVerdict, string> = {
  pass: "Every witness for this clause passed against the bundled engine.",
  fail: "The bundled engine and this clause disagree — the spec wins and the implementation is the bug.",
  error: "A witness could not be run: the runner or engine faulted.",
  unsupported: "This clause's witnesses use step kinds the in-app runner cannot execute yet.",
  unrun: "This clause has witnesses that have not been run this session.",
  none: "No conformance witness cites this clause — a coverage gap.",
};

export function ClauseBadge(props: ClauseBadgeProps) {
  return (
    <span class={`ledger-badge ledger-badge--${props.verdict}`} title={TITLE[props.verdict]}>
      <Show
        when={props.verdict !== "none"}
        fallback={<span class="ledger-badge__label">no witnesses</span>}
      >
        <button
          type="button"
          class="ledger-badge__label"
          onClick={() => props.onInspect?.()}
          disabled={props.disabled}
        >
          {props.count} {props.count === 1 ? "witness" : "witnesses"} · {LABEL[props.verdict]}
        </button>
        <Show when={props.onRun}>
          <button
            type="button"
            class="ledger-badge__run"
            title={`Run the ${props.count} witness(es) for §${props.clause}`}
            aria-label={`Run witnesses for clause ${props.clause}`}
            onClick={() => props.onRun?.()}
            disabled={props.disabled}
          >
            ▶
          </button>
        </Show>
      </Show>
    </span>
  );
}
