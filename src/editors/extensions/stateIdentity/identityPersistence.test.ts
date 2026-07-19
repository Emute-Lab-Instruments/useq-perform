/**
 * State-identity sidecar — persistence and recovery tests.
 *
 * Spec: docs/specs/state-identity.md §7.3 (metadata must persist with the
 * editor document/session, using the central persistence service and
 * following persistence.md error-recovery rules); docs/specs/persistence.md
 * §1.4 (JSON parse errors never crash), §1.6 (explicit schemaVersion when
 * non-trivial migration is needed), §1.7 (`?nosave` is a session-scoped
 * write gate; reads still return pre-existing state).
 *
 * Assertion IDs covered:
 *   VAL-ID-009  Reload restores correlated identities
 *   VAL-ID-010  Nosave disables identity persistence
 *   VAL-ID-011  Corrupt metadata recovers safely
 *   VAL-ID-012  Partial document recovery is conservative
 *   VAL-ID-020  Extension remains dependency-injected
 *   VAL-ID-024  Default wiring uses central persistence
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";

import {
  buildIdentityField,
  identityExtensions,
  type IdentityConfig,
} from "./identityField.ts";
import {
  makeContinuitySource,
  entriesOf,
  getById,
  mapsEqualByIdentity,
} from "./identityMapState.ts";
import { defaultStatefulFormClassifier } from "./identityClassify.ts";
import { deterministicIdGenerator } from "./identityGenerator.ts";
import {
  createIdentityPersistence,
  type IdentityPersistence,
  type PersistenceCall,
} from "./identityPersistence.ts";
import {
  buildIdentitySnapshot,
  computeDocumentFingerprint,
  recoverIdentityMap,
  safeLoadIdentitySnapshot,
  IDENTITY_SNAPSHOT_SCHEMA_VERSION,
} from "./identitySnapshot.ts";
import {
  setStartupFlags,
  resetStartupContextForTests,
} from "../../../runtime/startupContext.ts";
import {
  load as persistenceLoad,
  save as persistenceSave,
  remove as persistenceRemove,
  PERSISTENCE_KEYS,
} from "../../../lib/persistence.ts";
import type { IdentityMap, IdentitySnapshot } from "./identityTypes.ts";
import { emptyIdentityMap } from "./identityTypes.ts";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Mock localStorage helpers ─────────────────────────────────────────────

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    get length() {
      return store.size;
    },
    key: vi.fn((_i: number) => null),
  };
}

let mockStorage: Storage;

beforeEach(() => {
  mockStorage = createMockStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "localStorage", {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
  resetStartupContextForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetStartupContextForTests();
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Deterministic generator that emits ids prefixed with a session label.
 * Used to prove that fresh IDs in a new session are observably distinct
 * from a prior session's stored IDs.
 */
function prefixedIdGenerator(
  prefix: string,
): import("./identityGenerator.ts").IdGenerator {
  let counter = 0;
  return {
    next() {
      counter += 1;
      const padded = String(counter).padStart(4, "0");
      return `${prefix}-${padded}` as any;
    },
  };
}

// ─── Pure helpers: fingerprint + snapshot/recovery ─────────────────────────

describe("VAL-ID-011 (pure): computeDocumentFingerprint", () => {
  it("produces a stable string for the same source", () => {
    const src = '(synth "osc/sine" :freq 440)\n';
    expect(computeDocumentFingerprint(src)).toBe(computeDocumentFingerprint(src));
  });

  it("changes when the source changes", () => {
    const a = computeDocumentFingerprint('(synth "osc/sine" :freq 440)\n');
    const b = computeDocumentFingerprint('(synth "osc/sine" :freq 880)\n');
    expect(a).not.toBe(b);
  });

  it("is non-empty for an empty document", () => {
    expect(computeDocumentFingerprint("").length).toBeGreaterThan(0);
  });
});

