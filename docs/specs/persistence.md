---
stability: stable
layer: behavioural
---

# Persistence

> Spec: localStorage keys and the persistence service. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/lib/documentRecord.ts` — atomic `DocumentRecord` repository/schema and legacy document migration
- `src/lib/persistence.ts` — central localStorage primitives, typed key registry, JSON error recovery, and `?nosave` bypass
- `src/editors/documentSession.ts` — coherent document snapshots, autosave, flush, and migration hand-off

1.1 All localStorage access goes through a **central persistence service** with typed keys, JSON error recovery, and `?nosave` bypass. Direct `localStorage.getItem`/`setItem` from feature code is forbidden by convention. (see `src/lib/persistence.ts`)

1.2 The **hard-compatibility persistence keys** (must not break casually) are:
- `uSEQ-Perform-User-Settings` (full settings JSON)
- `uSEQ-Perform-Document` (canonical versioned `DocumentRecord`; §2)
- `uSEQ-Perform-User-Code` (legacy raw-text migration input; not live document state)
- `uSEQ-Serial-Port-Info` (saved Web Serial port metadata)

1.3 The **soft-compatibility persistence keys** (kept while their UI surfaces remain) are:
- `useqExperienceLevel`, `useq:onboarding-dismissed` (onboarding state)
- `moduLispReference:starredFunctions`, `:expandedFunctions`, `:targetVersion`
- `codeSnippets:snippets`, `:starred`, `:nextId`
- `useq:zen:progress` (zen-mode lesson progress — see [zen-mode.md §8.1](zen-mode.md))
- `uSEQ-Perform-Editor-Probes` (probe state)
- `uSEQ-Perform-Editor-LiveEdits` (live-edit values, orphan state, MIDI bindings, panel state)
- `uSEQ-Perform-DevMode-State` (devmode toggle)

1.3.1 `uSEQ-Perform-Editor-Identity` is a legacy state-identity migration input,
not a live sidecar. It remains readable alongside `uSEQ-Perform-User-Code` until
the successful atomic migration defined by §2.4.

1.4 **JSON parse errors must never crash.** A corrupt persisted value is logged as a warning and replaced by the schema default; the user keeps a working app and loses only that one piece of state.

1.5 The on-disk shape of persisted JSON values may evolve. Migration must be lossless for fields that survive and silent-default for fields that disappear.

1.6 **Schema versioning is implicit by default.** Normalisation reads the persisted JSON and fills in missing fields from defaults; unknown fields are dropped. Most persisted shapes do not carry a version key. Feature-local persisted records may include an explicit `schemaVersion` only when they need non-trivial migration that cannot be represented by total normalisation alone; [live-edit.md §7](live-edit.md) is the current example.

1.7 `?nosave` is a **session-scoped write gate**: every write through the persistence service becomes a silent no-op, but reads still return pre-existing persisted state. (see `src/lib/persistence.ts`) The app starts with whatever was previously saved but never writes back. Modules that use other persistence channels (e.g. IndexedDB, cookies) must respect the same flag.

1.8 **Downgrade is unsupported.** Only forward migration (older persisted data → newer app version) is a supported path. An older app version encountering unknown fields from a newer version may drop them; this is acceptable.

1.9 **Legacy-editor rollback exception.** While `/legacy/` is a supported migration escape hatch, migration must not delete `editorConfig`, `useqConfig`, or `useqcode`. Every successful current-editor `DocumentRecord` save also mirrors that snapshot's text to legacy `useqcode` using the old JSON-string encoding. Settings are preserved in their last legacy shape but are not reverse-migrated. Clearing current settings does not erase the legacy keys. This exception ends only when the legacy endpoint reaches its announced retirement date.

---

## 2. Canonical Document Persistence

2.1 The main editor persists one versioned **`DocumentRecord`** under
`uSEQ-Perform-Document`:

```text
DocumentRecord = {
  schemaVersion,
  text,
  identities
}
```

`text` is the sole program authority; `identities` is the stable
sidecar described by [state-identity.md §7](state-identity.md) and may only
annotate forms in that text. Normalisation may add fields in later schema
versions, but only supported, safely validated entries correlated to compatible
forms in the record's text enter the normalised metadata.
&nbsp;&nbsp;&nbsp;&nbsp;**Why:** the durable unit must name one text revision and the
identity metadata that belongs to exactly that revision.

2.2 **Text and identity metadata are written atomically as one storage value.**
There is no live write path that saves raw text and identity under separate
keys. A failed write leaves the previous complete `DocumentRecord` intact and
does not acknowledge the new revision as durable.
&nbsp;&nbsp;&nbsp;&nbsp;**Why:** two writes can be interrupted between keys, producing
plausible but incorrect identity attachment after reload.

2.3 Autosave and explicit save obtain their value from the owning
`DocumentSession.snapshot()`; settings are not a document store. In particular,
`editor.code` may seed bootstrap or legacy migration when no valid
`DocumentRecord` exists, but it is not updated as live mutable document state
and must not override a valid record.
&nbsp;&nbsp;&nbsp;&nbsp;**Why:** copying live code through settings would recreate a
second source of truth with a different save cadence and failure model.

2.4 **Legacy migration is text-lossless, validation-gated, and one-way.** When
no valid canonical record exists, bootstrap constructs one session snapshot
from the selected legacy text input (`uSEQ-Perform-User-Code`, legacy
`editor.code`, or `useqcode`, following the editor load precedence) and the
supported `uSEQ-Perform-Editor-Identity` entries that validate safely and
correlate to compatible forms in that exact text. Malformed, unsupported, or
uncorrelated identity entries are ignored without rejecting or changing the
text. The legacy fallback keys remain untouched and readable until a complete
atomic `DocumentRecord` write succeeds; only that success permits retiring
their fallback read path. A failed, blocked, or skipped write keeps the
fallbacks for the next start.
&nbsp;&nbsp;&nbsp;&nbsp;**Why:** identity guesses can attach musical state to the
wrong expression, while successful construction in memory is not evidence that
the validated text-and-identity snapshot has reached durable storage.

2.5 `?nosave` applies to document migration, autosave, explicit save, and final
flush. Reads may hydrate a session from the canonical record or legacy inputs,
but no key is written, mirrored, marked migrated, or retired while the gate is
active.
&nbsp;&nbsp;&nbsp;&nbsp;**Why:** migration must not become a hidden exception to the
session-wide promise that `?nosave` performs no writes.

2.6 A corrupt or unsupported `DocumentRecord` produces a warning and falls back
to the intact legacy inputs when available; it must not delete or overwrite
those inputs merely because fallback succeeded. If no usable input exists, the
editor still mounts with its startup default or empty text and new in-memory
identity metadata.
&nbsp;&nbsp;&nbsp;&nbsp;**Why:** recovery should restore an editable app without
destroying the only remaining copy of the performer's code or identity history.
