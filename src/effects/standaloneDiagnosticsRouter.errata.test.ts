import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { standaloneDiagnostics } from "../contracts/runtimeChannels.ts";
import {
  initStandaloneDiagnosticsRouter,
  teardownStandaloneDiagnosticsRouter,
} from "./standaloneDiagnosticsRouter.ts";

afterEach(teardownStandaloneDiagnosticsRouter);

describe("standalone diagnostics range behavior", () => {
  it("adds unsolicited diagnostics without clearing eval ranges", () => {
    const view = {} as EditorView;
    const pushDiagnostics = vi.fn();
    initStandaloneDiagnosticsRouter({ getEditor: () => view, pushDiagnostics });

    standaloneDiagnostics.publish({ diagnostics: [{
      start: 12,
      end: 17,
      severity: "warning",
      message: "firmware warning",
    }] });

    expect(pushDiagnostics).toHaveBeenCalledWith(
      view,
      expect.any(Array),
      0,
      0,
      0,
      false,
    );
  });
});