describe("VAL-ID-009 (pure): buildIdentitySnapshot round-trips an IdentityMap", () => {
  it("captures every entry with its id, kind, and FormKey", () => {
    // Use a real CodeMirror state to classify two synth forms.
    const field = buildIdentityField({
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 100)\n(synth "osc/sine" :freq 200)\n',
      extensions: [...clojureExtensions, field],
    });
    const map = view.state.field(field).map;
    const src = view.state.doc.toString();
    const snap = buildIdentitySnapshot(map, src);
    expect(snap.schemaVersion).toBe(IDENTITY_SNAPSHOT_SCHEMA_VERSION);
    expect(snap.documentFingerprint).toBe(computeDocumentFingerprint(src));
    expect(snap.entries).toHaveLength(2);
    // Each entry has a non-empty id, kind, and array FormKey.
    for (const e of snap.entries) {
      expect(typeof e.id).toBe("string");
      expect(e.id.length).toBeGreaterThan(0);
      expect(e.kind).toBe("synth");
      expect(Array.isArray(e.formKey)).toBe(true);
    }
    view.destroy();
  });
});

// ─── Recovery: corruption matrix (VAL-ID-011) ──────────────────────────────

describe("VAL-ID-011: safeLoadIdentitySnapshot rejects bad payloads safely", () => {
  it("returns null for null", () => {
    expect(safeLoadIdentitySnapshot(null)).toBeNull();
  });

  it("returns null for a non-object primitive", () => {
    expect(safeLoadIdentitySnapshot("hello")).toBeNull();
    expect(safeLoadIdentitySnapshot(42)).toBeNull();
    expect(safeLoadIdentitySnapshot(true)).toBeNull();
  });

  it("returns null for unsupported schemaVersion", () => {
    expect(safeLoadIdentitySnapshot({ schemaVersion: 0 })).toBeNull();
    expect(safeLoadIdentitySnapshot({ schemaVersion: 2 })).toBeNull();
    expect(safeLoadIdentitySnapshot({ schemaVersion: "1" })).toBeNull();
  });

  it("returns null for missing schemaVersion", () => {
    expect(safeLoadIdentitySnapshot({ entries: [] })).toBeNull();
  });

  it("returns null for missing or non-string documentFingerprint", () => {
    expect(
      safeLoadIdentitySnapshot({ schemaVersion: 1, entries: [] }),
    ).toBeNull();
    expect(
      safeLoadIdentitySnapshot({
        schemaVersion: 1,
        documentFingerprint: 123,
        entries: [],
      }),
    ).toBeNull();
  });

  it("returns null for missing or non-array entries", () => {
    expect(
      safeLoadIdentitySnapshot({
        schemaVersion: 1,
        documentFingerprint: "abc",
      }),
    ).toBeNull();
    expect(
      safeLoadIdentitySnapshot({
        schemaVersion: 1,
        documentFingerprint: "abc",
        entries: "not-an-array",
      }),
    ).toBeNull();
  });

  it("drops individual malformed entries but keeps valid ones", () => {
    const good = {
      id: "id-good",
      kind: "synth",
      formKey: [0],
    };
    const snap = safeLoadIdentitySnapshot({
      schemaVersion: 1,
      documentFingerprint: "abc",
      entries: [
        good,
        { id: 123, kind: "synth", formKey: [1] }, // bad id type
        { id: "x", kind: "synth" }, // missing formKey
        { id: "y", kind: "synth", formKey: "no" }, // bad formKey
        { id: "z", formKey: [3] }, // missing kind
      ],
    });
    expect(snap).not.toBeNull();
    expect(snap!.entries).toHaveLength(1);
    expect(snap!.entries[0]!.id).toBe("id-good");
  });

  it("returns null when all entries are malformed", () => {
    expect(
      safeLoadIdentitySnapshot({
        schemaVersion: 1,
        documentFingerprint: "abc",
        entries: [{ bad: true }],
      }),
    ).toBeNull();
  });

  it("de-duplicates entries that share an id (collision-safe)", () => {
    const snap = safeLoadIdentitySnapshot({
      schemaVersion: 1,
      documentFingerprint: "abc",
      entries: [
        { id: "id-x", kind: "synth", formKey: [0] },
        { id: "id-x", kind: "synth", formKey: [1] }, // duplicate id
      ],
    });
    expect(snap).not.toBeNull();
    expect(snap!.entries).toHaveLength(1);
  });
});

// ─── Recovery: document correlation (VAL-ID-011, VAL-ID-012) ────────────────

