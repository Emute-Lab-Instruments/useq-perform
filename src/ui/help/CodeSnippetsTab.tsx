import { Component, For, createSignal, createMemo, Show } from "solid-js";
import {
  snippetStore as globalSnippetStore,
  toggleStar as globalToggleStar,
  deleteSnippet as globalDeleteSnippet,
  Snippet
} from "../../utils/snippetStore";
import { SnippetItem } from "./SnippetItem";
import { SnippetModal, EditingSnippet } from "./SnippetModal";

export interface CodeSnippetsTabProps {
  /** Snippet list. Falls back to the global snippetStore. */
  snippets?: Snippet[];
  /** Set of starred snippet IDs. Falls back to the global snippetStore. */
  starred?: Set<number>;
  /** Toggle star on a snippet. Falls back to the global toggleStar. */
  onToggleStar?: (id: number) => void;
  /** Delete a snippet. Falls back to the global deleteSnippet. */
  onDeleteSnippet?: (id: number) => void;
  /** Add a snippet. Passed through to SnippetModal. */
  onAddSnippet?: (snippet: Omit<Snippet, "id" | "createdAt">) => void;
  /** Update a snippet. Passed through to SnippetModal. */
  onUpdateSnippet?: (id: number, updates: Partial<Omit<Snippet, "id" | "createdAt">>) => void;
  /** Insert text into the editor. Passed through to SnippetItem. */
  onInsertText?: (text: string, pos: number) => boolean;
}

export const CodeSnippetsTab: Component<CodeSnippetsTabProps> = (props) => {
  const snippets = () => props.snippets ?? globalSnippetStore.snippets;
  const starred = () => props.starred ?? globalSnippetStore.starred;
  const onToggleStar = (id: number) => (props.onToggleStar ?? globalToggleStar)(id);
  const onDeleteSnippet = (id: number) => (props.onDeleteSnippet ?? globalDeleteSnippet)(id);

  const [searchTerm, setSearchTerm] = createSignal("");
  const [selectedTags, setSelectedTags] = createSignal<Set<string>>(new Set());
  const [editingSnippet, setEditingSnippet] = createSignal<EditingSnippet | null>(null);

  const allTags = createMemo(() => {
    const tags = new Set<string>();
    snippets().forEach(s => s.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  });

  const filteredSnippets = createMemo(() => {
    let filtered = [...snippets()];
    
    const search = searchTerm().toLowerCase();
    if (search) {
      filtered = filtered.filter(s => 
        s.title.toLowerCase().includes(search) || 
        s.code.toLowerCase().includes(search) ||
        s.tags.some(t => t.toLowerCase().includes(search))
      );
    }

    const tags = selectedTags();
    if (tags.size > 0) {
      filtered = filtered.filter(s => s.tags.some(t => tags.has(t)));
    }

    filtered.sort((a, b) => {
      const aStarred = starred().has(a.id);
      const bStarred = starred().has(b.id);
      if (aStarred && !bStarred) return -1;
      if (!aStarred && bStarred) return 1;
      return b.createdAt - a.createdAt;
    });

    return filtered;
  });

  const toggleTag = (tag: string) => {
    const next = new Set(selectedTags());
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    setSelectedTags(next);
  };

  return (
    <div class="code-snippets-container">
      <div class="code-snippets-header">
        <div class="code-snippets-search-bar">
          <input 
            type="text" 
            class="code-snippets-search" 
            placeholder="Search snippets..." 
            value={searchTerm()}
            onInput={(e) => setSearchTerm(e.currentTarget.value)}
          />
          <button class="code-snippet-add-btn" onClick={() => setEditingSnippet("new")}>+ Add Snippet</button>
        </div>
        <div class="code-snippets-tags-filter">
          <span class="code-snippets-tags-label">Filter by tags:</span>
          <div class="code-snippets-tags-wrapper">
            <For each={allTags()}>
              {(tag) => (
                <button 
                  class="code-snippet-filter-tag" 
                  classList={{ selected: selectedTags().has(tag) }}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              )}
            </For>
          </div>
          <button 
            class="code-snippets-clear-tags" 
            disabled={selectedTags().size === 0}
            onClick={() => setSelectedTags(new Set())}
          >
            Clear
          </button>
        </div>
      </div>
      <div class="code-snippets-list">
        <Show 
          when={filteredSnippets().length > 0} 
          fallback={
            <div class="code-snippets-empty">
              {snippets().length === 0
                ? 'No snippets yet. Click "Add Snippet" to create one!' 
                : 'No snippets match your filters.'}
            </div>
          }
        >
          <For each={filteredSnippets()}>
            {(snippet) => (
              <SnippetItem
                snippet={snippet}
                onEdit={setEditingSnippet}
                starred={starred()}
                onToggleStar={onToggleStar}
                onDeleteSnippet={onDeleteSnippet}
                onInsertText={props.onInsertText}
              />
            )}
          </For>
        </Show>
      </div>

      <Show when={editingSnippet()}>
        {(editing) => (
          <SnippetModal
            editingSnippet={editing()}
            onClose={() => setEditingSnippet(null)}
            onAddSnippet={props.onAddSnippet}
            onUpdateSnippet={props.onUpdateSnippet}
          />
        )}
      </Show>
    </div>
  );
};
