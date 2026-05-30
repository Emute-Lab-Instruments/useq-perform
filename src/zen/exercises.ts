// src/zen/exercises.ts
//
// Exercise definitions for zen mode. Each exercise uses the «» DSL to mark
// cursor position in start/target code strings.

import type { ActionId } from "../lib/keybindings/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CategoryId =
  | "navigation"
  | "slurp-barf"
  | "raise-splice"
  | "wrap"
  | "transpose"
  | "delete"
  | "combos";

export type PromptMode = "ghost" | "spotlight" | "beforeAfter" | "puzzle";

export interface ExerciseInput {
  title: string;
  category: CategoryId;
  start: string;
  target: string;
  prompt: PromptMode;
  actions: ActionId[];
  hints?: string[];
}

export interface Exercise {
  id: string;
  title: string;
  category: CategoryId;
  startCode: string;
  startCursorText: string;
  targetCode: string;
  targetCursorText: string;
  promptMode: PromptMode;
  actions: ActionId[];
  hints?: string[];
}

export interface CategoryDef {
  id: CategoryId;
  label: string;
  description: string;
}

// ---------------------------------------------------------------------------
// DSL helpers
// ---------------------------------------------------------------------------

const CURSOR_OPEN = "«";
const CURSOR_CLOSE = "»";

function parseCursorMarkers(s: string): { code: string; cursorText: string } {
  const openIdx = s.indexOf(CURSOR_OPEN);
  const closeIdx = s.indexOf(CURSOR_CLOSE);
  if (openIdx === -1 || closeIdx === -1) {
    throw new Error(`Exercise string missing cursor markers «»: "${s}"`);
  }
  const cursorText = s.slice(openIdx + 1, closeIdx);
  const code = s.slice(0, openIdx) + cursorText + s.slice(closeIdx + 1);
  return { code, cursorText };
}

