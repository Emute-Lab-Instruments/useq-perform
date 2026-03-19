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

const loadInitialState = () => {
  try {
    const snippets = load<Snippet[]>(PERSISTENCE_KEYS.snippets, []);
    const starredRaw = load<number[]>(PERSISTENCE_KEYS.snippetsStarred, []);
    const nextIdRaw = parseInt(loadRaw(PERSISTENCE_KEYS.snippetsNextId, "1"), 10);

    const starred = Array.isArray(starredRaw) ? starredRaw : [];
    const nextId = Number.isFinite(nextIdRaw) && nextIdRaw > 0 ? nextIdRaw : 1;

    return {
      snippets: Array.isArray(snippets) ? snippets : [],
      starred: new Set<number>(starred),
      nextId,
    };
  } catch (e) {
    console.error("Failed to load snippets from storage", e);
    return {
      snippets: [],
      starred: new Set<number>(),
      nextId: 1,
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
