# ADR 0002: Config Manager Is Dev Tooling

- Status: Accepted
- Date: 2026-03-13

## Context

`src/runtime/configManager.ts` can export the current configuration, import a config file, and in dev mode write directly to `src/runtime/default-config.json` through `scripts/config-server.mjs` or the File System Access API. That workflow is useful for local development, but it is not part of the stable product core defined in `docs/STABLE_CORE.md`.

Leaving this surface in the general settings UI creates a false product promise: it looks like a stable end-user feature even though its repo-write path depends on local development setup.

## Decision

Treat `configManager` and the "Configuration Management" panel as internal development tooling.

- The settings UI only exposes it in `?devmode=true`.
- Source-file persistence through the config server is a local developer workflow, not a stable user-facing feature.
- Runtime and product docs should describe committed config loading, local persistence, and URL bootstrap overrides as the supported settings surfaces instead.

## Consequences

- Stable product work should not depend on source-file export or import being visible in the normal settings panel.
- Future cleanup may extract or delete `configManager` entirely without breaking the stable core, as long as dev tooling retains an equivalent debugging path.
- Any further investment in this area should happen as explicit dev tooling, not as accidental product scope.
