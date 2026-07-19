/**
 * Tree-aware stateful-form classifier.
 *
 * Spec: docs/specs/state-identity.md (§2 concepts, §6 source surface, §7
 * editor metadata). The classifier walks the Lezer parse tree at parse
 * time and emits a {@link RecognisedForm} for every stateful top-level form.
 *
 * "Stateful" means the form, when evaluated, retains runtime state that
 * must survive logical edits. Today the only recognised form is anonymous
 * `(synth "def" …)` (a synthesis engine declaration). Future modules add
 * more by composing classifiers via {@link combineClassifiers} — without
 * the sidecar importing synthesis runtime singletons (the classifier only
 * needs the head symbol name, not the engine).
 *
 * Important: recognition is purely syntactic and structural. We never
 * match against source text outside the head symbol (no regex over the
 * whole buffer, no string-contains heuristic). This means:
 *   - Synth-like text inside strings, comments, or non-top-level positions
 *     is never recognised.
 *   - Temporarily malformed `(synth` mid-typing is not recognised (no
 *     form to attach an ID to).
 *   - Nested `(synth` is recognised only if the spec allows it at that
 *     position; otherwise the classifier returns null.
 */

import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

import type { FormKey, RecognisedForm, StatefulFormKind } from "./identityTypes.ts";

// ─── Classifier interface ──────────────────────────────────────────────────

/**
 * A function that inspects a candidate list-form (head symbol already
 * extracted) and decides whether the form is stateful.
 *
 * - Returns the {@link StatefulFormKind} if stateful.
 * - Returns `null` otherwise.
 *
 * Implementations must be pure functions of `(headText, listNode, state)`.
 * They must not reach into runtime singletons, must not call
 * `state.doc.sliceString` outside the supplied node, and must not have
 * observable side effects.
 */
export type StatefulFormClassifier = (
  headText: string,
  listNode: SyntaxNode,
  state: EditorState,
) => StatefulFormKind | null;

/**
 * Built-in default classifier: recognises `(synth "def" …)` at top level.
 *
 * `(synth "osc/sine" :freq expr)` is the M1 minimum form (synth-nodes.md,
 * synthesis.md). It is a top-level form because the compiler lowers tokens
 * directly; we honour that by only recognising synth under the document
 * root (Program), not nested inside another form. State-identity.md §1.4
 * requires the editor to attach stable IDs to all anonymous stateful
 * forms, including synth.
 *
 * The classifier does NOT validate parameter syntax — that is the
 * compiler's job. Recognition requires:
 *   - head symbol is `synth`;
 *   - the form is at the top level (parent is Program);
 *   - the form has at least one argument after the head (the def name).
 *
 * The arity check is purely structural so that a temporarily-malformed
 * `(synth` mid-typing is not recognised until it grows into a real form
 * (VAL-ID-022: temporarily malformed editing syntax never receives
 * text-matched identity injection).
 */
export const classifySynthTopLevel: StatefulFormClassifier = (
  headText,
  listNode,
  state,
) => {
  if (headText !== "synth") return null;
  // Top-level only: parent must be Program (the document root).
  const parent = listNode.parent;
  if (parent === null || parent.type.name !== "Program") return null;
  // Require at least one argument after the head (the def-name string).
  // Skip "(", ")", the head symbol, and Lezer error markers (⚠). A
  // temporarily-malformed `(synth` mid-typing has only an error node
  // after the head — that does not count as a real argument, so the
  // form is not recognised until it grows into a real form.
  let sawHead = false;
  let hasArg = false;
  for (let c = listNode.firstChild; c; c = c.nextSibling) {
    const name = c.type.name;
    if (name === "(" || name === ")") continue;
    if (name === "⚠" || name === "ERROR" || name === "Error") continue;
    if (!sawHead) {
      sawHead = true;
      continue;
    }
    hasArg = true;
    break;
  }
  if (!hasArg) return null;
  // Suppress unused-parameter lint while keeping the signature stable.
  void state;
  return "synth";
};