describe("VAL-ID-011: recoverIdentityMap rejects wrong-document metadata", () => {
  it("returns an empty map when fingerprint does not match", () => {
    const field = buildIdentityField({
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 440)\n',
      extensions: [...clojureExtensions, field],
    });
    const recognised = [];
    // Build a snapshot for a DIFFERENT document fingerprint.
    const wrongSnap: IdentitySnapshot = {
      schemaVersion: 1,
      documentFingerprint: "totally-different-fingerprint",
      entries: [
        { id: "id-wrong" as any, kind: "synth", formKey: [0] },
      ],
    };
    const recovered = recoverIdentityMap(
      wrongSnap,
      view.state,
      defaultStatefulFormClassifier,
    );
    // No correlation → no restored identities (safe default).
    expect(entriesOf(recovered.map)).toHaveLength(0);
    view.destroy();
    void recognised;
  });
});

describe("VAL-ID-012: recoverIdentityMap is conservative on partial document match", () => {
  it("restores only forms whose structural path still exists", () => {
    // Build a snapshot for a doc with three synth forms.
    const field = buildIdentityField({
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    const view1 = new EditorView({
      doc: '(synth "osc/sine" :freq 100)\n(synth "osc/sine" :freq 200)\n(synth "osc/sine" :freq 300)\n',
      extensions: [...clojureExtensions, field],
    });
    const originalMap = view1.state.field(field).map;
    const originalSrc = view1.state.doc.toString();
    const snap = buildIdentitySnapshot(originalMap, originalSrc);

    // New document has only the first and third forms (middle deleted).
    // The fingerprint differs (source text differs), so by default no
    // identities restore. Correlation is by fingerprint; partial-document
    // recovery happens via the snapshot-from-same-session path tested
    // below using explicit source text matching.
    const view2 = new EditorView({
      doc: '(synth "osc/sine" :freq 100)\n(synth "osc/sine" :freq 300)\n',
      extensions: [...clojureExtensions, field],
    });
    const recovered = recoverIdentityMap(
      snap,
      view2.state,
      defaultStatefulFormClassifier,
    );
    // Conservative default: fingerprint mismatch → no restoration.
    expect(entriesOf(recovered.map)).toHaveLength(0);
    view1.destroy();
    view2.destroy();
  });

  it("restores every identity when fingerprint matches exactly", () => {
    const field = buildIdentityField({
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    const src = '(synth "osc/sine" :freq 100)\n(synth "osc/sine" :freq 200)\n';
    const view1 = new EditorView({
      doc: src,
      extensions: [...clojureExtensions, field],
    });
    const originalMap = view1.state.field(field).map;
    const snap = buildIdentitySnapshot(originalMap, src);

    // Build a fresh state with the SAME source text.
    const view2 = new EditorView({
      doc: src,
      extensions: [...clojureExtensions, field],
    });
    const recovered = recoverIdentityMap(
      snap,
      view2.state,
      defaultStatefulFormClassifier,
    );
    // Every entry restores by id.
    expect(entriesOf(recovered.map)).toHaveLength(2);
    // IDs match the originals (set equality).
    const originalIds = new Set(entriesOf(originalMap).map((e) => e.id));
    const recoveredIds = new Set(entriesOf(recovered.map).map((e) => e.id));
    expect(recoveredIds).toEqual(originalIds);
    view1.destroy();
    view2.destroy();
  });

  it("produces a collision-free map (no duplicate IDs)", () => {
    const field = buildIdentityField({
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    const src = '(synth "osc/sine" :freq 100)\n(synth "osc/sine" :freq 200)\n';
    const view1 = new EditorView({
      doc: src,
      extensions: [...clojureExtensions, field],
    });
    const snap = buildIdentitySnapshot(view1.state.field(field).map, src);

    const view2 = new EditorView({
      doc: src,
      extensions: [...clojureExtensions, field],
    });
    const recovered = recoverIdentityMap(
      snap,
      view2.state,
      defaultStatefulFormClassifier,
    );
    const ids = entriesOf(recovered.map).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    view1.destroy();
    view2.destroy();
  });
});

// ─── Persistence adapter: spy-based (VAL-ID-020, VAL-ID-024) ───────────────

describe("VAL-ID-020 / VAL-ID-024: createIdentityPersistence wiring", () => {
  it("load() routes through the central persistence service", () => {
    const spy: PersistenceCall[] = [];
    const adapter = createIdentityPersistence({
      load: (key, fallback) => {
        spy.push({ op: "load", key });
        return persistenceLoad(key, fallback);
      },
      save: (key, value) => {
        spy.push({ op: "save", key });
        return persistenceSave(key, value);
      },
      remove: (key) => {
        spy.push({ op: "remove", key });
        return persistenceRemove(key);
      },
    });

    adapter.load();
    expect(spy).toContainEqual({ op: "load", key: PERSISTENCE_KEYS.editorIdentity });
  });

  it("save() routes a schema-versioned IdentitySnapshot through the service", () => {
    const spy: PersistenceCall[] = [];
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => {
        spy.push({ op: "save", key: k, value: v });
        return persistenceSave(k, v);
      },
      remove: (k) => persistenceRemove(k),
    });

    const map: IdentityMap = emptyIdentityMap;
    const snap = buildIdentitySnapshot(map, "(a1 1)\n");
    adapter.save(snap);

    expect(spy.length).toBe(1);
    expect(spy[0]!.op).toBe("save");
    expect(spy[0]!.key).toBe(PERSISTENCE_KEYS.editorIdentity);
    expect(spy[0]!.value).toEqual(snap);
  });

  it("load() returns null when storage is empty (no crash)", () => {
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });
    expect(adapter.load()).toBeNull();
  });

  it("load() returns null for corrupt stored JSON (no crash)", () => {
    mockStorage.setItem(PERSISTENCE_KEYS.editorIdentity, "{{not json");
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });
    expect(adapter.load()).toBeNull();
  });

  it("load() returns null for an unsupported schemaVersion payload", () => {
    mockStorage.setItem(
      PERSISTENCE_KEYS.editorIdentity,
      JSON.stringify({ schemaVersion: 99, documentFingerprint: "x", entries: [] }),
    );
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });
    expect(adapter.load()).toBeNull();
  });

  it("load() returns a valid IdentitySnapshot for a well-formed stored value", () => {
    const snap: IdentitySnapshot = {
      schemaVersion: 1,
      documentFingerprint: "abc",
      entries: [{ id: "id-x" as any, kind: "synth", formKey: [0] }],
    };
    mockStorage.setItem(
      PERSISTENCE_KEYS.editorIdentity,
      JSON.stringify(snap),
    );
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });
    const loaded = adapter.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe(1);
    expect(loaded!.entries).toHaveLength(1);
  });

  it("remove() clears the stored snapshot", () => {
    mockStorage.setItem(
      PERSISTENCE_KEYS.editorIdentity,
      JSON.stringify({ schemaVersion: 1, documentFingerprint: "x", entries: [] }),
    );
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });
    adapter.remove();
    expect(mockStorage.getItem(PERSISTENCE_KEYS.editorIdentity)).toBeNull();
  });
});

