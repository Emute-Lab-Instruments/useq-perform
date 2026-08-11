/**
 * Text-canonical ownership module for one CodeMirror document lifetime.
 *
 * The EditorState is the coherent revision seam: visible text and the
 * identity StateField are captured from the same immutable state. This
 * module owns persistence scheduling, explicit flush, and teardown; callers
 * do not coordinate text and metadata writes themselves.
 */

import type { Extension, StateField } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";

import type { AppSettings } from "../lib/appSettings.ts";
import {
  createDocumentRecordRepository,
  type DocumentRecordRepository,
} from "../lib/documentRecord.ts";
import { createDefaultIdentityConfig } from "./extensions/stateIdentity/createDefaultIdentityConfig.ts";
import {
  identityExtensionsWithField,
  readIdentityMap,
  type IdentityFieldValue,
} from "./extensions/stateIdentity/identityField.ts";
import { identityField as defaultIdentityField } from "./extensions/stateIdentity/identityFieldExport.ts";
import type { IdentityPersistence } from "./extensions/stateIdentity/identityPersistence.ts";
import {
  buildIdentitySnapshot,
  safeLoadIdentitySnapshot,
} from "./extensions/stateIdentity/identitySnapshot.ts";
import { emptyIdentityMap, type IdentityMap } from "./extensions/stateIdentity/identityTypes.ts";

export interface DocumentSnapshot {
  readonly revision: number;
  readonly state: EditorState;
  readonly text: string;
  readonly identities: IdentityMap;
}

export interface DocumentSession {
  readonly view: EditorView;
  snapshot(): DocumentSnapshot;
  subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void;
  replaceText(text: string): void;
  insertText(text: string, position?: number): void;
  setPersistenceSettings(settings: AppSettings): void;
  flush(): boolean;
  dispose(): void;
}

interface SessionOptions {
  readonly initialText: string;
  readonly buildExtensions: (options: {
    identityExtensions: readonly Extension[];
    sessionExtensions: readonly Extension[];
  }) => Extension[];
  readonly settings: AppSettings;
  readonly repository?: DocumentRecordRepository | null;
  readonly parent?: HTMLElement;
}

const sessionsByView = new WeakMap<EditorView, DocumentSession>();

class CodeMirrorDocumentSession implements DocumentSession {
  readonly view: EditorView;

  private readonly identityField: StateField<IdentityFieldValue>;
  private readonly repository: DocumentRecordRepository | null;
  private readonly listeners = new Set<(snapshot: DocumentSnapshot) => void>();
  private revision = 0;
  private dirty = true;
  private disposed = false;
  private saveCodeLocally = false;
  private autoSaveEnabled = false;
  private autoSaveInterval = 5_000;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onPageHide = () => {
    this.flush();
  };

  constructor(options: SessionOptions) {
    this.repository = options.repository ?? null;
    const storedRecord = this.repository?.load() ?? null;

    const identityPersistence: IdentityPersistence | undefined = this.repository
      ? {
          load: () => {
            const source =
              storedRecord !== null
                ? storedRecord.identities
                : this.repository?.loadLegacyIdentity();
            return safeLoadIdentitySnapshot(source);
          },
          // The field owns identity reconciliation, not I/O. DocumentSession
          // captures and writes the final text+identity pair atomically.
          save: () => {},
          remove: () => {},
        }
      : undefined;

    const identity = identityExtensionsWithField(
      createDefaultIdentityConfig({ persistence: identityPersistence ?? null }),
    );
    this.identityField = identity.field;

    const sessionListener = EditorView.updateListener.of((update) => {
      this.onUpdate(update);
    });
    this.view = new EditorView({
      state: EditorState.create({
        doc: options.initialText,
        extensions: options.buildExtensions({
          identityExtensions: identity.extensions,
          sessionExtensions: [sessionListener],
        }),
      }),
      parent: options.parent,
    });
    sessionsByView.set(this.view, this);

    this.setPersistenceSettings(options.settings);
    if (this.repository && typeof window !== "undefined") {
      window.addEventListener("pagehide", this.onPageHide);
    }

    // Establish the atomic record immediately. This is also the one-time
    // migration point from split text/identity storage.
    this.flush();
  }

  snapshot(): DocumentSnapshot {
    const state = this.view.state;
    return {
      revision: this.revision,
      state,
      text: state.doc.toString(),
      identities: readIdentityMap(state, this.identityField),
    };
  }

  subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replaceText(text: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
    });
  }

  insertText(text: string, position = 0): void {
    const safePosition = Math.max(0, Math.min(position, this.view.state.doc.length));
    this.view.dispatch({ changes: { from: safePosition, insert: text } });
  }

  setPersistenceSettings(settings: AppSettings): void {
    const wasEnabled = this.saveCodeLocally;
    this.saveCodeLocally = Boolean(settings.storage.saveCodeLocally);
    this.autoSaveEnabled = Boolean(settings.storage.autoSaveEnabled);
    this.autoSaveInterval = Math.min(
      60_000,
      Math.max(1_000, Number(settings.storage.autoSaveInterval) || 5_000),
    );
    this.restartAutosave();
    if (!wasEnabled && this.saveCodeLocally) this.flush();
  }

  flush(): boolean {
    if (
      this.disposed ||
      !this.repository ||
      !this.saveCodeLocally ||
      !this.dirty
    ) {
      return false;
    }

    const snapshot = this.snapshot();
    const saved = this.repository.save({
      schemaVersion: 1,
      text: snapshot.text,
      identities: buildIdentitySnapshot(snapshot.identities, snapshot.text),
    });
    if (saved) this.dirty = false;
    return saved;
  }

  dispose(): void {
    if (this.disposed) return;
    // Flush before marking disposed: `flush` intentionally rejects late work.
    this.flush();
    this.disposed = true;
    this.stopAutosave();
    if (this.repository && typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onPageHide);
    }
    this.listeners.clear();
    sessionsByView.delete(this.view);
    this.view.destroy();
  }

  private onUpdate(update: ViewUpdate): void {
    const previousIdentities = readIdentityMap(update.startState, this.identityField);
    const nextIdentities = readIdentityMap(update.state, this.identityField);
    if (!update.docChanged && previousIdentities === nextIdentities) return;

    this.revision += 1;
    this.dirty = true;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private restartAutosave(): void {
    this.stopAutosave();
    if (!this.repository || !this.saveCodeLocally || !this.autoSaveEnabled) return;
    this.autosaveTimer = setInterval(() => this.flush(), this.autoSaveInterval);
  }

  private stopAutosave(): void {
    if (this.autosaveTimer === null) return;
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = null;
  }
}

export function createDocumentSession(options: SessionOptions): DocumentSession {
  return new CodeMirrorDocumentSession(options);
}

export function createPersistentDocumentSession(options: Omit<SessionOptions, "repository"> & {
  readonly repository?: DocumentRecordRepository;
}): DocumentSession {
  return createDocumentSession({
    ...options,
    repository: options.repository ?? createDocumentRecordRepository(),
  });
}

/**
 * Capture a coherent revision for evaluation. Registered editor lifetimes use
 * their session-owned field; isolated test/read-only views fall back to the
 * historical production singleton when it is installed.
 */
export function captureDocumentSnapshot(view: EditorView): DocumentSnapshot {
  const session = sessionsByView.get(view);
  if (session) return session.snapshot();

  const state = view.state;
  let identities = emptyIdentityMap;
  try {
    identities = state.field(defaultIdentityField()).map;
  } catch {
    // An embedded/read-only editor has no identity sidecar.
  }
  return {
    revision: 0,
    state,
    text: state.doc.toString(),
    identities,
  };
}
