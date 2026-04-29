import { Component, createSignal, onCleanup, onMount } from "solid-js";
import {
  addSnippet as globalAddSnippet,
  updateSnippet as globalUpdateSnippet,
  Snippet
} from "../../utils/snippetStore";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { getEditorContent as globalGetEditorContent } from "../../lib/editorStore";
import { pushOverlay } from "../overlayManager";

export type EditingSnippet = Snippet | "new";

export interface SnippetModalProps {
  editingSnippet: EditingSnippet;
  onClose: () => void;
  /** Add a new snippet. Falls back to the global addSnippet. */
  onAddSnippet?: (snippet: Omit<Snippet, "id" | "createdAt">) => void;
  /** Update an existing snippet. Falls back to the global updateSnippet. */
  onUpdateSnippet?: (id: number, updates: Partial<Omit<Snippet, "id" | "createdAt">>) => void;
  /** Get current editor content. Falls back to the global getEditorContent. */
  getEditorContent?: () => string | null;
}

export const SnippetModal: Component<SnippetModalProps> = (props) => {
  const isNew = () => props.editingSnippet === "new";
  const snippet = () => props.editingSnippet === "new" ? null : props.editingSnippet as Snippet;

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

  let popOverlay: (() => void) | undefined;
  onMount(() => {
    popOverlay = pushOverlay("snippet-modal", props.onClose);
  });
  onCleanup(() => {
    popOverlay?.();
  });

  const doAddSnippet = (s: Omit<Snippet, "id" | "createdAt">) =>
    (props.onAddSnippet ?? globalAddSnippet)(s);
  const doUpdateSnippet = (id: number, updates: Partial<Omit<Snippet, "id" | "createdAt">>) =>
    (props.onUpdateSnippet ?? globalUpdateSnippet)(id, updates);
  const doGetEditorContent = () =>
    (props.getEditorContent ?? globalGetEditorContent)();

  const handleSave = () => {
    if (!title().trim()) {
      alert("Please enter a title");
      return;
    }
    const tagList = tags().split(",").map(t => t.trim()).filter(t => t);
    if (isNew()) {
      doAddSnippet({ title: title(), code: code(), tags: tagList });
    } else {
      doUpdateSnippet(snippet()!.id, { title: title(), code: code(), tags: tagList });
    }
    props.onClose();
  };

  const handleUseMainEditor = () => {
    const content = doGetEditorContent();
    if (content !== null) {
      setCode(content);
    }
  };

  return (
    <div class="code-snippet-modal">
      <div class="code-snippet-modal-backdrop" onClick={props.onClose} />
      <div class="code-snippet-modal-content">
        <div class="code-snippet-modal-header">
          <h3>{isNew() ? "Add Code Snippet" : "Edit Code Snippet"}</h3>
          <button class="code-snippet-modal-close" onClick={props.onClose}>×</button>
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
          <button class="code-snippet-btn-cancel" onClick={props.onClose}>Cancel</button>
          <button class="code-snippet-btn-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
};