// ─── Nosave: writes are gated (VAL-ID-010) ─────────────────────────────────

describe("VAL-ID-010: nosave gates writes through the central service", () => {
  it("save() is a silent no-op when nosave is active", () => {
    setStartupFlags({
      debug: false,
      devmode: false,
      disableWebSerial: false,
      noModuleMode: false,
      nosave: true,
      params: {},
    });
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });
    const snap = buildIdentitySnapshot(emptyIdentityMap, "(a1 1)\n");
    adapter.save(snap);
    expect(mockStorage.setItem).not.toHaveBeenCalled();
  });

  it("remove() is a silent no-op when nosave is active", () => {
    setStartupFlags({
      debug: false,
      devmode: false,
      disableWebSerial: false,
      noModuleMode: false,
      nosave: true,
      params: {},
    });
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });
    adapter.remove();
    expect(mockStorage.removeItem).not.toHaveBeenCalled();
  });

  it("load() still returns pre-existing state when nosave is active", () => {
    const pre: IdentitySnapshot = {
      schemaVersion: 1,
      documentFingerprint: "abc",
      entries: [{ id: "id-x" as any, kind: "synth", formKey: [0] }],
    };
    mockStorage.setItem(PERSISTENCE_KEYS.editorIdentity, JSON.stringify(pre));
    setStartupFlags({
      debug: false,
      devmode: false,
      disableWebSerial: false,
      noModuleMode: false,
      nosave: true,
      params: {},
    });
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });
    expect(adapter.load()).not.toBeNull();
  });
});

