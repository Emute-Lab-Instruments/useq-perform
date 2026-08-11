import { beforeEach, describe, expect, it } from "vitest";

import {
  clearBootstrapRecovery,
  showBootstrapRecovery,
} from "./bootstrapRecoverySurface.ts";

describe("bootstrap recovery surface", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders actionable diagnostics without depending on Solid", () => {
    showBootstrapRecovery({
      id: "wasm-worker",
      title: "Browser runtime ABI mismatch",
      message: "Hardware remains usable.",
      detail: "missing useq_eval",
    });

    const notice = document.getElementById("bootstrap-recovery-wasm-worker");
    expect(notice?.getAttribute("role")).toBe("alert");
    expect(notice?.textContent).toContain("Browser runtime ABI mismatch");
    expect(notice?.textContent).toContain("missing useq_eval");
    expect(notice?.querySelector("button")?.textContent).toBe("Reload application");

    clearBootstrapRecovery("wasm-worker");
    expect(document.getElementById("bootstrap-recovery-wasm-worker")).toBeNull();
  });
});
