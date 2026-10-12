import { afterEach, describe, expect, it } from "vitest";

import { setLiveBindingsProvider } from "../../lib/keybindings/liveBindings";
import type { KeyBinding } from "../../lib/keybindings/defaults";
import { buildSections } from "./KeybindingsTab";

afterEach(() => setLiveBindingsProvider(() => []));

describe("KeybindingsTab", () => {
  it("lists the active resolved key rather than static defaults", () => {
    const bindings: KeyBinding[] = [
      { action: "eval.now", key: "Ctrl-Shift-7" },
    ];
    setLiveBindingsProvider(() => bindings);

    expect(buildSections()).toEqual([
      { title: "Evaluation", bindings: [{ description: "Evaluate top-level expression", key: "Ctrl-Shift-7" }] },
    ]);
  });
});
