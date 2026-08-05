import { describe, expect, it } from "vitest";

import {
  getConfigurationDiff,
  validateConfiguration,
} from "./configurationValidation";

describe("configuration validation", () => {
  it("reports missing required sections and invalid zero-valued bounds", () => {
    expect(validateConfiguration({ version: "1" }).errors).toContain(
      "Missing user field",
    );

    const result = validateConfiguration({
      version: "1",
      user: {
        editor: { fontSize: 0 },
        storage: { autoSaveInterval: 0 },
        ui: {},
        visualisation: { windowDuration: 10 },
      },
    });
    expect(result).toEqual({
      valid: false,
      errors: [
        "user.editor.fontSize must be a number between 8 and 32",
        "user.storage.autoSaveInterval must be a number >= 1000",
      ],
    });
  });

  it("describes only the user-facing fields that changed", () => {
    const differences = getConfigurationDiff(
      {
        user: {
          editor: { theme: "light", fontSize: 14 },
          visualisation: { windowDuration: 10, lineWidth: 2 },
        },
      },
      {
        user: {
          editor: { theme: "dark", fontSize: 14 },
          visualisation: { windowDuration: 8, lineWidth: 2 },
        },
      },
    );
    expect(differences).toEqual([
      "Theme: light → dark",
      "Visual Window: 10s → 8s",
    ]);
  });
});
