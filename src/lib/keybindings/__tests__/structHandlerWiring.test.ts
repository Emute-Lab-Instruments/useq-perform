/**
 * Verify that the keybinding handler registry correctly maps edit.* action
 * names to the structural-editing adapter's dispatch names.
 *
 * This is a unit test of the mapping itself — it mocks the dispatcher and
 * verifies that calling each handler results in the correct dispatch name
 * being passed through.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock all heavy runtime imports before importing handlers.
vi.mock("../../../effects/editorEvaluation.ts", () => ({
  evaluate: vi.fn(() => true),
}));
vi.mock("../../../editors/editorKeyboard.ts", () => ({
  toggleHelp: vi.fn(() => true),
  toggleSerialVis: vi.fn(() => true),
  showDocumentationForSymbol: vi.fn(() => true),
}));
vi.mock("../../../editors/extensions/probes.ts", () => ({
  toggleCurrentProbe: vi.fn(() => true),
  expandCurrentProbeContext: vi.fn(() => true),
  contractCurrentProbeContext: vi.fn(() => true),
}));
vi.mock("../../../ui/keybindings/ActionPalette.tsx", () => ({
  openPalette: vi.fn(),
}));

vi.mock("../../../editors/extensions/structure/adapter/dispatcher.ts", () => ({
  dispatchAction: vi.fn(() => true),
}));

import { handlers } from "../handlers.ts";
import { dispatchAction } from "../../../editors/extensions/structure/adapter/dispatcher.ts";
import type { ActionId } from "../actions.ts";

const mockDispatchAction = vi.mocked(dispatchAction);

// Minimal mock for EditorView — handlers just pass it through.
const fakeView = {} as import("@codemirror/view").EditorView;

describe("edit.* handler → dispatcher name mapping", () => {
  beforeEach(() => {
    mockDispatchAction.mockClear();
  });

  const expectedMappings: Array<[ActionId, string]> = [
    ["edit.slurpFwd", "edit.slurpForward"],
    ["edit.slurpBack", "edit.slurpBackward"],
    ["edit.barfFwd", "edit.barfForward"],
    ["edit.barfBack", "edit.barfBackward"],
    ["edit.raise", "edit.raise"],
    ["edit.splice", "edit.splice"],
    ["edit.wrapList", "edit.encloseList"],
    ["edit.wrapVector", "edit.encloseVector"],
    ["edit.transposeFwd", "edit.transposeNext"],
    ["edit.transposeBack", "edit.transposePrev"],
  ];

  for (const [actionId, dispatchName] of expectedMappings) {
    it(`"${actionId}" dispatches as "${dispatchName}"`, () => {
      const handler = handlers[actionId];
      expect(handler).toBeDefined();
      // Call the handler with a fake EditorView.
      (handler as (view: import("@codemirror/view").EditorView) => boolean)(fakeView);
      expect(mockDispatchAction).toHaveBeenCalledWith(fakeView, dispatchName);
    });
  }

  it("all structural edit actions have handlers", () => {
    const structuralActions: ActionId[] = [
      "edit.slurpFwd",
      "edit.slurpBack",
      "edit.barfFwd",
      "edit.barfBack",
      "edit.raise",
      "edit.splice",
      "edit.wrapList",
      "edit.wrapVector",
      "edit.transposeFwd",
      "edit.transposeBack",
    ];
    for (const id of structuralActions) {
      expect(handlers[id]).toBeDefined();
    }
  });
});