/**
 * Future placeholder for `defstate` / `define-state`. The runtime spec
 * (`src-useq/docs/specs/state.md`) defines these as named-state forms whose
 * identity is the symbol; the sidecar does not need to assign anonymous IDs
 * because the user-provided symbol *is* the durable identity. Recognising
 * the form here only records it for the payload builder to pass through.
 *
 * Kept disabled until the runtime contract lands — returns null.
 */
export const classifyDefineState: StatefulFormClassifier = () => null;

/**
 * Combine multiple classifiers in priority order. The first non-null result
 * wins. Later classifiers only run if earlier ones declined.
 */
export function combineClassifiers(
  classifiers: ReadonlyArray<StatefulFormClassifier>,
): StatefulFormClassifier {
  return (headText, listNode, state) => {
    for (const c of classifiers) {
      const kind = c(headText, listNode, state);
      if (kind !== null) return kind;
    }
    return null;
  };
}

/** Default classifier used by {@link createDefaultIdentityConfig}. */
export const defaultStatefulFormClassifier: StatefulFormClassifier =
  combineClassifiers([classifySynthTopLevel, classifyDefineState]);

// ─── Tree walk ─────────────────────────────────────────────────────────────

/**
 * Walk the top-level children of the parse tree, classify each top-level
 * list-form, and emit a {@link RecognisedForm} for every stateful one.
 *
 * The FormKey for a top-level form is `[childIndex]` — a one-element array
 * giving its 0-based position among the document's children. Nested forms
 * do not currently have FormKeys because we recognise only top-level forms;
 * if/when that changes, FormKey extends to deeper paths naturally.
 *
 * Tree-aware: a `synth` head that appears inside a string, comment, or as
 * a non-head symbol is never seen by the classifier, because we only
 * inspect the first logical child of each top-level List.
 */
export function recogniseStatefulForms(
  state: EditorState,
  classifier: StatefulFormClassifier = defaultStatefulFormClassifier,
): ReadonlyArray<RecognisedForm> {
  const out: RecognisedForm[] = [];
  const root = syntaxTree(state).topNode;
  let childIndex = 0;
  for (let topChild = root.firstChild; topChild; topChild = topChild.nextSibling) {
    if (topChild.type.name !== "List") {
      // Skip non-list top-level forms (line comments, atoms, etc.) but still
      // advance the index so that a stateful form's structural path stays
      // stable even when comments are added or removed above it.
      //
      // NOTE: comments and whitespace are typically filtered by the Lezer
      // grammar's @skip; only addressable top-level forms advance the index.
      childIndex++;
      continue;
    }
    const headNode = firstLogicalChild(topChild);
    if (headNode !== null) {
      const headText = state.doc.sliceString(headNode.from, headNode.to);
      const kind = classifier(headText, topChild, state);
      if (kind !== null) {
        out.push({
          formKey: [childIndex],
          kind,
          range: { from: topChild.from, to: topChild.to },
        });
      }
    }
    childIndex++;
  }
  return out;
}

/** First non-punctuation, non-error child of a List node (the head symbol). */
function firstLogicalChild(listNode: SyntaxNode): SyntaxNode | null {
  for (let c = listNode.firstChild; c; c = c.nextSibling) {
    const name = c.type.name;
    // The clojure grammar emits `(` and `)` as named punctuation tokens.
    // Skip those, plus whitespace/comments (which are in @skip anyway),
    // and Lezer error markers (⚠ / ERROR) so a malformed `(synth` head
    // is not picked up as a real head symbol.
    if (name === "(" || name === ")" || name === "[") continue;
    if (name === "⚠" || name === "ERROR" || name === "Error") continue;
    return c;
  }
  return null;
}

// ─── Re-exports for tests ──────────────────────────────────────────────────

export type { FormKey };
