/**
 * Versioned, atomic persistence shape for the canonical editor document.
 *
 * Text is the authority. `identities` is opaque document metadata here so
 * the foundation persistence layer does not depend on CodeMirror or the
 * state-identity implementation. DocumentSession validates that metadata at
 * its own seam before restoring it.
 */

import {
  load,
  loadRaw,
  remove,
  save,
  PERSISTENCE_KEYS,
} from "./persistence.ts";

export const DOCUMENT_RECORD_SCHEMA_VERSION = 1 as const;

export interface DocumentRecord<TIdentities = unknown> {
  readonly schemaVersion: typeof DOCUMENT_RECORD_SCHEMA_VERSION;
  readonly text: string;
  readonly identities: TIdentities | null;
}

export interface DocumentRecordRepository {
  load(): DocumentRecord | null;
  loadLegacyIdentity(): unknown;
  save(record: DocumentRecord): boolean;
}

export function parseDocumentRecord(value: unknown): DocumentRecord | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== DOCUMENT_RECORD_SCHEMA_VERSION) return null;
  if (typeof candidate.text !== "string") return null;
  return {
    schemaVersion: DOCUMENT_RECORD_SCHEMA_VERSION,
    text: candidate.text,
    identities: candidate.identities ?? null,
  };
}

/**
 * Central-storage adapter used by the main DocumentSession.
 *
 * A successful atomic write retires the old split current-editor keys. The
 * archived `/legacy/` editor remains a supported rollback surface, so its
 * `useqcode` key is updated afterwards as a compatibility mirror, never read
 * as authority while a valid DocumentRecord exists.
 */
export function createDocumentRecordRepository(): DocumentRecordRepository {
  return {
    load(): DocumentRecord | null {
      const stored = load<unknown>(PERSISTENCE_KEYS.editorDocument, null);
      const record = parseDocumentRecord(stored);
      if (stored !== null && record === null) {
        console.warn(
          `[persistence] Ignoring unsupported ${PERSISTENCE_KEYS.editorDocument} record.`,
        );
      }
      return record;
    },
    loadLegacyIdentity(): unknown {
      return load<unknown>(PERSISTENCE_KEYS.editorIdentity, null);
    },
    save(record: DocumentRecord): boolean {
      if (!save(PERSISTENCE_KEYS.editorDocument, record)) return false;

      // These keys were the former split authorities. Retire them only after
      // the atomic replacement is known to have succeeded.
      remove(PERSISTENCE_KEYS.editorCode);
      remove(PERSISTENCE_KEYS.editorIdentity);

      // Explicit rollback compatibility mirror; never canonical.
      save(PERSISTENCE_KEYS.legacyCode, record.text);
      return true;
    },
  };
}

/** Read the canonical document text for settings/bootstrap composition. */
export function readDocumentRecordText(): string | null {
  return createDocumentRecordRepository().load()?.text ?? null;
}

/**
 * Read the pre-DocumentRecord text only when no valid atomic record exists.
 * JSON-encoded raw strings are tolerated because older builds wrote both.
 */
export function readLegacyDocumentText(): string | null {
  const raw =
    loadRaw(PERSISTENCE_KEYS.editorCode) ??
    loadRaw(PERSISTENCE_KEYS.legacyCode);
  if (raw === null) return null;
  try {
    const decoded = JSON.parse(raw);
    return typeof decoded === "string" ? decoded : raw;
  } catch {
    return raw;
  }
}
