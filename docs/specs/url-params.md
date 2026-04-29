# URL Parameters

> Spec: bootstrap URL parameters and their precedence. Counterpart to [MAIN.md](MAIN.md).

1.1 URL parameters are the **highest-precedence configuration source**, above persisted settings and product defaults.

1.2 The bootstrap-contract URL params are:
- `?config=<url>` — fetch and apply a config JSON before normal startup;
- `?gist=<id-or-url>` — load editor code from a GitHub gist;
- `?txt=<url>` — load editor code from a plain-text URL;
- `?disableWebSerial=true` — force browser-local mode regardless of browser capability;
- `?devmode=true` — unlock advanced settings sections;
- `?nosave` — disable all localStorage writes (load still returns fallback);
- `?noModuleMode=true` — internal escape hatch; treated as a debug flag, not a public promise;
- `?wasmInWorker=true` — opt in to the worker-backed WASM port (dev-only, not the default).

1.3 An unknown URL param is **stored in `startupFlags.params` but is not an error**. Future params may be added; old bundles must not crash on encountering them.

1.4 `?nosave` makes every persistence write a silent no-op, including auto-save and the dismiss flag for the onboarding banner. Reads still succeed against any pre-existing localStorage state.

1.5 Removal/rename of any param in §1.2 is a compatibility break and must be treated as a major version concern.
