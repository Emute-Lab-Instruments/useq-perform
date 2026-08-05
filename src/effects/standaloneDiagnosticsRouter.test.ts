import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { standaloneDiagnostics } from "../contracts/runtimeChannels.ts";
import {
  initStandaloneDiagnosticsRouter,
  teardownStandaloneDiagnosticsRouter,
} from "./standaloneDiagnosticsRouter.ts";

const diagnostic = {
  severity: "warning" as const,
  category: "runtime",
  start: 1,
  end: 2,
  message: "runtime warning",
};

afterEach(() => {
  teardownStandaloneDiagnosticsRouter();
});

describe("standalone diagnostics router", () => {
  it("routes non-empty frames through its injected editor boundary", () => {
    const view = {} as EditorView;
    const pushDiagnostics = vi.fn();

    initStandaloneDiagnosticsRouter({
      getEditor: () => view,
      pushDiagnostics,
    });
    standaloneDiagnostics.publish({ diagnostics: [diagnostic] });

    expect(pushDiagnostics).toHaveBeenCalledOnce();
    expect(pushDiagnostics).toHaveBeenCalledWith(view, [diagnostic]);
  });

  it("ignores frames when there is no active editor", () => {
    const pushDiagnostics = vi.fn();

    initStandaloneDiagnosticsRouter({
      getEditor: () => null,
      pushDiagnostics,
    });
    standaloneDiagnostics.publish({ diagnostics: [diagnostic] });

    expect(pushDiagnostics).not.toHaveBeenCalled();
  });
});
