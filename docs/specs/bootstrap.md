# Bootstrap

> Spec: app startup. Counterpart to [MAIN.md](MAIN.md).

1.1 The shipped product is a single Vite bundle. Loading the app runs `bootstrap()` in a deterministic order: parse URL params → load persisted settings → mount UI → eagerly start WASM load → wire transport → start app lifecycle.

1.2 **The app must reach an interactive editor regardless of hardware presence or WASM readiness.** A user with no hardware and a slow WASM load still sees a usable editor with their last code restored.

1.3 Cold-start startup must be **observable**: any failure during bootstrap publishes a structured `bootstrapFailure` diagnostic and the user sees an actionable message, never a silent blank page. See [MAIN.md §2.4](MAIN.md).

1.4 **Browser support floor**: a modern ES2020 browser that can run the bundle and the WASM module. Hardware mode additionally requires Web Serial (Chromium-family). When Web Serial is unavailable, the app stays usable in browser-local WASM mode rather than failing, but clearly alerts the user with a dismissable toast.

1.5 **Eager WASM preload.** WASM loading begins early in bootstrap so the first eval does not pay the full cold-start. Failure to preload does not block UI mount; the first eval will await load if necessary.
