import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { EditorView } from "@codemirror/view";

// Internal state for the mock
let mockSettings = { editor: { fontSize: 16 } };

// Mock the canonical settings repository
vi.mock("../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: vi.fn(() => ({ ...mockSettings, editor: { ...mockSettings.editor } })),
  updateAppSettings: vi.fn((values: any) => {
    if (values?.editor?.fontSize != null) {
      mockSettings.editor.fontSize = values.editor.fontSize;
    }
  }),
}));

// Mock the compartment (transitively used by editorStore.applyEditorFontSize)
const mockFontSizeCompartment = vi.hoisted(() => ({
  reconfigure: vi.fn((extension: any) => ({ extension })),
}));
vi.mock("../lib/editorCompartments.ts", () => ({
  fontSizeCompartment: mockFontSizeCompartment,
}));

// Mock the editor signal but keep real facade functions (applyEditorFontSize etc.)
vi.mock("../lib/editorStore", async () => {
  const actual = await vi.importActual<typeof import("../lib/editorStore")>("../lib/editorStore");
  return {
    ...actual,
    editor: vi.fn(() => null),
  };
});

import { adjustFontSize, loadCode, saveCode } from "./editor";
import { editor } from "../lib/editorStore";
import {
  getAppSettings,
  updateAppSettings,
} from "../runtime/appSettingsRepository.ts";

// Helper: create a mock CodeMirror editor
function createMockEditor(docText = "hello world") {
  const mockState = {
    doc: {
      length: docText.length,
      toString: () => docText,
    },
    update: vi.fn((spec: any) => ({ spec })),
  };
  return {
    state: mockState,
    dispatch: vi.fn(),
  };
}

describe("adjustFontSize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(EditorView, "theme").mockImplementation(
      (styles) => styles as ReturnType<typeof EditorView.theme>,
    );
    mockSettings = { editor: { fontSize: 16 } };
  });

  it("calls setFontSize with updated size and saves settings", () => {
    const mockEd = createMockEditor();
    vi.mocked(editor).mockReturnValue(mockEd);

    Effect.runSync(adjustFontSize(2));

    expect(EditorView.theme).toHaveBeenCalledOnce();
    expect(mockFontSizeCompartment.reconfigure).toHaveBeenCalledOnce();
    expect(mockEd.dispatch).toHaveBeenCalledOnce();
    expect(updateAppSettings).toHaveBeenCalledWith({ editor: { fontSize: 18 } });
  });

  it("handles negative delta correctly", () => {
    const mockEd = createMockEditor();
    vi.mocked(editor).mockReturnValue(mockEd);

    Effect.runSync(adjustFontSize(-3));

    expect(mockFontSizeCompartment.reconfigure).toHaveBeenCalledOnce();
    expect(mockEd.dispatch).toHaveBeenCalledOnce();
    expect(updateAppSettings).toHaveBeenCalledWith({ editor: { fontSize: 13 } });
  });

  it("does nothing when editor() returns null", () => {
    vi.mocked(editor).mockReturnValue(null);

    Effect.runSync(adjustFontSize(2));

    expect(mockFontSizeCompartment.reconfigure).not.toHaveBeenCalled();
    expect(updateAppSettings).not.toHaveBeenCalled();
  });
});

describe("loadCode", () => {
  let savedShowOpenFilePicker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    savedShowOpenFilePicker = (window as any).showOpenFilePicker;
  });

  afterEach(() => {
    (window as any).showOpenFilePicker = savedShowOpenFilePicker;
  });

  it("reads a file and dispatches editor transaction", async () => {
    const mockEd = createMockEditor("old text");
    vi.mocked(editor).mockReturnValue(mockEd);

    const fileData = JSON.stringify({ text: "new code" });
    const mockFile = { text: vi.fn(() => Promise.resolve(fileData)) };
    const mockHandle = { getFile: vi.fn(() => Promise.resolve(mockFile)) };
    (window as any).showOpenFilePicker = vi.fn(() =>
      Promise.resolve([mockHandle]),
    );

    await Effect.runPromise(loadCode());

    expect((window as any).showOpenFilePicker).toHaveBeenCalledOnce();
    expect(mockHandle.getFile).toHaveBeenCalledOnce();
    expect(mockFile.text).toHaveBeenCalledOnce();
    expect(mockEd.state.update).toHaveBeenCalledWith({
      changes: { from: 0, to: 8, insert: "new code" },
    });
    expect(mockEd.dispatch).toHaveBeenCalledOnce();
  });

  it("does nothing when editor() returns null", async () => {
    vi.mocked(editor).mockReturnValue(null);
    (window as any).showOpenFilePicker = vi.fn();

    await Effect.runPromise(loadCode());

    expect((window as any).showOpenFilePicker).not.toHaveBeenCalled();
  });
});

describe("saveCode", () => {
  let savedShowSaveFilePicker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    savedShowSaveFilePicker = (window as any).showSaveFilePicker;
  });

  afterEach(() => {
    (window as any).showSaveFilePicker = savedShowSaveFilePicker;
  });

  it("saves editor content to a file via showSaveFilePicker", async () => {
    const mockEd = createMockEditor("(+ 1 2)");
    vi.mocked(editor).mockReturnValue(mockEd);

    const mockWritable = {
      write: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
    };
    const mockHandle = {
      createWritable: vi.fn(() => Promise.resolve(mockWritable)),
    };
    (window as any).showSaveFilePicker = vi.fn(() =>
      Promise.resolve(mockHandle),
    );

    await Effect.runPromise(saveCode());

    expect((window as any).showSaveFilePicker).toHaveBeenCalledOnce();
    const pickerOptions = (window as any).showSaveFilePicker.mock.calls[0][0];
    expect(pickerOptions.suggestedName).toBe("untitled.useq");
    expect(mockWritable.write).toHaveBeenCalledWith(
      JSON.stringify({ text: "(+ 1 2)", format_version: 1 }),
    );
    expect(mockWritable.close).toHaveBeenCalledOnce();
  });

  it("does nothing when editor() returns null", async () => {
    vi.mocked(editor).mockReturnValue(null);
    (window as any).showSaveFilePicker = vi.fn();

    await Effect.runPromise(saveCode());

    expect((window as any).showSaveFilePicker).not.toHaveBeenCalled();
  });
});
