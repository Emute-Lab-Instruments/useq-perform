# uSEQ Grammar Lab

An interactive concept artifact for exploring embodied motor grammars for
structural live coding. It communicates the experimental method; it is not yet
an empirical harness for the production editor.

The lab holds one semantic transformation constant—moving a high CV step one
beat later—while the user tries contrasting keyboard and gamepad grammars. The
same executable registry drives input resolution, contextual guidance, the
on-screen controls, and the action trace.

## Run

```bash
npm run grammar-lab
```

Open `http://localhost:5566`.

Focused verification:

```bash
npm run test:grammar-lab
npm run typecheck:grammar-lab
npm run build:grammar-lab
```

## Research boundary

This is a standalone Vite application. It does not import production editor
singletons, settings, persistence, serial transport, or the WASM runtime. Its
signal view is an explicitly deterministic preview, not a claim of real WASM
execution.

The experiment exports normalized raw control edges and resolved semantic
actions as separate streams. It stores nothing remotely or in local storage,
never adapts bindings, and does not declare a winning grammar. Session JSON can
be copied explicitly for analysis. Production-grade raw and semantic replay is
future work and is not claimed by this artifact.

## Candidate profiles

- **Direct** — dedicated gestures for frequent meanings.
- **Shifted** — held layers reuse a spatial map.
- **Sequence** — short phrases trade chord strain for timing and memory.
- **Held spatial** — a held directional field explores spatial layering; it is
  intentionally not presented as a true radial selector yet.

All profiles resolve to the same small semantic action vocabulary. Learn,
Play, and Design lenses change only the amount of explanation; they never
change behavior.
