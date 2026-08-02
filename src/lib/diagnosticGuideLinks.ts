/**
 * Diagnostic category → guide section map.
 *
 * Spec: `docs/specs/the-machine.md` §5.1 — the user-altitude twin of the
 * Engine Ledger's clause links. A diagnostic the user can see may offer a
 * link to the guide section that explains the idea it violated.
 *
 * Deliberately small and static. §5.1 defers richness ("M1 wires a small
 * static category→section map"); this is that map and nothing more.
 *
 * Pure data + a pure resolver, so it lives in `src/lib/` and can be read by
 * the editor's diagnostic surface without that layer importing UI.
 */

/**
 * Wire category values emitted by the engine.
 *
 * Note the drift: `src-useq/docs/specs/diagnostics.md` §2.3 documents
 * snake_case (`"undefined_name"`), but
 * `src-useq/uSEQ/src/signal_engine/diagnostics.cpp` `category_to_cstr()`
 * actually emits camelCase (`"undefinedName"`), and the conformance corpus
 * (`values-types/basics.yaml`) matches the implementation. We key off the
 * value the engine really sends and accept the documented spelling as an
 * alias, so the link works whichever side is corrected.
 */
export type DiagnosticCategory =
  | "syntax"
  | "undefinedName"
  | "arity"
  | "type"
  | "boundary"
  | "arithmetic"
  | "runtime"
  | "overflow";

export interface DiagnosticGuideLink {
  /** `Section.id` in the guide data. */
  sectionId: string;
  /** Label for the affordance, e.g. the lint action's button text. */
  label: string;
}

/**
 * The map. Each entry answers "which of the six ideas would have prevented
 * this?" — not "which reference page names this function".
 */
const CATEGORY_LINKS: Readonly<Record<string, DiagnosticGuideLink>> = {
  // An unknown name is usually a name that was never bound, or an output
  // that does not exist. Both are the outputs/naming idea.
  undefinedName: {
    sectionId: "machine-outputs",
    label: "Guide: values land on outputs",
  },
  undefined_name: {
    sectionId: "machine-outputs",
    label: "Guide: values land on outputs",
  },

  // Wrong shape of expression — the signal-not-steps idea.
  syntax: {
    sectionId: "machine-signal",
    label: "Guide: your expression is a signal",
  },
  arity: {
    sectionId: "machine-signal",
    label: "Guide: your expression is a signal",
  },

  // A value that varies in time used where a constant was required. That is
  // the signal idea again, from the other direction.
  type: {
    sectionId: "machine-signal",
    label: "Guide: your expression is a signal",
  },

  // Arithmetic and runtime faults are the ones the LKG guarantee catches.
  arithmetic: {
    sectionId: "machine-failure",
    label: "Guide: breaking code doesn't break sound",
  },
  runtime: {
    sectionId: "machine-failure",
    label: "Guide: breaking code doesn't break sound",
  },

  // Limits — too many bindings, too many names. State and memory.
  overflow: {
    sectionId: "machine-state",
    label: "Guide: state remembers",
  },
  boundary: {
    sectionId: "machine-state",
    label: "Guide: state remembers",
  },
};

/** Every guide section id this map can point at. */
export const LINKED_GUIDE_SECTION_IDS: readonly string[] = [
  ...new Set(Object.values(CATEGORY_LINKS).map((link) => link.sectionId)),
];

/**
 * Resolve a guide link for a diagnostic category, or `null` when the
 * category has no useful section. Unknown categories resolve to `null`
 * rather than to a catch-all — a wrong link is worse than none.
 */
export function guideLinkForCategory(
  category: string | undefined | null,
): DiagnosticGuideLink | null {
  if (!category) return null;
  return CATEGORY_LINKS[category] ?? null;
}
