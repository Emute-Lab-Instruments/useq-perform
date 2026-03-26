/**
 * Context Predicates — named boolean functions for when-clause evaluation.
 *
 * Other modules register their own predicates via `registerContext()`.
 * The binding resolver and dispatch layer call `evaluateWhen()` to
 * check whether a binding's when-clause is satisfied.
 *
 * Lightweight — no heavy app dependencies. DOM-based predicates are
 * registered via `registerDefaultContexts()`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextPredicate = () => boolean;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const predicates: Record<string, ContextPredicate> = {};

/**
 * Register a named boolean predicate.
 * Overwrites any previous predicate with the same name.
 */
export function registerContext(
  name: string,
  predicate: ContextPredicate,
): void {
  predicates[name] = predicate;
}

/**
 * Evaluate a single named predicate. Returns false (with a console warning)
 * if the predicate is not registered.
 */
export function getContext(name: string): boolean {
  const predicate = predicates[name];
  if (!predicate) {
    console.warn(`Unknown context predicate: "${name}"`);
    return false;
  }
  return predicate();
}

// ---------------------------------------------------------------------------
// When-clause evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a when-clause expression string.
 *
 * Supported syntax:
 *   - Single predicate:  `"editor.focused"`
 *   - Negation:          `"!modal.open"`
 *   - Conjunction:       `"editor.focused && probe.active"`
 *   - Combined:          `"editor.focused && !modal.open"`
 *   - No disjunction (OR) by design
 *
 * Returns true for undefined/empty expressions (unconditional binding).
 * Returns false (with a console warning) for malformed input.
 */
export function evaluateWhen(expression: string | undefined): boolean {
  if (expression === undefined || expression === "") return true;

  const parts = expression.split("&&");

  for (const raw of parts) {
    const part = raw.trim();
    if (part === "") {
      console.warn(`Malformed when-clause expression: "${expression}"`);
      return false;
    }

    let negated = false;
    let name = part;

    if (name.startsWith("!")) {
      negated = true;
      name = name.slice(1).trim();
    }

    if (name === "") {
      console.warn(`Malformed when-clause expression: "${expression}"`);
      return false;
    }

    const value = getContext(name);
    if (negated ? value : !value) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Static when-clause overlap detection
// ---------------------------------------------------------------------------

/**
 * Determine whether two when-clause expressions could be true at the same
 * time (i.e. they overlap).
 *
 * Used for conflict detection — two bindings on the same key are in conflict
 * only if their when-clauses overlap.
 *
 * Heuristic (covers the common cases without a full SAT solver):
 *   - Both undefined/empty       -> overlap (both unconditional)
 *   - One undefined/empty        -> overlap (unconditional catches everything)
 *   - Same string                -> overlap (identical conditions)
 *   - Direct negation pair       -> no overlap ("x" vs "!x")
 *   - Conjunction contains a     -> no overlap
 *     term that is the negation
 *     of a term in the other
 *   - Otherwise                  -> assume overlap (conservative)
 */
export function whenExpressionsOverlap(
  a?: string,
  b?: string,
): boolean {
  // Normalise: treat empty string the same as undefined (unconditional)
  const aNorm = a?.trim() || undefined;
  const bNorm = b?.trim() || undefined;

  if (aNorm === undefined && bNorm === undefined) return true;
  if (aNorm === undefined || bNorm === undefined) return true;
  if (aNorm === bNorm) return true;

  // Parse both expressions into sets of signed terms
  const aTerms = parseTerms(aNorm);
  const bTerms = parseTerms(bNorm);

  if (aTerms === null || bTerms === null) {
    // Malformed — be conservative and assume overlap
    return true;
  }

  // If any term in A directly contradicts a term in B, the clauses
  // are mutually exclusive and cannot overlap.
  for (const [name, negated] of aTerms) {
    for (const [bName, bNegated] of bTerms) {
      if (name === bName && negated !== bNegated) {
        return false;
      }
    }
  }

  // No proven contradiction — conservatively assume overlap
  return true;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a when-clause into an array of [predicateName, isNegated] pairs.
 * Returns null if the expression is malformed.
 */
function parseTerms(
  expression: string,
): Array<[string, boolean]> | null {
  const parts = expression.split("&&");
  const terms: Array<[string, boolean]> = [];

  for (const raw of parts) {
    const part = raw.trim();
    if (part === "") return null;

    let negated = false;
    let name = part;

    if (name.startsWith("!")) {
      negated = true;
      name = name.slice(1).trim();
    }

    if (name === "") return null;

    terms.push([name, negated]);
  }

  return terms;
}

// ---------------------------------------------------------------------------
// Default predicate registration
// ---------------------------------------------------------------------------

/**
 * Register the DOM-based context predicates that have no app-level imports.
 *
 * Other modules (help panel, visualisation, transport, gamepad, etc.)
 * register their own predicates by calling `registerContext()` directly
 * during their initialisation.
 *
 * Expected external registrations:
 *   "help.visible"         — help panel module
 *   "vis.visible"          — visualisation module
 *   "probe.active"         — probe extension module
 *   "modal.open"           — modal/overlay manager
 *   "picker.open"          — picker menu module
 *   "eval.available"       — runtime/transport
 *   "gamepad.navMode"      — gamepad manager
 *   "gamepad.connected"    — gamepad manager
 *   "transport.connected"  — transport module
 */
export function registerDefaultContexts(): void {
  registerContext(
    "editor.focused",
    () => document.activeElement?.closest(".cm-editor") != null,
  );
}
