# Reactive Flow

> Spec: typed-channel invariants, mutation surfaces, import boundaries. Counterpart to [MAIN.md](MAIN.md).
> See also `../REACTIVE_FLOW.md` for the channel/store inventory.

1.1 Inter-module communication uses **typed pub/sub channels** from a single primitive. CustomEvents and globals are forbidden for runtime/visualisation/gamepad/help signals.

1.2 The **canonical reactive stores** are: `settingsStore`, `visStore`, `consoleStore`, `referenceStore`, `snippetStore`. UI reads from stores; mutations go through named functions or the runtime service.

1.3 **Settings is the only mutation surface that fans out to multiple stores.** All other stores are mutated by their owning subsystem only.

1.4 **Two non-reactive state holders** are deliberate exceptions: `appSettingsRepository` (canonical settings; reactive store mirrors it) and `runtimeSessionStore` (connection/session state; UI subscribes via `runtimeService`). Plus 9 imperative `CircularBuffer`s in the stream parser. Adding more non-reactive state requires explicit justification.

1.5 **Channel registries** live in `src/contracts/`. The full channel inventory is documented in `../REACTIVE_FLOW.md`. Adding a channel requires registering it there.

1.6 **No back-edges from leaves to foundation.** Import boundaries enforce: `lib/` and `contracts/` must not import from runtime/effects/transport/editors/ui. Lint enforces; exceptions are explicit and documented.