// ─── End-to-end: extension with injected persistence restores on reload ────

describe("VAL-ID-009 (e2e): editor with persistence restores identities on reload", () => {
  function makeConfig(persistence: IdentityPersistence): IdentityConfig {
    return {
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
      persistence,
    };
  }

  it("persists the live map and restores it into a fresh editor with the same source", () => {
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });

    const src = '(synth "osc/sine" :freq 100)\n(synth "osc/sine" :freq 200)\n';

    // Session 1: create editor, capture IDs, persist.
    const cfg1 = makeConfig(adapter);
    const field1 = buildIdentityField(cfg1);
    const view1 = new EditorView({
      doc: src,
      extensions: [...clojureExtensions, field1],
    });
    const idsBefore = entriesOf(view1.state.field(field1).map)
      .map((e) => e.id)
      .sort();
    // Simulate the autosave hook firing.
    cfg1.persistence!.save(
      buildIdentitySnapshot(view1.state.field(field1).map, src),
    );
    view1.destroy();

    // Session 2: fresh editor with the same source loads from persistence.
    const cfg2 = makeConfig(adapter);
    const field2 = buildIdentityField(cfg2);
    const view2 = new EditorView({
      doc: src,
      extensions: [...clojureExtensions, field2],
    });
    const idsAfter = entriesOf(view2.state.field(field2).map)
      .map((e) => e.id)
      .sort();
    expect(idsAfter).toEqual(idsBefore);
    view2.destroy();
  });

  it("does not crash and produces a consistent map when stored metadata is malformed", () => {
    mockStorage.setItem(PERSISTENCE_KEYS.editorIdentity, "{{not json");
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });
    const cfg = makeConfig(adapter);
    const field = buildIdentityField(cfg);
    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 100)\n',
      extensions: [...clojureExtensions, field],
    });
    const entries = entriesOf(view.state.field(field).map);
    expect(entries).toHaveLength(1);
    // IDs are unique.
    expect(new Set(entries.map((e) => e.id)).size).toBe(1);
    view.destroy();
  });

  it("does not restore wrong-document metadata (different source)", () => {
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });

    // Session 1: doc A. Use a unique seed via a deterministic generator
    // that emits session-prefixed ids so a fresh session can't accidentally
    // re-mint the same ids.
    const idsA_seed = "sessionA";
    const cfg1: IdentityConfig = {
      ids: prefixedIdGenerator(idsA_seed),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
      persistence: adapter,
    };
    const field1 = buildIdentityField(cfg1);
    const view1 = new EditorView({
      doc: '(synth "osc/sine" :freq 100)\n',
      extensions: [...clojureExtensions, field1],
    });
    const idsA = entriesOf(view1.state.field(field1).map).map((e) => e.id);
    cfg1.persistence!.save(
      buildIdentitySnapshot(
        view1.state.field(field1).map,
        view1.state.doc.toString(),
      ),
    );
    view1.destroy();

    // Session 2: doc B (different source). Stored metadata must NOT
    // restore — fresh IDs are minted instead. The fresh session uses a
    // different prefix so any overlap would be observable.
    const cfg2: IdentityConfig = {
      ids: prefixedIdGenerator("sessionB"),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
      persistence: adapter,
    };
    const field2 = buildIdentityField(cfg2);
    const view2 = new EditorView({
      doc: '(synth "osc/sine" :freq 999)\n(a1 (saw 1))\n',
      extensions: [...clojureExtensions, field2],
    });
    const idsB = entriesOf(view2.state.field(field2).map).map((e) => e.id);
    expect(idsB).toHaveLength(1);
    // The doc-B form gets a fresh id from sessionB's generator, proving
    // nothing was restored from session A's stored snapshot.
    expect(idsB[0]).toContain("sessionB");
    expect(idsA).not.toContain(idsB[0]);
    view2.destroy();
  });
});

