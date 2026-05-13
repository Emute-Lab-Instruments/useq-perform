import { createStore } from "solid-js/store";
import { createEffect } from "solid-js";
import { load, save, saveRaw, loadRaw, PERSISTENCE_KEYS } from "../lib/persistence.ts";

export interface Snippet {
  id: number;
  title: string;
  code: string;
  tags: string[];
  createdAt: number;
}

/** Built-in starter snippets, seeded when the store is first created. */
export const STARTER_SNIPPETS: Omit<Snippet, "id" | "createdAt">[] = [
  // Rhythm Patterns
  { title: "Kick Pattern", code: "(d1 (sqr beat))", tags: ["rhythm", "starter"] },
  { title: "Hi-Hat Pattern", code: "(d2 (sqr (fast 8 bar)))", tags: ["rhythm", "starter"] },
  { title: "Euclidean Rhythm", code: "(d3 (euclid 5 8 bar))", tags: ["rhythm", "euclidean", "starter"] },

  // Modulation Shapes
  { title: "Slow LFO", code: "(a1 (sin (slow 4 bar)))", tags: ["modulation", "starter"] },
  { title: "Tremolo", code: "(a1 (* (sin (fast 8 bar)) (tri bar)))", tags: ["modulation", "starter"] },
  { title: "Decay Envelope", code: "(a2 (* (- 1 (fast 4 bar)) (sqr (fast 4 bar))))", tags: ["modulation", "envelope", "starter"] },

  // Melodic Sequences
  { title: "Step Sequence", code: "(a1 (from-list [0.2 0.4 0.6 0.8 0.5 0.3] bar))", tags: ["melodic", "starter"] },
  { title: "Smooth Contour", code: "(a2 (interp [0 1 0.3 0.8 0] bar))", tags: ["melodic", "starter"] },

  // Interactive Patches
  { title: "CV Speed Control", code: "(d1 (sqr (fast (scale 0 1 1 8 ain1) bar)))", tags: ["interactive", "starter"] },
  { title: "Switch Pattern Select", code: "(d2 (if swm (euclid 7 16 bar) (euclid 3 8 bar)))", tags: ["interactive", "starter"] },

  // Algebra fundamentals (Ch. 2) — the conceptual core
  { title: "Threshold to Gate", code: "(d1 (> (sin bar) 0.3))", tags: ["algebra", "rhythm", "starter"] },
  { title: "Moving Threshold", code: "(d1 (> (sin (fast 4 bar)) (sin bar)))", tags: ["algebra", "rhythm", "starter"] },
  { title: "Inverted Pattern", code: "(d2 (- 1 (euclid 3 8 bar)))", tags: ["algebra", "rhythm", "starter"] },
  { title: "Staircase 4-Step", code: "(a1 (/ (floor (* 4 bar)) 4))", tags: ["algebra", "melodic", "starter"] },
  { title: "Zero-Window Gate", code: "(a1 (* (sqr (fast 4 bar)) (sin (fast 32 bar))))", tags: ["algebra", "modulation", "starter"] },
  {
    title: "Polyrhythm 3v4",
    code: "(d1 (sqr (fast 3 bar)))\n(d2 (sqr (fast 4 bar)))",
    tags: ["algebra", "rhythm", "starter"],
  },

  // Rhythm & composition (Ch. 4)
  { title: "Boolean AND Rhythm", code: "(d1 (* (euclid 3 8 bar) (euclid 5 8 bar)))", tags: ["rhythm", "composition", "starter"] },
  { title: "Boolean XOR Rhythm", code: "(d1 (abs (- (euclid 3 8 bar) (euclid 5 8 bar))))", tags: ["rhythm", "composition", "starter"] },
  {
    title: "Phase-Shifted Canon",
    code: "(d1 (euclid 3 8 bar))\n(d2 (euclid 3 8 (shift 0.25 bar)))",
    tags: ["rhythm", "composition", "starter"],
  },
  { title: "Gate Sequence", code: "(d1 (gates [1 0 1 1 0 1 0 1] 0.5 bar))", tags: ["rhythm", "starter"] },
  { title: "Trigger Sequence", code: "(a1 (trigs [9 0 5 0 7 0 3 0] 0.3 bar))", tags: ["rhythm", "melodic", "starter"] },
  {
    title: "Layered Drum Kit",
    code: "(d1 (sqr beat))\n(d2 (sqr (fast 8 bar)))\n(d3 (euclid 3 8 bar))",
    tags: ["rhythm", "composition", "starter"],
  },

  // Modulation & expression (Ch. 3)
  { title: "AR Envelope", code: "(a1 (tri (fast 4 bar) 0.1))", tags: ["modulation", "envelope", "starter"] },
  { title: "Pluck", code: "(a1 (* (- 1 (fast 4 bar)) (sin (fast 64 bar)) (sqr (fast 4 bar))))", tags: ["modulation", "envelope", "starter"] },
  { title: "PWM", code: "(d1 (> (saw (fast 8 bar)) (sin bar)))", tags: ["modulation", "starter"] },
  { title: "LFO-Modulated Speed", code: "(d1 (sqr (fast (scale -1 1 2 8 (sin (slow 4 bar))) bar)))", tags: ["modulation", "starter"] },
  { title: "Crossfade Two Signals", code: "(a1 (+ (* bar (sin (fast 8 bar))) (* (- 1 bar) (tri (fast 8 bar)))))", tags: ["modulation", "starter"] },
  { title: "Drawn Contour", code: "(a1 (interp [0 0.8 0.3 1 0] (fast 2 bar)))", tags: ["modulation", "melodic", "starter"] },

  // Interactive / hardware (Ch. 4.4)
  { title: "CV Threshold", code: "(d1 (> ain1 0.5))", tags: ["interactive", "starter"] },
  {
    title: "Toggle 3-Way Mode",
    code: "(d1 (if (= swt 1) (euclid 5 8 bar) (if (= swt -1) (euclid 3 8 bar) (sqr beat))))",
    tags: ["interactive", "starter"],
  },

  // Editor / tools showcase (Ch. 5)
  { title: "Random Sample-and-Hold", code: "(a1 (random (fast 4 bar)))", tags: ["tools", "melodic", "starter"] },
  {
    title: "Named Speed (def)",
    code: "(def speed 4)\n(d1 (sqr (fast speed bar)))",
    tags: ["language", "tools", "starter"],
  },
  {
    title: "Set Tempo + Sig",
    code: "(set-bpm 128)\n(set-time-sig 4 4)\n(d1 (sqr beat))",
    tags: ["tools", "starter"],
  },
];

