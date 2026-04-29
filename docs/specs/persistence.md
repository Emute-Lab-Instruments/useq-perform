# Persistence

> Spec: localStorage keys and the persistence service. Counterpart to [MAIN.md](MAIN.md).

1.1 All localStorage access goes through a **central persistence service** with typed keys, JSON error recovery, and `?nosave` bypass. Direct `localStorage.getItem`/`setItem` from feature code is forbidden by convention.

1.2 The **hard-compatibility persistence keys** (must not break casually) are:
- `uSEQ-Perform-User-Settings` (full settings JSON)
- `uSEQ-Perform-User-Code` (raw editor content)
- `uSEQ-Serial-Port-Info` (saved Web Serial port metadata)

1.3 The **soft-compatibility persistence keys** (kept while their UI surfaces remain) are:
- `useqExperienceLevel`, `useq:onboarding-dismissed` (onboarding state)
- `moduLispReference:starredFunctions`, `:expandedFunctions`, `:targetVersion`
- `codeSnippets:snippets`, `:starred`, `:nextId`
- `editorContent` (autosave target)
- `uSEQ-Perform-Editor-Probes` (probe state)
- `uSEQ-Perform-DevMode-State` (devmode toggle)

1.4 **JSON parse errors must never crash.** A corrupt persisted value is logged as a warning and replaced by the schema default; the user keeps a working app and loses only that one piece of state.

1.5 The on-disk shape of persisted JSON values may evolve. Migration must be lossless for fields that survive and silent-default for fields that disappear.

1.6 **Schema versioning is implicit, not stamped.** Normalisation reads the persisted JSON and fills in missing fields from defaults; unknown fields are dropped. There is no version key.

1.7 `?nosave` fully bypasses every write through the persistence service. Modules that use other persistence channels (e.g. IndexedDB, cookies) must respect the same flag.