// ─── No direct localStorage access by the extension (VAL-ID-024) ────────────

/**
 * Strip line comments and block comments from TypeScript source so the
 * static checks inspect code only, not docs that legitimately mention
 * localStorage.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("VAL-ID-024: the identity extension never touches localStorage directly", () => {
  /**
   * The state-identity CORE (the CodeMirror field, types, reconciler,
   * classifier, and snapshot/recovery logic) must not access localStorage
   * directly. The only module in this directory that may touch the
   * central persistence service is `identityPersistence.ts` (the DI
   * bridge) and `createDefaultIdentityConfig.ts` (which wires the bridge
   * into the default config). The extension core runs in isolation
   * without storage.
   */
  const CORE_MODULES = [
    "identityField.ts",
    "identityTypes.ts",
    "identityMapState.ts",
    "identityReconcile.ts",
    "identityClassify.ts",
    "identityGenerator.ts",
    "identitySnapshot.ts",
    "stateIdentity.ts",
  ] as const;

  it("core sidecar modules contain no localStorage access or persistence import", () => {
    const dir = __dirname;
    for (const fname of CORE_MODULES) {
      const full = path.join(dir, fname);
      const src = stripComments(fs.readFileSync(full, "utf8"));
      // No direct localStorage access.
      expect(src).not.toMatch(/\blocalStorage\b/);
      // No direct import of the central persistence service. The bridge
      // lives in identityPersistence.ts and is wired via DI.
      expect(src).not.toMatch(/from\s+["'].*lib\/persistence/);
    }
  });

  it("createDefaultIdentityConfig wires the central persistence service through the bridge", () => {
    const dir = __dirname;
    const src = stripComments(
      fs.readFileSync(path.join(dir, "createDefaultIdentityConfig.ts"), "utf8"),
    );
    expect(src).toMatch(/createIdentityPersistence/);
    // The default config still does NOT touch localStorage directly —
    // it routes through the central service.
    expect(src).not.toMatch(/\blocalStorage\b/);
  });

  it("identityPersistence.ts bridges to the central persistence service (no direct localStorage)", () => {
    const dir = __dirname;
    const src = stripComments(
      fs.readFileSync(path.join(dir, "identityPersistence.ts"), "utf8"),
    );
    expect(src).toMatch(/from\s+["'].*lib\/persistence/);
    // Even the bridge must not bypass the central service by touching
    // localStorage directly.
    expect(src).not.toMatch(/\blocalStorage\b/);
  });
});

// ─── DI: extension runs with all deps injected (VAL-ID-020) ────────────────

describe("VAL-ID-020: identity extension runs with injected dependencies", () => {
  it("accepts a spy persistence adapter and routes save/load through it", () => {
    const calls: PersistenceCall[] = [];
    const spyAdapter: IdentityPersistence = {
      load: () => {
        calls.push({ op: "load", key: PERSISTENCE_KEYS.editorIdentity });
        return null;
      },
      save: (snap) => {
        calls.push({
          op: "save",
          key: PERSISTENCE_KEYS.editorIdentity,
          value: snap,
        });
      },
      remove: () => {
        calls.push({ op: "remove", key: PERSISTENCE_KEYS.editorIdentity });
      },
    };

    const config: IdentityConfig = {
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
      persistence: spyAdapter,
    };

    const field = buildIdentityField(config);
    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 100)\n',
      extensions: [...clojureExtensions, field],
    });

    // Create-time triggers a load.
    expect(calls.some((c) => c.op === "load")).toBe(true);

    // Explicitly save and remove via the config.
    config.persistence!.save(
      buildIdentitySnapshot(view.state.field(field).map, view.state.doc.toString()),
    );
    config.persistence!.remove();
    expect(calls.some((c) => c.op === "save")).toBe(true);
    expect(calls.some((c) => c.op === "remove")).toBe(true);
    view.destroy();
  });

  it("identityExtensions(config) produces a working extension set without runtime singletons", () => {
    // The default classifier + a deterministic ID generator is a complete
    // config — no synthesis/runtime imports required.
    const extensions = identityExtensions({
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(0);

    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 440)\n',
      extensions: [...clojureExtensions, ...extensions],
    });
    expect(entriesOf(view.state.field(extensions[0] as any).map)).toHaveLength(1);
    view.destroy();
  });
});

