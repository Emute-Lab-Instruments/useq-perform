/**
 * Snippet adapters - Wired wrappers that read from the global snippet store
 * and pass data + callbacks as props to pure snippet components.
 *
 * Each WiredXxx component connects the corresponding component to the real
 * application globals (snippetStore, editorStore, etc.) so the components
 * themselves remain renderable in isolation.
 */
import {
  snippetStore,
  toggleStar,
  deleteSnippet,
  addSnippet,
  updateSnippet,
} from "../../utils/snippetStore";
import { insertEditorText, getEditorContent } from "../../lib/editorStore";

import { CodeSnippetsTab } from "../help/CodeSnippetsTab";
import { SnippetModal, type EditingSnippet } from "../help/SnippetModal";

// ── Wired snippet components ───────────────────────────────────────

export function WiredCodeSnippetsTab() {
  return (
    <CodeSnippetsTab
      snippets={snippetStore.snippets}
      starred={snippetStore.starred}
      onToggleStar={toggleStar}
      onDeleteSnippet={deleteSnippet}
      onAddSnippet={addSnippet}
      onUpdateSnippet={updateSnippet}
      onInsertText={insertEditorText}
    />
  );
}

export function WiredSnippetModal(props: {
  editingSnippet: EditingSnippet;
  onClose: () => void;
}) {
  return (
    <SnippetModal
      editingSnippet={props.editingSnippet}
      onClose={props.onClose}
      onAddSnippet={addSnippet}
      onUpdateSnippet={updateSnippet}
      getEditorContent={getEditorContent}
    />
  );
}
