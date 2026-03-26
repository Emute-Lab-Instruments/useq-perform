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
