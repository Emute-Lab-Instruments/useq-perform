---
stability: stable
layer: behavioural
---

# Persistence

> Spec: localStorage keys and the persistence service. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/lib/persistence.ts` — central persistence service (typed keys, JSON error recovery, `?nosave` bypass)

1.1 All localStorage access goes through a **central persistence service** with typed keys, JSON error recovery, and `?nosave` bypass. Direct `localStorage.getItem`/`setItem` from feature code is forbidden by convention. (see `src/lib/persistence.ts`)

1.2 The **hard-compatibility persistence keys** (must not break casually) are:
- `uSEQ-Perform-User-Settings` (full settings JSON)
- `uSEQ-Perform-User-Code` (raw editor content)
- `uSEQ-Serial-Port-Info` (saved Web Serial port metadata)

1.3 The **soft-compatibility persistence keys** (kept while their UI surfaces remain) are:
- `useqExperienceLevel`, `useq:onboarding-dismissed` (onboarding state)
- `moduLispReference:starredFunctions`, `:expandedFunctions`, `:targetVersion`
- `codeSnippets:snippets`, `:starred`, `:nextId`
- `useq:zen:progress` (zen-mode lesson progress — see [zen-mode.md §8.1](zen-mode.md))
- `uSEQ-Perform-Editor-Probes` (probe state)
- `uSEQ-Perform-Editor-LiveEdits` (live-edit values, orphan state, MIDI bindings, panel state)
- `uSEQ-Perform-Editor-Identity` (state-identity sidecar: schema-versioned hidden IDs for anonymous stateful forms — see [state-identity.md §7.3](state-identity.md); carries its own `schemaVersion` per §1.6)
- `uSEQ-Perform-DevMode-State` (devmode toggle)

1.4 **JSON parse errors must never crash.** A corrupt persisted value is logged as a warning and replaced by the schema default; the user keeps a working app and loses only that one piece of state.

1.5 The on-disk shape of persisted JSON values may evolve. Migration must be lossless for fields that survive and silent-default for fields that disappear.

1.6 **Schema versioning is implicit by default.** Normalisation reads the persisted JSON and fills in missing fields from defaults; unknown fields are dropped. Most persisted shapes do not carry a version key. Feature-local persisted records may include an explicit `schemaVersion` only when they need non-trivial migration that cannot be represented by total normalisation alone; [live-edit.md §7](live-edit.md) is the current example.

1.7 `?nosave` is a **session-scoped write gate**: every write through the persistence service becomes a silent no-op, but reads still return pre-existing persisted state. (see `src/lib/persistence.ts`) The app starts with whatever was previously saved but never writes back. Modules that use other persistence channels (e.g. IndexedDB, cookies) must respect the same flag.

1.8 **Downgrade is unsupported.** Only forward migration (older persisted data → newer app version) is a supported path. An older app version encountering unknown fields from a newer version may drop them; this is acceptable.

1.9 **Legacy-editor rollback exception.** While `/legacy/` is a supported migration escape hatch, migration must not delete `editorConfig`, `useqConfig`, or `useqcode`. Every current-editor code save also mirrors the text to legacy `useqcode` using the old JSON-string encoding. Settings are preserved in their last legacy shape but are not reverse-migrated. Clearing current settings does not erase the legacy keys. This exception ends only when the legacy endpoint reaches its announced retirement date.
