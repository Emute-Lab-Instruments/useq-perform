/**
 * Persistence adapter for the state-identity sidecar.
 *
 * Spec: docs/specs/state-identity.md §7.3 (persist through the central
 * persistence service); docs/specs/persistence.md (central service, JSON
 * recovery, `?nosave` write gate).
 *
 * This module is the single dependency-injected seam between the
 * state-identity extension and the central persistence service. The
 * extension accepts an {@link IdentityPersistence} instance via its
 * {@link IdentityConfig} and routes every snapshot read/write through it.
 * The default production wiring lives in
 * `createDefaultIdentityConfig.ts`, which calls
 * {@link createIdentityPersistence} with the real central service.
 *
 * The adapter is intentionally tiny:
 *
 *   - `load()` returns a validated {@link IdentitySnapshot} or `null`. The
 *     central persistence service handles JSON parse errors; this layer
 *     additionally validates the schema (delegated to
 *     {@link safeLoadIdentitySnapshot}) so the extension never receives a
 *     malformed payload.
 *   - `save(snapshot)` writes the snapshot via the central service. The
 *     central service applies `?nosave` (persistence.md §1.7), so under
 *     `?nosave` this is a silent no-op.
 *   - `remove()` clears the stored snapshot via the central service.
 *
 * Tests inject a custom adapter (or wrap the central service with spies)
 * to assert the contract (VAL-ID-020, VAL-ID-024).
 */

import type { IdentitySnapshot } from "./identityTypes.ts";
import { safeLoadIdentitySnapshot } from "./identitySnapshot.ts";
import {
  load as persistenceLoad,
  save as persistenceSave,
  remove as persistenceRemove,
  PERSISTENCE_KEYS,
} from "../../../lib/persistence.ts";

// ─── DI surface ────────────────────────────────────────────────────────────

/**
 * The narrow slice of the central persistence service the identity adapter
 * uses. Production wiring supplies the real service; tests inject spies.
 */
export interface IdentityPersistenceBackend {
  load<T>(key: string, fallback: T): T;
  save(key: string, value: unknown): void;
  remove(key: string): void;
}

/**
 * Public adapter interface consumed by the identity extension.
 *
 * The extension calls `load()` once at create-time and `save()` after each
 * document change that updates the identity map. `remove()` is available
 * for explicit reset (e.g. "clear identity metadata" command).
 */
export interface IdentityPersistence {
  /** Load and validate the stored snapshot, or return null. Never throws. */
  load(): IdentitySnapshot | null;
  /** Persist a snapshot through the central service (no-op under `?nosave`). */
  save(snapshot: IdentitySnapshot): void;
  /** Remove the stored snapshot through the central service. */
  remove(): void;
}

// ─── Spy/test support ──────────────────────────────────────────────────────

/**
 * Record of a single adapter call. Used by tests to assert that the
 * extension routes its writes through the central persistence service.
 */
export type PersistenceCall =
  | { op: "load"; key: string }
  | { op: "save"; key: string; value: IdentitySnapshot }
  | { op: "remove"; key: string };

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Build the production identity persistence adapter against the central
 * persistence service (or a test-supplied spy backend).
 *
 * The adapter always:
 *   - uses {@link PERSISTENCE_KEYS.editorIdentity} as the storage key;
 *   - validates loaded payloads via {@link safeLoadIdentitySnapshot};
 *   - routes writes through the backend so `?nosave` is respected by
 *     the central service itself (no duplicate nosave check here).
 */
export function createIdentityPersistence(
  backend: IdentityPersistenceBackend = {
    load: (k, fb) => persistenceLoad(k, fb),
    save: (k, v) => persistenceSave(k, v),
    remove: (k) => persistenceRemove(k),
  },
): IdentityPersistence {
  return {
    load(): IdentitySnapshot | null {
      const raw = backend.load<unknown>(PERSISTENCE_KEYS.editorIdentity, null);
      return safeLoadIdentitySnapshot(raw);
    },
    save(snapshot: IdentitySnapshot): void {
      backend.save(PERSISTENCE_KEYS.editorIdentity, snapshot);
    },
    remove(): void {
      backend.remove(PERSISTENCE_KEYS.editorIdentity);
    },
  };
}
