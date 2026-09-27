import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { hwInput } from "../contracts/hardwareChannels.ts";

const mocks = vi.hoisted(() => ({
  view: null as EditorView | null,
  dispatch: vi.fn(async () => ({
    session: { transportMode: "both" },
    wasm: { status: "fulfilled", value: { result: "ok", diagnostics: [], synthArtifacts: null } },
    hardware: { status: "fulfilled", value: { success: true, result: "ok", diagnostics: [] } },
    diagnosticAuthority: "hardware",
  })),
}));

vi.mock("../lib/editorStore.ts", () => ({ editor: () => mocks.view }));
vi.mock("../runtime/runtimeCodeEvaluation.ts", () => ({
  dispatchRuntimeCodeEvaluation: mocks.dispatch,
}));
vi.mock("../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: () => ({ hardware: { bindingsEnabled: true, bindingQueueDepth: 4 } }),
}));
vi.mock("../utils/consoleStore.ts", () => ({ post: vi.fn() }));

const { createHardwareBindingDispatcher } = await import("./hardwareBindingDispatcher.ts");

describe("hardware binding runtime dispatch", () => {
  afterEach(() => {
    mocks.view?.destroy();
    mocks.view = null;
    vi.clearAllMocks();
  });

  it("routes the bound expression through runtime-owned ordered evaluation", async () => {
    mocks.view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: "(on-press :sw1 (setbpm 120))" }),
    });
    const dispatcher = createHardwareBindingDispatcher({
      syncChips: vi.fn(),
      setFireCallback: vi.fn(),
    });

    hwInput.publish({ kind: "button", id: "sw1", state: "pressed", ts: 10 });
    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce());

    expect(mocks.dispatch).toHaveBeenCalledWith({
      code: "@(setbpm 120)",
      wasmCode: "(setbpm 120)",
      binding: true,
    });
    dispatcher.dispose();
  });
});