function seedStarters(): { snippets: Snippet[]; nextId: number } {
  const snippets = STARTER_SNIPPETS.map((s, i) => ({
    ...s,
    id: i + 1,
    createdAt: 0, // sort below user-created snippets
  }));
  return { snippets, nextId: snippets.length + 1 };
}

const loadInitialState = () => {
  try {
    const snippets = load<Snippet[]>(PERSISTENCE_KEYS.snippets, []);
    const starredRaw = load<number[]>(PERSISTENCE_KEYS.snippetsStarred, []);
    const nextIdRaw = parseInt(loadRaw(PERSISTENCE_KEYS.snippetsNextId, "1"), 10);

    const starred = Array.isArray(starredRaw) ? starredRaw : [];
    const nextId = Number.isFinite(nextIdRaw) && nextIdRaw > 0 ? nextIdRaw : 1;

    const validSnippets = Array.isArray(snippets) ? snippets : [];

    // Seed starter snippets when the store has never been populated
    if (validSnippets.length === 0 && nextId === 1) {
      const seeded = seedStarters();
      return {
        snippets: seeded.snippets,
        starred: new Set<number>(starred),
        nextId: seeded.nextId,
      };
    }

    return {
      snippets: validSnippets,
      starred: new Set<number>(starred),
      nextId,
    };
  } catch (e) {
    console.error("Failed to load snippets from storage", e);
    const seeded = seedStarters();
    return {
      snippets: seeded.snippets,
      starred: new Set<number>(),
      nextId: seeded.nextId,
    };
  }
};

const initialState = loadInitialState();

export const [snippetStore, setSnippetStore] = createStore({
  snippets: initialState.snippets as Snippet[],
  starred: initialState.starred as Set<number>,
  nextId: initialState.nextId,
});

// Persistence
createEffect(() => {
  save(PERSISTENCE_KEYS.snippets, snippetStore.snippets);
  save(PERSISTENCE_KEYS.snippetsStarred, Array.from(snippetStore.starred));
  saveRaw(PERSISTENCE_KEYS.snippetsNextId, snippetStore.nextId.toString());
});

export const addSnippet = (snippet: Omit<Snippet, "id" | "createdAt">) => {
  const newSnippet: Snippet = {
    ...snippet,
    id: snippetStore.nextId,
    createdAt: Date.now(),
  };
  setSnippetStore("snippets", (s) => [...s, newSnippet]);
  setSnippetStore("nextId", (n) => n + 1);
};

export const updateSnippet = (id: number, updates: Partial<Omit<Snippet, "id" | "createdAt">>) => {
  setSnippetStore("snippets", (s) => s.id === id, updates);
};

export const deleteSnippet = (id: number) => {
  setSnippetStore("snippets", (s) => s.filter((sn) => sn.id !== id));
  setSnippetStore("starred", (s) => {
    const next = new Set(s);
    next.delete(id);
    return next;
  });
};

export const toggleStar = (id: number) => {
  setSnippetStore("starred", (s) => {
    const next = new Set(s);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
};
