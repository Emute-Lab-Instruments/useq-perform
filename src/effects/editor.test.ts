import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { adjustFontSize, loadCode, saveCode } from "./editor";
import { applyEditorFontSize } from "../lib/editorStore";
import { updateSettings } from "../runtime/runtimeService.ts";

vi.mock("../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: () => ({ editor: { fontSize: 16 } }),
}));
vi.mock("../runtime/runtimeService.ts", () => ({ updateSettings: vi.fn() }));
vi.mock("../lib/editorStore", () => ({ applyEditorFontSize: vi.fn() }));

const views: EditorView[] = [];
function createEditor(doc = "old text") {
  const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
  views.push(view);
  return view;
}
const originalOpenPicker = window.showOpenFilePicker;
const originalSavePicker = window.showSaveFilePicker;
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  window.showOpenFilePicker = originalOpenPicker;
  window.showSaveFilePicker = originalSavePicker;
  vi.restoreAllMocks();
});

function offerFile(contents: string) {
  // jsdom lacks File.text, so supply it on a real File instance.
  const file = Object.assign(new File([contents], "example.useq"), { text: async () => contents });
  window.showOpenFilePicker = vi.fn(async () => [{
    getFile: async () => file, createWritable: vi.fn(),
  }]);
}

describe("explicit editor actions", () => {
  it.each([2, -3])("applies font delta %i to the supplied editor", (delta) => {
    const target = createEditor();
    adjustFontSize(target, delta);
    expect(applyEditorFontSize).toHaveBeenCalledWith(target, 16 + delta);
    expect(updateSettings).toHaveBeenCalledWith({ editor: { fontSize: 16 + delta } });
  });

  it.each([{ text: "new code" }, { text: "new code", format_version: 1 }, { text: "", format_version: 1 }])(
    "loads supported file %j into only the supplied document", async (data) => {
      const target = createEditor();
      const other = createEditor("leave me alone");
      offerFile(JSON.stringify(data));
      await loadCode(target);
      expect(target.state.doc.toString()).toBe(data.text);
      expect(other.state.doc.toString()).toBe("leave me alone");
    },
  );

  it.each(["{", "null", "[]", "{}", '{"text":42}', '{"text":{}}', '{"text":null}', '{"text":"new","format_version":2}', '{"text":"new","format_version":"1"}'])(
    "rejects invalid file %s without changing the document", async (contents) => {
      const target = createEditor();
      const dispatch = vi.spyOn(target, "dispatch");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      offerFile(contents);
      await loadCode(target);
      expect(target.state.doc.toString()).toBe("old text");
      expect(dispatch).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalledOnce();
    },
  );

  it("saves only the supplied editor's document", async () => {
    const target = createEditor("(+ 1 2)");
    createEditor("another document");
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    window.showSaveFilePicker = vi.fn(async () => ({
      getFile: vi.fn(), createWritable: async () => ({ write, close }),
    }));
    await saveCode(target);
    expect(write).toHaveBeenCalledWith(JSON.stringify({ text: "(+ 1 2)", format_version: 1 }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("does nothing with no target", async () => {
    window.showOpenFilePicker = vi.fn();
    window.showSaveFilePicker = vi.fn();
    adjustFontSize(null, 2);
    await loadCode(null);
    await saveCode(null);
    expect(applyEditorFontSize).not.toHaveBeenCalled();
    expect(window.showOpenFilePicker).not.toHaveBeenCalled();
    expect(window.showSaveFilePicker).not.toHaveBeenCalled();
  });
});
