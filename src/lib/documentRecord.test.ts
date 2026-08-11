import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDocumentRecordRepository,
  readDocumentRecordText,
} from "./documentRecord.ts";
import { PERSISTENCE_KEYS } from "./persistence.ts";

function installMockStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
  });
  return { store, storage };
}

describe("DocumentRecord persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("retires split current-editor keys only after an atomic write succeeds", () => {
    const { store } = installMockStorage();
    store.set(PERSISTENCE_KEYS.editorCode, "old text");
    store.set(PERSISTENCE_KEYS.editorIdentity, JSON.stringify({ old: true }));

    const saved = createDocumentRecordRepository().save({
      schemaVersion: 1,
      text: "new text",
      identities: { schemaVersion: 1 },
    });

    expect(saved).toBe(true);
    expect(readDocumentRecordText()).toBe("new text");
    expect(store.has(PERSISTENCE_KEYS.editorCode)).toBe(false);
    expect(store.has(PERSISTENCE_KEYS.editorIdentity)).toBe(false);
    expect(JSON.parse(store.get(PERSISTENCE_KEYS.legacyCode) ?? "null")).toBe(
      "new text",
    );
  });

  it("preserves legacy inputs when the atomic write fails", () => {
    const { store, storage } = installMockStorage();
    store.set(PERSISTENCE_KEYS.editorCode, "recover me");
    store.set(PERSISTENCE_KEYS.editorIdentity, JSON.stringify({ keep: true }));
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === PERSISTENCE_KEYS.editorDocument) throw new Error("quota");
      store.set(key, String(value));
    });

    const saved = createDocumentRecordRepository().save({
      schemaVersion: 1,
      text: "new text",
      identities: null,
    });

    expect(saved).toBe(false);
    expect(store.get(PERSISTENCE_KEYS.editorCode)).toBe("recover me");
    expect(store.has(PERSISTENCE_KEYS.editorIdentity)).toBe(true);
  });

  it("does not migrate or retire anything under ?nosave", () => {
    const { store } = installMockStorage();
    store.set(PERSISTENCE_KEYS.editorCode, "recover me");
    window.history.replaceState({}, "", "/?nosave");

    expect(
      createDocumentRecordRepository().save({
        schemaVersion: 1,
        text: "blocked",
        identities: null,
      }),
    ).toBe(false);
    expect(store.get(PERSISTENCE_KEYS.editorCode)).toBe("recover me");
    expect(store.has(PERSISTENCE_KEYS.editorDocument)).toBe(false);
  });

  it("warns and rejects an unsupported canonical record", () => {
    const { store } = installMockStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.set(
      PERSISTENCE_KEYS.editorDocument,
      JSON.stringify({ schemaVersion: 99, text: "future text" }),
    );

    expect(createDocumentRecordRepository().load()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring unsupported"),
    );
  });
});
