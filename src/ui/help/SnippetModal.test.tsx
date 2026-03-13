import { render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./CodeMirrorEditor", () => ({
  CodeMirrorEditor: (props: { code: string; onCodeChange: (value: string) => void }) => (
    <textarea
      data-testid="snippet-code-editor"
      value={props.code}
      onInput={(event) => props.onCodeChange(event.currentTarget.value)}
    />
  ),
}));

vi.mock("../../utils/snippetStore", () => ({
  addSnippet: vi.fn(),
  updateSnippet: vi.fn(),
}));

vi.mock("../../lib/editorStore", () => ({
  editor: () => null,
}));

import { SnippetModal } from "./SnippetModal";
import { _resetForTesting } from "../overlayManager";

describe("SnippetModal", () => {
  beforeEach(() => {
    document.body.style.overflow = "";
  });

  afterEach(() => {
    _resetForTesting();
    document.body.style.overflow = "";
    vi.restoreAllMocks();
  });

  it("registers with the shared overlay manager for Escape and scroll lock", () => {
    const onClose = vi.fn();

    render(() => <SnippetModal editingSnippet="new" onClose={onClose} />);

    expect(screen.getByText("Add Code Snippet")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
