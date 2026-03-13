# ADR 0003: Archive Boundaries

- Status: Accepted
- Date: 2026-03-13

## Context

The repo keeps valuable heartbeat reports, prompt packs, and older helper scripts, but they are easy to mistake for live architectural guidance. That confusion keeps generating follow-on work from stale narratives instead of current code and docs.

## Decision

The following surfaces are archive-only unless a task explicitly asks for them:

- `history/`
- `history/heartbeat-runs/`
- `scripts/documentation/`
- superseded issue snapshots or raw `.beads/issues.jsonl` entries used as historical evidence

These surfaces may preserve useful context, but they are not canonical instructions for current product, runtime, or backend behavior.

## Consequences

- Current workflow guidance should point contributors at `README.md`, `docs/REPO_MAP.md`, and the live docs in `docs/`.
- Historical scripts or reports can stay in the repo without silently redefining the supported architecture.
- When a historical artifact still matters, future work should promote the relevant fact into a live doc or test instead of linking back to the archive forever.
