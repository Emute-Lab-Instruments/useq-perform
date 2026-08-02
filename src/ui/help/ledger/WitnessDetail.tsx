/**
 * Witness detail view.
 *
 * Spec: `docs/specs/engine-ledger.md` §3.4 — case name, its steps (eval'd
 * code as read-only editors, sample times, expected values), actual values
 * from the last run, and its `spec:`/`guide:` cross-references.
 */

import { For, Show } from "solid-js";
import { CodeMirrorEditor } from "../CodeMirrorEditor";
import { stepOp, unsupportedReason } from "../../../lib/witness/runner.ts";
import type { Witness, WitnessResult, WitnessStep, WitnessStepResult } from "../../../lib/witness/types.ts";

export interface WitnessDetailProps {
  witness: Witness;
  result?: WitnessResult;
  onRun?: () => void;
  onOpenClause?: (specFile: string, clause: string | null) => void;
  running?: boolean;
}

function formatValues(values: readonly number[] | undefined): string {
  if (!values) return "—";
  return `[${values.map((v) => (Number.isFinite(v) ? String(v) : String(v))).join(", ")}]`;
}

function StepBody(props: { step: WitnessStep }) {
  const op = () => stepOp(props.step);
  return (
    <Show
      when={op() === "eval"}
      fallback={
        <Show
          when={op() === "sample"}
          fallback={
            <code class="ledger-step__raw">{JSON.stringify(props.step)}</code>
          }
        >
          <div class="ledger-step__sample">
            <span class="ledger-step__output">{props.step.sample!.output}</span>
            <span class="ledger-step__times">at t = [{props.step.sample!.times.join(", ")}]</span>
          </div>
        </Show>
      }
    >
      {/*
        Read-only secondary editor. `enableProbes` is deliberately omitted:
        editor.md §1.14 forbids secondary editors from registering probes
        against the global visualisation store, and the Ledger must be
        side-effect-free (engine-ledger.md §1.2).
      */}
      <CodeMirrorEditor code={props.step.eval as string} readOnly minHeight="20px" maxHeight="140px" />
    </Show>
  );
}

function StepRow(props: { step: WitnessStep; index: number; result?: WitnessStepResult }) {
  const verdict = () => props.result?.verdict ?? "unrun";
  const expected = () =>
    props.result?.expected ??
    (props.step.expect_values ? [...props.step.expect_values].map(Number) : undefined) ??
    (props.step.expect_value !== undefined ? [Number(props.step.expect_value)] : undefined);

  return (
    <li class={`ledger-step ledger-step--${verdict()}`}>
      <div class="ledger-step__head">
        <span class="ledger-step__index">{props.index + 1}</span>
        <span class="ledger-step__op">{stepOp(props.step) ?? "unknown"}</span>
        <span class={`ledger-step__verdict ledger-step__verdict--${verdict()}`}>{verdict()}</span>
        <Show when={props.step.expect_error !== undefined}>
          <span class="ledger-step__flag">expects {String(props.step.expect_error)}</span>
        </Show>
      </div>

      <StepBody step={props.step} />

      <Show when={expected() || props.result?.actual}>
        <dl class="ledger-step__values">
          <Show when={expected()}>
            <dt>expected</dt>
            <dd>{formatValues(expected())}</dd>
          </Show>
          <Show when={props.result?.actual}>
            <dt>actual</dt>
            <dd class={verdict() === "fail" ? "ledger-step__actual--fail" : undefined}>
              {formatValues(props.result?.actual)}
            </dd>
          </Show>
        </dl>
      </Show>

      <Show when={props.result?.detail}>
        <p class="ledger-step__detail">{props.result!.detail}</p>
      </Show>

      <Show when={!props.result && unsupportedReason(props.step)}>
        <p class="ledger-step__detail ledger-step__detail--muted">{unsupportedReason(props.step)}</p>
      </Show>
    </li>
  );
}

export function WitnessDetail(props: WitnessDetailProps) {
  const verdict = () => props.result?.verdict ?? "unrun";

  return (
    <section class="ledger-witness">
      <header class="ledger-witness__head">
        <h3 class="ledger-witness__name">{props.witness.name}</h3>
        <span class={`ledger-badge ledger-badge--${verdict()}`}>
          <span class="ledger-badge__label">{verdict()}</span>
        </span>
        <Show when={props.onRun}>
          <button type="button" class="ledger-button" onClick={() => props.onRun?.()} disabled={props.running}>
            Run
          </button>
        </Show>
      </header>

      <Show when={props.result?.detail}>
        <p class={`ledger-witness__detail ledger-witness__detail--${verdict()}`}>{props.result!.detail}</p>
      </Show>

      <dl class="ledger-witness__meta">
        <dt>spec</dt>
        <dd>
          <For each={props.witness.specRefs}>
            {(ref) => (
              <button
                type="button"
                class="ledger-link"
                onClick={() => props.onOpenClause?.(ref.file, ref.clause)}
              >
                {ref.file}
                {ref.clause ? ` §${ref.clause}` : ""}
              </button>
            )}
          </For>
        </dd>

        <Show when={props.witness.guide}>
          <dt>guide</dt>
          <dd>{props.witness.guide}</dd>
        </Show>

        <Show when={props.witness.tags.length > 0}>
          <dt>tags</dt>
          <dd>{props.witness.tags.join(", ")}</dd>
        </Show>

        <dt>source</dt>
        <dd><code>{props.witness.sourcePath}</code></dd>
      </dl>

      <ol class="ledger-witness__steps">
        <For each={props.witness.steps}>
          {(step, i) => <StepRow step={step} index={i()} result={props.result?.steps[i()]} />}
        </For>
      </ol>
    </section>
  );
}