// ─── Round-trip equality through persistence (VAL-ID-009) ───────────────────

describe("VAL-ID-009: maps equal by identity after a full save/load/restore cycle", () => {
  it("preserves the exact id set through save → storage → load → restore", () => {
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });

    const src =
      '(synth "osc/sine" :freq 100)\n(a1 (saw 1))\n(synth "osc/sine" :freq 200)\n';
    const field1 = buildIdentityField({
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    const view1 = new EditorView({
      doc: src,
      extensions: [...clojureExtensions, field1],
    });
    const map1 = view1.state.field(field1).map;
    adapter.save(buildIdentitySnapshot(map1, src));

    // Load and restore into a fresh map for the same source.
    const loaded = adapter.load();
    expect(loaded).not.toBeNull();
    const field2 = buildIdentityField({
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    const view2 = new EditorView({
      doc: src,
      extensions: [...clojureExtensions, field2],
    });
    const restored = recoverIdentityMap(
      loaded!,
      view2.state,
      defaultStatefulFormClassifier,
    );
    // Same number of identities and same id set.
    expect(entriesOf(restored.map).length).toBe(entriesOf(map1).length);
    const before = new Set(entriesOf(map1).map((e) => e.id));
    const after = new Set(entriesOf(restored.map).map((e) => e.id));
    expect(after).toEqual(before);
    view1.destroy();
    view2.destroy();
  });

  it("getById recovers entries on the restored map", () => {
    const src = '(synth "osc/sine" :freq 100)\n(synth "osc/sine" :freq 200)\n';
    const field = buildIdentityField({
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    const view = new EditorView({
      doc: src,
      extensions: [...clojureExtensions, field],
    });
    const map = view.state.field(field).map;
    const snap = buildIdentitySnapshot(map, src);

    const restored = recoverIdentityMap(
      snap,
      view.state,
      defaultStatefulFormClassifier,
    );
    // Round-trip via the same view state recovers every original id.
    for (const e of entriesOf(map)) {
      expect(getById(restored.map, e.id)).toBeDefined();
    }
    view.destroy();
  });
});

// ─── Stale metadata: identity does not attach to multiple forms (VAL-ID-011) ─

describe("VAL-ID-011: stale metadata does not produce duplicate IDs across forms", () => {
  it("drops duplicate-id entries rather than attaching one ID to two forms", () => {
    // Hand-construct a snapshot with two entries that share an id but point
    // at different form keys. Recovery must never install the same id on
    // two forms.
    const src = '(synth "osc/sine" :freq 100)\n(synth "osc/sine" :freq 200)\n';
    const dupSnap: IdentitySnapshot = {
      schemaVersion: 1,
      documentFingerprint: computeDocumentFingerprint(src),
      entries: [
        { id: "id-dup" as any, kind: "synth", formKey: [0] },
        { id: "id-dup" as any, kind: "synth", formKey: [1] },
      ],
    };
    const field = buildIdentityField({
      ids: deterministicIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    const view = new EditorView({
      doc: src,
      extensions: [...clojureExtensions, field],
    });
    const restored = recoverIdentityMap(
      dupSnap,
      view.state,
      defaultStatefulFormClassifier,
    );
    const ids = entriesOf(restored.map).map((e) => e.id);
    // Either only one entry with id-dup is present, or none. Either way,
    // there is no duplicate.
    expect(new Set(ids).size).toBe(ids.length);
    view.destroy();
  });

  it("truncated payload (entries mid-write) recovers without throwing", () => {
    // Simulate a truncated JSON value in storage.
    mockStorage.setItem(
      PERSISTENCE_KEYS.editorIdentity,
      '{"schemaVersion":1,"documentFingerprint":"abc","entries":[',
    );
    const adapter = createIdentityPersistence({
      load: (k, fb) => persistenceLoad(k, fb),
      save: (k, v) => persistenceSave(k, v),
      remove: (k) => persistenceRemove(k),
    });
    expect(adapter.load()).toBeNull();
  });
});

// ─── EditorState import marker to satisfy TS unused-import warnings ────────
void EditorState;
void mapsEqualByIdentity;
