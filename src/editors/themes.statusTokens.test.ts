// Focused tests for the semantic status tokens injected by themes.ts
// (docs/specs/themes.md §1.5): every theme application must publish
// --status-ok/--status-warn/--status-error/--status-info/--on-accent on the
// document root, with light themes receiving darker, readable variants.
import { describe, expect, it, beforeEach } from "vitest";
import { setMainEditorTheme, themeSpecsByName } from "./themes.ts";

function rootStyle(): CSSStyleDeclaration {
  return document.documentElement.style;
}

function statusTokenSnapshot(): Record<string, string> {
  const names = [
    "--status-ok",
    "--status-warn",
    "--status-error",
    "--status-info",
    "--on-accent",
  ];
  return Object.fromEntries(
    names.map((name) => [name, rootStyle().getPropertyValue(name)]),
  );
}

describe("theme status tokens", () => {
  beforeEach(() => {
    rootStyle().cssText = "";
  });

  it("catalogue contains both variants to derive tokens from", () => {
    const specs = Object.values(themeSpecsByName);
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.some((s) => s.variant === "dark")).toBe(true);
    expect(specs.some((s) => s.variant === "light")).toBe(true);
  });

  it("dark themes publish bright status tokens", () => {
    const dark = Object.values(themeSpecsByName).find(
      (s) => s.variant === "dark",
    )!;
    setMainEditorTheme(dark.name);

    expect(statusTokenSnapshot()).toEqual({
      "--status-ok": "#4ec9a0",
      "--status-warn": "#ffb454",
      "--status-error": "#ff6b6b",
      "--status-info": "#7aa2f7",
      "--on-accent": "#10131a",
    });
  });

  it("light themes publish darker, readable status tokens", () => {
    const light = Object.values(themeSpecsByName).find(
      (s) => s.variant === "light",
    )!;
    setMainEditorTheme(light.name);

    const tokens = statusTokenSnapshot();
    expect(tokens["--status-ok"]).toBe("#1a7f4b");
    expect(tokens["--status-warn"]).toBe("#b45309");
    expect(tokens["--status-error"]).toBe("#c62828");
    expect(tokens["--status-info"]).toBe("#1d4ed8");
    // Text on an accent-filled surface flips to white for light themes.
    expect(tokens["--on-accent"]).toBe("#ffffff");
  });

  it("switching themes swaps the token set (hot theme switch)", () => {
    const dark = Object.values(themeSpecsByName).find(
      (s) => s.variant === "dark",
    )!;
    const light = Object.values(themeSpecsByName).find(
      (s) => s.variant === "light",
    )!;

    setMainEditorTheme(dark.name);
    const darkError = rootStyle().getPropertyValue("--status-error");
    setMainEditorTheme(light.name);
    const lightError = rootStyle().getPropertyValue("--status-error");

    expect(lightError).not.toBe(darkError);
    expect(lightError).toBe("#c62828");
  });
});
