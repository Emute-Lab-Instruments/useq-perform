import { Component, For, createSignal, createMemo, Show, onMount } from "solid-js";
import {
  snippetStore,
  addSnippet,
  updateSnippet,
  deleteSnippet,
  toggleStar,
  Snippet
} from "../../utils/snippetStore";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { editor as mainEditor } from "../../lib/editorStore";

const SnippetItem: Component<{ snippet: Snippet }> = (props) => {
  const [isVisualizing, setIsVisualizing] = createSignal(false);

  const isStarred = () => snippetStore.starred.has(props.snippet.id);

  const handleCopy = () => {
    navigator.clipboard.writeText(props.snippet.code);
  };

  const handleInsert = () => {
    const editor = mainEditor();
    if (editor) {
      const transaction = editor.state.update({
        changes: {
          from: 0,
          to: 0,
          insert: props.snippet.code + "\n",
        },
      });
      editor.dispatch(transaction);
    }
  };

  const handleToggleVis = async () => {
    const isActive = isVisualizing();
    setIsVisualizing(!isActive);

    try {
      const { toggleVisualisation } = await import("../../../src/ui/serialVis/visualisationController.mjs");
      const exprType = `S${props.snippet.id}`;
      if (!isActive) {
        await toggleVisualisation(exprType, props.snippet.code);
      } else {
        await toggleVisualisation(exprType, "");
      }
    } catch (error) {
      console.error("Failed to toggle visualization:", error);
    }
  };

  return (
    <div 
      class="code-snippet-item" 
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer?.setData("text/plain", props.snippet.code);
      }}
    >
      <div class="code-snippet-header">
        <div class="code-snippet-title-row">
          <button 
            class="code-snippet-star" 
            classList={{ starred: isStarred() }}
            onClick={() => toggleStar(props.snippet.id)}
          >
            {isStarred() ? "★" : "☆"}
          </button>
          <div class="code-snippet-title">{props.snippet.title}</div>
        </div>
        <Show when={props.snippet.tags && props.snippet.tags.length > 0}>
          <div class="code-snippet-tags">
            <For each={props.snippet.tags}>
              {(tag) => <span class="code-snippet-tag">{tag}</span>}
            </For>
          </div>
        </Show>
      </div>
      <div class="code-snippet-editor-container">
        <CodeMirrorEditor code={props.snippet.code} readOnly={true} />
      </div>
      <div class="code-snippet-actions">
        <button class="code-snippet-action-btn" onClick={handleCopy} title="Copy to clipboard">📋</button>
        <button class="code-snippet-action-btn" onClick={handleInsert} title="Insert at top">⬆</button>
        <button 
          class="code-snippet-action-btn" 
          classList={{ active: isVisualizing() }} 
          onClick={handleToggleVis} 
          title="Toggle visualization"
        >
          👁
        </button>
        <button class="code-snippet-action-btn" onClick={() => setEditingSnippet(props.snippet)} title="Edit snippet">✏</button>
        <button class="code-snippet-action-btn delete" onClick={() => { if(confirm("Delete snippet?")) deleteSnippet(props.snippet.id) }} title="Delete snippet">🗑</button>
      </div>
    </div>
  );
};

const [editingSnippet, setEditingSnippet] = createSignal<Snippet | null | "new">(null);

const SnippetModal: Component = () => {
  const isNew = () => editingSnippet() === "new";
  const snippet = () => editingSnippet() === "new" ? null : editingSnippet() as Snippet;

  const [title, setTitle] = createSignal("");
  const [tags, setTags] = createSignal("");
  const [code, setCode] = createSignal("");

  onMount(() => {
    const s = snippet();
    if (s) {
      setTitle(s.title);
      setTags(s.tags.join(", "));
      setCode(s.code);
    }
  });

  const handleSave = () => {
    const tagList = tags().split(",").map(t => t.trim()).filter(t => t);
    if (isNew()) {
      addSnippet({ title: title(), code: code(), tags: tagList });
    } else {
      updateSnippet(snippet()!.id, { title: title(), code: code(), tags: tagList });
    }
    setEditingSnippet(null);
  };

  const handleUseMainEditor = () => {
    const editor = mainEditor();
    if (editor) {
      setCode(editor.state.doc.toString());
    }
  };

  return (
    <div class="code-snippet-modal">
      <div class="code-snippet-modal-backdrop" onClick={() => setEditingSnippet(null)} />
      <div class="code-snippet-modal-content">
        <div class="code-snippet-modal-header">
          <h3>{isNew() ? "Add Code Snippet" : "Edit Code Snippet"}</h3>
          <button class="code-snippet-modal-close" onClick={() => setEditingSnippet(null)}>×</button>
        </div>
        <div class="code-snippet-modal-body">
          <div class="code-snippet-form-group">
            <label>Title:</label>
            <input 
              type="text" 
              class="code-snippet-input" 
              value={title()} 
              onInput={(e) => setTitle(e.currentTarget.value)}
              placeholder="Enter snippet title"
            />
          </div>
          <div class="code-snippet-form-group">
            <label>Tags (comma-separated):</label>
            <input 
              type="text" 
              class="code-snippet-input" 
              value={tags()} 
              onInput={(e) => setTags(e.currentTarget.value)}
              placeholder="e.g., math, animation, utility"
            />
          </div>
          <div class="code-snippet-form-group">
            <label>Code:</label>
            <CodeMirrorEditor 
              code={code()} 
              onCodeChange={setCode} 
              minHeight="200px" 
              maxHeight="400px" 
            />
            <button class="code-snippet-use-main-btn" onClick={handleUseMainEditor}>
              Use code from main editor
            </button>
          </div>
        </div>
        <div class="code-snippet-modal-footer">
          <button class="code-snippet-btn-cancel" onClick={() => setEditingSnippet(null)}>Cancel</button>
          <button class="code-snippet-btn-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
};

export const CodeSnippetsTab: Component = () => {
  const [searchTerm, setSearchTerm] = createSignal("");
  const [selectedTags, setSelectedTags] = createSignal<Set<string>>(new Set());

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
            {(snippet) => <SnippetItem snippet={snippet} />}
          </For>
        </Show>
      </div>

      <Show when={editingSnippet()}>
        <SnippetModal />
      </Show>
    </div>
  );
};