function exercise(id: string, input: ExerciseInput): Exercise {
  const start = parseCursorMarkers(input.start);
  const target = parseCursorMarkers(input.target);
  return {
    id,
    title: input.title,
    category: input.category,
    startCode: start.code,
    startCursorText: start.cursorText,
    targetCode: target.code,
    targetCursorText: target.cursorText,
    promptMode: input.prompt,
    actions: input.actions,
    hints: input.hints,
  };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categories: CategoryDef[] = [
  {
    id: "navigation",
    label: "Navigation",
    description: "Move through the tree structure",
  },
  {
    id: "slurp-barf",
    label: "Slurp & Barf",
    description: "Grow and shrink list boundaries",
  },
  {
    id: "raise-splice",
    label: "Raise & Splice",
    description: "Promote nodes and dissolve containers",
  },
  { id: "wrap", label: "Wrap", description: "Enclose nodes in new containers" },
  {
    id: "transpose",
    label: "Transpose",
    description: "Swap sibling order",
  },
  {
    id: "delete",
    label: "Delete",
    description: "Remove nodes from the tree",
  },
  {
    id: "combos",
    label: "Combos",
    description: "Multi-step structural transforms",
  },
];

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export const exercises: Exercise[] = [
  // ==========================================================================
  // NAVIGATION
  // ==========================================================================

  exercise("nav-right-1", {
    title: "Next sibling",
    category: "navigation",
    start: "(+ «1» 2 3)",
    target: "(+ 1 «2» 3)",
    prompt: "spotlight",
    actions: ["nav.right"],
    hints: ["Move to the next sibling"],
  }),

  exercise("nav-left-1", {
    title: "Previous sibling",
    category: "navigation",
    start: "(+ 1 «2» 3)",
    target: "(+ «1» 2 3)",
    prompt: "spotlight",
    actions: ["nav.left"],
    hints: ["Move to the previous sibling"],
  }),

  exercise("nav-right-multi", {
    title: "Traverse siblings",
    category: "navigation",
    start: "(map «inc» [1 2 3])",
    target: "(map inc «[1 2 3]»)",
    prompt: "spotlight",
    actions: ["nav.right"],
    hints: ["Keep moving right through the siblings"],
  }),

  exercise("nav-enter-1", {
    title: "Drill in",
    category: "navigation",
    start: "(def x «(+ 1 2)»)",
    target: "(def x («+» 1 2))",
    prompt: "spotlight",
    actions: ["nav.in"],
    hints: ["Drill into the focused expression"],
  }),

  exercise("nav-back-1", {
    title: "Drill out",
    category: "navigation",
    start: "(def x («+» 1 2))",
    target: "(def x «(+ 1 2)»)",
    prompt: "spotlight",
    actions: ["nav.out"],
    hints: ["Back out to the containing expression"],
  }),

  exercise("nav-up-1", {
    title: "Move to parent",
    category: "navigation",
    start: "(+ «1» 2)",
    target: "«(+ 1 2)»",
    prompt: "spotlight",
    actions: ["nav.up"],
    hints: ["Move up to the parent container"],
  }),

  exercise("nav-deep-1", {
    title: "Navigate to target",
    category: "navigation",
    start: "(+ «1» (- 3 4))",
    target: "(+ 1 (- «3» 4))",
    prompt: "spotlight",
    actions: [
      "nav.right",
      "nav.in",
      "nav.right",
    ],
    hints: [
      "Move right to reach the nested expression",
      "Drill in, then move right to the target",
    ],
  }),

  // ==========================================================================
  // SLURP & BARF
  // ==========================================================================

  exercise("slurp-fwd-1", {
    title: "Slurp one",
    category: "slurp-barf",
    start: "«(+ 1 2)» 3",
    target: "«(+ 1 2 3)»",
    prompt: "ghost",
    actions: ["edit.slurpFwd"],
    hints: ["Pull the next sibling into this list"],
  }),

  exercise("slurp-fwd-2", {
    title: "Slurp into call",
    category: "slurp-barf",
    start: "«(map inc)» [1 2 3]",
    target: "«(map inc [1 2 3])»",
    prompt: "ghost",
    actions: ["edit.slurpFwd"],
    hints: ["The vector should become an argument to map"],
  }),

  exercise("slurp-fwd-3", {
    title: "Slurp twice",
    category: "slurp-barf",
    start: "«(+)» 1 2",
    target: "«(+ 1 2)»",
    prompt: "ghost",
    actions: ["edit.slurpFwd", "edit.slurpFwd"],
    hints: ["Slurp pulls one sibling at a time — do it twice"],
  }),

  exercise("slurp-back-1", {
    title: "Slurp backward",
    category: "slurp-barf",
    start: "x «(+ 1 2)»",
    target: "«(x + 1 2)»",
    prompt: "ghost",
    actions: ["edit.slurpBack"],
    hints: ["Pull the previous sibling into this list from the left"],
  }),

  exercise("barf-fwd-1", {
    title: "Barf forward",
    category: "slurp-barf",
    start: "«(+ 1 2 3)»",
    target: "«(+ 1 2)» 3",
    prompt: "ghost",
    actions: ["edit.barfFwd"],
    hints: ["Push the last child out to become a sibling"],
  }),

  exercise("barf-fwd-2", {
    title: "Barf the collection",
    category: "slurp-barf",
    start: "«(map inc [1 2 3])»",
    target: "«(map inc)» [1 2 3]",
    prompt: "ghost",
    actions: ["edit.barfFwd"],
    hints: ["Eject the last argument out of the function call"],
  }),

  exercise("barf-back-1", {
    title: "Barf backward",
    category: "slurp-barf",
    start: "«(x + 1 2)»",
    target: "x «(+ 1 2)»",
    prompt: "ghost",
    actions: ["edit.barfBack"],
    hints: ["Push the first child out to the left as a sibling"],
  }),

  exercise("slurp-barf-round-trip", {
    title: "Round trip",
    category: "slurp-barf",
    start: "«(+ 1)» 2 3",
    target: "«(+ 1)» 2 3",
    prompt: "puzzle",
    actions: [
      "edit.slurpFwd",
      "edit.slurpFwd",
      "edit.barfFwd",
      "edit.barfFwd",
    ],
    hints: [
      "Slurp both in, then barf both back out",
      "The result is the same as the start — it's about the journey",
    ],
  }),

  // ==========================================================================
  // RAISE & SPLICE
  // ==========================================================================

  exercise("raise-1", {
    title: "Raise atom",
    category: "raise-splice",
    start: "(if true «42» 0)",
    target: "«42»",
    prompt: "ghost",
    actions: ["edit.raise"],
    hints: ["Raise replaces the parent with the focused node"],
  }),

  exercise("raise-2", {
    title: "Raise expression",
    category: "raise-splice",
    start: "(do (println x) «(+ 1 2)»)",
    target: "«(+ 1 2)»",
    prompt: "ghost",
    actions: ["edit.raise"],
    hints: ["The whole expression replaces its parent"],
  }),

  exercise("splice-1", {
    title: "Splice open",
    category: "raise-splice",
    start: "(+ 1 «(* 2 3)» 4)",
    target: "(+ 1 «*» 2 3 4)",
    prompt: "ghost",
    actions: ["edit.splice"],
    hints: [
      "Splice removes the container but keeps its children as siblings",
    ],
  }),

  exercise("splice-2", {
    title: "Unwrap do block",
    category: "raise-splice",
    start: "(let [x 1] «(do (inc x) (dec x))»)",
    target: "(let [x 1] «(inc x)» (dec x))",
    prompt: "ghost",
    actions: ["edit.splice"],
    hints: ["The do wrapper dissolves; its children become siblings in the let body"],
  }),

  // ==========================================================================
  // WRAP
  // ==========================================================================

  exercise("wrap-list-1", {
    title: "Wrap in list",
    category: "wrap",
    start: "(+ 1 «2» 3)",
    target: "(+ 1 «(2)» 3)",
    prompt: "ghost",
    actions: ["edit.wrapList"],
    hints: ["Enclose the focused node in a new list"],
  }),

  exercise("wrap-vector-1", {
    title: "Wrap in vector",
    category: "wrap",
    start: "(let «x» 1)",
    target: "(let «[x]» 1)",
    prompt: "ghost",
    actions: ["edit.wrapVector"],
    hints: ["Enclose in a vector — square brackets"],
  }),

  exercise("wrap-map-1", {
    title: "Wrap in map",
    category: "wrap",
    start: "(merge «base» extra)",
    target: "(merge «{base}» extra)",
    prompt: "ghost",
    actions: ["edit.wrapMap"],
    hints: ["Enclose the focused node in a new map — curly braces"],
  }),

  exercise("wrap-set-1", {
    title: "Wrap in set",
    category: "wrap",
    start: "(conj acc «x»)",
    target: "(conj acc «#{x}»)",
    prompt: "ghost",
    actions: ["edit.wrapSet"],
    hints: ["Enclose the focused node in a new set — #{ }"],
  }),

  exercise("wrap-list-2", {
    title: "Wrap and call",
    category: "wrap",
    start: "(+ «1» 2)",
    target: "(+ «(inc 1)» 2)",
    prompt: "beforeAfter",
    actions: ["edit.wrapList"],
    hints: [
      "Wrap in a list, then you'd type the function name",
      "For this exercise, just achieve the structural shape",
    ],
  }),

  // ==========================================================================
  // TRANSPOSE
  // ==========================================================================

  exercise("transpose-fwd-1", {
    title: "Swap right",
    category: "transpose",
    start: "(+ «1» 2 3)",
    target: "(+ 2 «1» 3)",
    prompt: "ghost",
    actions: ["edit.transposeFwd"],
    hints: ["Swap the focused node with its next sibling"],
  }),

  exercise("transpose-fwd-2", {
    title: "Move to end",
    category: "transpose",
    start: "(+ «1» 2 3)",
    target: "(+ 2 3 «1»)",
    prompt: "ghost",
    actions: ["edit.transposeFwd", "edit.transposeFwd"],
    hints: ["Transpose twice to move past two siblings"],
  }),

  exercise("transpose-back-1", {
    title: "Swap left",
    category: "transpose",
    start: "(+ 1 «2» 3)",
    target: "(+ «2» 1 3)",
    prompt: "ghost",
    actions: ["edit.transposeBack"],
    hints: ["Swap with the previous sibling"],
  }),

  exercise("transpose-args", {
    title: "Reorder arguments",
    category: "transpose",
    start: "(assoc «m» k v)",
    target: "(assoc k v «m»)",
    prompt: "ghost",
    actions: ["edit.transposeFwd", "edit.transposeFwd"],
    hints: ["Move the map argument to the end"],
  }),

  // ==========================================================================
  // DELETE
  // ==========================================================================

  exercise("delete-1", {
    title: "Delete atom",
    category: "delete",
    start: "(+ 1 «2» 3)",
    target: "(+ 1 «3»)",
    prompt: "ghost",
    actions: ["edit.delete"],
    hints: ["Remove the focused node"],
  }),

  exercise("delete-2", {
    title: "Delete expression",
    category: "delete",
    start: "(do «(println x)» (+ 1 2))",
    target: "(do «(+ 1 2)»)",
    prompt: "ghost",
    actions: ["edit.delete"],
    hints: ["Delete removes the entire focused expression"],
  }),

  exercise("delete-3", {
    title: "Prune arguments",
    category: "delete",
    start: "(+ «1» 2 3 4 5)",
    target: "(+ «2» 3 4 5)",
    prompt: "ghost",
    actions: ["edit.delete"],
    hints: ["Delete the first argument"],
  }),

  // ==========================================================================
  // COMBOS
  // ==========================================================================

  exercise("combo-nav-slurp", {
    title: "Navigate then slurp",
    category: "combos",
    start: "(let [x 1] «(+ x)» 10)",
    target: "(let [x 1] «(+ x 10)»)",
    prompt: "beforeAfter",
    actions: ["edit.slurpFwd"],
    hints: [
      "You're already on the right node — just slurp",
      "Pull 10 into the addition",
    ],
  }),

  exercise("combo-nav-deep-slurp", {
    title: "Find and slurp",
    category: "combos",
    start: "«(let [x 1] (+ x) 10)»",
    target: "(let [x 1] «(+ x 10)»)",
    prompt: "beforeAfter",
    actions: [
      "nav.down",
      "nav.right",
      "nav.right",
      "edit.slurpFwd",
    ],
    hints: [
      "First navigate to the (+ x) expression",
      "Drill in, then move right to find it",
      "Once focused on (+ x), slurp the 10",
    ],
  }),

  exercise("combo-gather", {
    title: "Gather scattered args",
    category: "combos",
    start: "«(+)» 1 2 3",
    target: "«(+ 1 2 3)»",
    prompt: "ghost",
    actions: ["edit.slurpFwd", "edit.slurpFwd", "edit.slurpFwd"],
    hints: ["Slurp all three atoms into the list one by one"],
  }),

  exercise("combo-restructure", {
    title: "Nest flat args",
    category: "combos",
    start: "(+ «1» 2 3)",
    target: "(+ «(* 1 2)» 3)",
    prompt: "beforeAfter",
    actions: ["edit.wrapList", "edit.slurpFwd"],
    hints: [
      "Wrap 1 in a list, then slurp 2 into it",
      "The * would be typed in insertion mode — just get the shape right",
    ],
  }),

  exercise("combo-extract", {
    title: "Extract inner",
    category: "combos",
    start: "(+ 1 «(* 2 3)» 4)",
    target: "(+ 1 «*» 2 3 4)",
    prompt: "puzzle",
    actions: ["edit.splice"],
    hints: [
      "The nested list should dissolve into its parent",
      "Splice removes the container while keeping its children",
    ],
  }),

  exercise("combo-swap-and-slurp", {
    title: "Reorder then absorb",
    category: "combos",
    start: "(do «x» (inc x))",
    target: "(do «(inc x x)»)",
    prompt: "puzzle",
    actions: [
      "nav.right",
      "edit.slurpBack",
    ],
    hints: [
      "First, the x needs to end up inside (inc x)",
      "Think: how do you move x into the next expression?",
      "Navigate to (inc x) then slurp backward",
    ],
  }),
];

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getExercisesByCategory(
  cat: CategoryId,
): Exercise[] {
  return exercises.filter((e) => e.category === cat);
}

export function getExercise(id: string): Exercise | undefined {
  return exercises.find((e) => e.id === id);
}

export function getNextExercise(currentId: string): Exercise | undefined {
  const idx = exercises.findIndex((e) => e.id === currentId);
  if (idx === -1 || idx === exercises.length - 1) return undefined;
  return exercises[idx + 1];
}

export function getNextInCategory(currentId: string): Exercise | undefined {
  const current = getExercise(currentId);
  if (!current) return undefined;
  const catExercises = getExercisesByCategory(current.category);
  const idx = catExercises.findIndex((e) => e.id === currentId);
  if (idx === -1 || idx === catExercises.length - 1) return undefined;
  return catExercises[idx + 1];
}
