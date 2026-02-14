import { Component, For, createSignal, createMemo, Show } from "solid-js";
import {
  snippetStore,
  Snippet
} from "../../utils/snippetStore";
import { SnippetItem } from "./SnippetItem";
import { SnippetModal, EditingSnippet } from "./SnippetModal";

export const CodeSnippetsTab: Component = () => {
  const [searchTerm, setSearchTerm] = createSignal("");
  const [selectedTags, setSelectedTags] = createSignal<Set<string>>(new Set());
  const [editingSnippet, setEditingSnippet] = createSignal<EditingSnippet | null>(null);

  const allTags = createMemo(() => {
    const tags = new Set<string>();
    snippetStore.snippets.forEach(s => s.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  });

  const filteredSnippets = createMemo(() => {
    let filtered = [...snippetStore.snippets];
    
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
      const aStarred = snippetStore.starred.has(a.id);
      const bStarred = snippetStore.starred.has(b.id);
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
              {snippetStore.snippets.length === 0 
                ? 'No snippets yet. Click "Add Snippet" to create one!' 
                : 'No snippets match your filters.'}
            </div>
          }
        >
          <For each={filteredSnippets()}>
            {(snippet) => <SnippetItem snippet={snippet} onEdit={setEditingSnippet} />}
          </For>
        </Show>
      </div>

      <Show when={editingSnippet()}>
        {(editing) => (
          <SnippetModal 
            editingSnippet={editing()} 
            onClose={() => setEditingSnippet(null)} 
          />
        )}
      </Show>
    </div>
  );
};
