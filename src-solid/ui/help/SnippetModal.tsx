import { Component, createSignal, onMount } from "solid-js";
import {
  addSnippet,
  updateSnippet,
  Snippet
} from "../../utils/snippetStore";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { editor as mainEditor } from "../../lib/editorStore";

export type EditingSnippet = Snippet | "new";

interface SnippetModalProps {
  editingSnippet: EditingSnippet;
  onClose: () => void;
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

  const handleSave = () => {
    const tagList = tags().split(",").map(t => t.trim()).filter(t => t);
    if (isNew()) {
      addSnippet({ title: title(), code: code(), tags: tagList });
    } else {
      updateSnippet(snippet()!.id, { title: title(), code: code(), tags: tagList });
    }
    props.onClose();
  };

  const handleUseMainEditor = () => {
    const editor = mainEditor();
    if (editor) {
      setCode(editor.state.doc.toString());
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
