import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

vi.mock("../../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: () => ({ evalResults: { mode: "inline-ephemeral", autoDismissMs: 1000 } }),
}));
import { clearAllInlineResults, dispatchInlineResult, inlineResultsField } from "./inlineResults.ts";

const views: EditorView[] = [];
function view() {
  const result = new EditorView({ parent: document.body, state: EditorState.create({ doc: "bar", extensions: [inlineResultsField] }) });
  views.push(result);
  return result;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  vi.useRealTimers();
});

describe("inline result lifetime", () => {
  it("dismisses each editor's result independently", async () => {
    const first = view();
    const second = view();
    dispatchInlineResult(first, "1", 0);
    await vi.advanceTimersByTimeAsync(500);
    dispatchInlineResult(second, "2", 0);
    await vi.advanceTimersByTimeAsync(500);
    expect(first.dom.querySelector(".cm-inline-result")).toBeNull();
    expect(second.dom.querySelector(".cm-inline-result")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(second.dom.querySelector(".cm-inline-result")).toBeNull();
  });

  it("clearing another editor does not cancel a pending dismissal", async () => {
    const first = view();
    const second = view();
    dispatchInlineResult(first, "1", 0);
    clearAllInlineResults(second);
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.dom.querySelector(".cm-inline-result")).toBeNull();
  });
});
