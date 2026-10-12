import { describe, expect, it } from "vitest";
import { bootstrapFailure } from "./contracts/runtimeChannels";
import { handleBootstrapFailure } from "./main";

describe("bootstrap failure recovery", () => {
  it("publishes the entry-point failure for the installed recovery surface", () => {
    document.body.innerHTML = "<main></main>";
    const failures: string[] = [];
    const unsubscribe = bootstrapFailure.subscribe(({ scope }) => failures.push(scope));

    handleBootstrapFailure(new Error("environment probe failed"));

    expect(failures).toContain("bootstrap");
    expect(document.getElementById("bootstrap-recovery-failure-bootstrap")).not.toBeNull();
    expect(document.body.textContent).toContain("environment probe failed");
    unsubscribe();
  });
});
