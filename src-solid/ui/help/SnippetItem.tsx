import { Component, createSignal, Show, For, onCleanup } from "solid-js";
import {
  snippetStore,
  toggleStar,
  deleteSnippet,
  Snippet
} from "../../utils/snippetStore";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { editor as mainEditor } from "../../lib/editorStore";

interface SnippetItemProps {
  snippet: Snippet;
  onEdit: (snippet: Snippet) => void;
}

export const SnippetItem: Component<SnippetItemProps> = (props) => {
  const [isVisualizing, setIsVisualizing] = createSignal(false);
  const [copyFeedback, setCopyFeedback] = createSignal(false);
  const [insertFeedback, setInsertFeedback] = createSignal(false);
  let copyFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let insertFeedbackTimer: ReturnType<typeof setTimeout> | undefined;

  const isStarred = () => snippetStore.starred.has(props.snippet.id);

  const handleCopy = () => {
    navigator.clipboard.writeText(props.snippet.code);
    setCopyFeedback(true);
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = setTimeout(() => setCopyFeedback(false), 1500);
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
      setInsertFeedback(true);
      if (insertFeedbackTimer) clearTimeout(insertFeedbackTimer);
      insertFeedbackTimer = setTimeout(() => setInsertFeedback(false), 1500);
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

  onCleanup(() => {
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
    if (insertFeedbackTimer) clearTimeout(insertFeedbackTimer);
  });

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
        <button class="code-snippet-action-btn" onClick={handleCopy} title="Copy to clipboard">
          {copyFeedback() ? "✅" : "📋"}
        </button>
        <button class="code-snippet-action-btn" onClick={handleInsert} title="Insert at top">
          {insertFeedback() ? "✅" : "⬆"}
        </button>
        <button 
          class="code-snippet-action-btn" 
          classList={{ active: isVisualizing() }} 
          onClick={handleToggleVis} 
          title="Toggle visualization"
        >
          👁
        </button>
        <button class="code-snippet-action-btn" onClick={() => props.onEdit(props.snippet)} title="Edit snippet">✏</button>
        <button class="code-snippet-action-btn delete" onClick={() => { if(confirm("Delete snippet?")) deleteSnippet(props.snippet.id) }} title="Delete snippet">🗑</button>
      </div>
    </div>
  );
};
