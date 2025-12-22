import { createStore } from "solid-js/store";
import { createEffect } from "solid-js";

export interface Snippet {
  id: number;
  title: string;
  code: string;
  tags: string[];
  createdAt: number;
}

const STORAGE_KEYS = {
  snippets: "codeSnippets:snippets",
  starred: "codeSnippets:starred",
  nextId: "codeSnippets:nextId",
};

const loadInitialState = () => {
  try {
    const snippets = JSON.parse(localStorage.getItem(STORAGE_KEYS.snippets) || "[]");
    const starred = JSON.parse(localStorage.getItem(STORAGE_KEYS.starred) || "[]");
    const nextId = parseInt(localStorage.getItem(STORAGE_KEYS.nextId) || "1", 10);
    return {
      snippets,
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
  localStorage.setItem(STORAGE_KEYS.snippets, JSON.stringify(snippetStore.snippets));
  localStorage.setItem(STORAGE_KEYS.starred, JSON.stringify(Array.from(snippetStore.starred)));
  localStorage.setItem(STORAGE_KEYS.nextId, snippetStore.nextId.toString());
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
