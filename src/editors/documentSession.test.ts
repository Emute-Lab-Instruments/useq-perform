import { history } from "@codemirror/commands";
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultUserSettings,
  mergeUserSettings,
} from "../lib/appSettings.ts";
import type {
  DocumentRecord,
  DocumentRecordRepository,
} from "../lib/documentRecord.ts";
import {
  captureDocumentSnapshot,
  createDocumentSession,
} from "./documentSession.ts";
import { computeDocumentFingerprint } from "./extensions/stateIdentity/identitySnapshot.ts";

function settings(overrides: Record<string, unknown> = {}) {
  return mergeUserSettings(createDefaultUserSettings(), overrides);
}

function createRepository(options: {
  loaded?: DocumentRecord | null;
  legacyIdentity?: unknown;
  saveResults?: boolean[];
} = {}): DocumentRecordRepository & { saves: DocumentRecord[] } {
  const saves: DocumentRecord[] = [];
  const saveResults = [...(options.saveResults ?? [])];
  return {
    saves,
    load: () => options.loaded ?? null,
    loadLegacyIdentity: () => options.legacyIdentity ?? null,
    save(record) {
      saves.push(record);
      return saveResults.shift() ?? true;
    },
  };
}

function createSession(
  repository: DocumentRecordRepository | null,
  initialText: string,
  settingsOverride: Record<string, unknown> = {},
) {
  return createDocumentSession({
    initialText,
    repository,
    settings: settings(settingsOverride),
    buildExtensions: ({ identityExtensions, sessionExtensions }) => [
      history(),
      ...clojureExtensions,
      ...identityExtensions,
      ...sessionExtensions,
    ],
  });
}

describe("DocumentSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists text and matching identity metadata as one initial record", () => {
    const repository = createRepository();
    const text = '(synth "osc/sine" :freq 440)\n';
    const session = createSession(repository, text);

    expect(repository.saves).toHaveLength(1);
    expect(repository.saves[0]?.text).toBe(text);
    expect(repository.saves[0]?.identities).toMatchObject({
      schemaVersion: 1,
      documentFingerprint: computeDocumentFingerprint(text),
    });
    expect(
      (repository.saves[0]?.identities as { entries: unknown[] }).entries,
    ).toHaveLength(1);

    session.dispose();
  });

  it("restores legacy identity only when no atomic record exists", () => {
    const text = '(synth "osc/sine" :freq 440)\n';
    const repository = createRepository({
      legacyIdentity: {
        schemaVersion: 1,
        documentFingerprint: computeDocumentFingerprint(text),
        entries: [{ id: "legacy-id", kind: "synth", formKey: [0] }],
      },
    });
    const session = createSession(repository, text);

    expect([...session.snapshot().identities.entries.values()][0]?.id).toBe(
      "legacy-id",
    );
    expect(
      (repository.saves[0]?.identities as { entries: Array<{ id: string }> })
        .entries[0]?.id,
    ).toBe("legacy-id");

    session.dispose();
  });

  it("coalesces keystrokes until the session-owned autosave interval", () => {
    const repository = createRepository();
    const session = createSession(repository, "(a1 0)\n", {
      storage: {
        saveCodeLocally: true,
        autoSaveEnabled: true,
        autoSaveInterval: 1_000,
      },
    });
    expect(repository.saves).toHaveLength(1);

    session.insertText("; one\n", session.snapshot().text.length);
    session.insertText("; two\n", session.snapshot().text.length);
    expect(repository.saves).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(repository.saves).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(repository.saves).toHaveLength(2);
    expect(repository.saves[1]?.text).toBe("(a1 0)\n; one\n; two\n");

    session.dispose();
  });

  it("publishes coherent revisions and retries a failed atomic flush", () => {
    const repository = createRepository({ saveResults: [false, true] });
    const session = createSession(repository, "(a1 0)\n", {
      storage: { autoSaveEnabled: false, saveCodeLocally: true },
    });
    const revisions: Array<{ revision: number; text: string }> = [];
    session.subscribe((snapshot) => {
      revisions.push({ revision: snapshot.revision, text: snapshot.text });
    });

    session.replaceText("(a1 1)\n");
    expect(revisions).toEqual([{ revision: 1, text: "(a1 1)\n" }]);
    expect(session.flush()).toBe(true);
    expect(repository.saves.at(-1)?.text).toBe("(a1 1)\n");

    const captured = captureDocumentSnapshot(session.view);
    expect(captured.state.doc.toString()).toBe(captured.text);
    expect(captured.revision).toBe(1);

    session.dispose();
  });

  it("keeps an ephemeral secondary session isolated from persistence", () => {
    const session = createSession(null, "(a1 0)\n");
    session.replaceText("(a1 1)\n");

    expect(session.flush()).toBe(false);
    expect(session.snapshot().text).toBe("(a1 1)\n");

    session.dispose();
  });
});
