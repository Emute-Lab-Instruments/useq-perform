---
stability: stable
layer: behavioural
---

# Themes

> Spec: theme catalogue and atomic application across surfaces. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/editors/themes.ts` — theme catalogue (ThemeSpec definitions, CodeMirror extensions, CSS variable injection)
- `src/lib/themes.ts` — theme name registry and validation helpers (import-boundary-safe)
- `src/ui/settings/ThemeSettings.tsx` — theme picker UI in the settings panel

1.1 The app ships a **fixed catalogue of named themes** including light and dark variants. Each theme defines: name, variant (`light`/`dark`), CodeMirror settings (background, foreground, caret, selection, line highlight, gutter colours), highlight tag styles, and an optional accent colour. (see `src/editors/themes.ts` for catalogue, `src/lib/themes.ts` for name registry)

1.2 **Theme application is atomic across three surfaces**: the CodeMirror compartment, the document-root CSS variables (chrome/toolbar/panel colours), and the visualisation palette (dark or light). All three must remain in sync — no surface may show a stale theme. (see `src/editors/themes.ts`)

1.3 Theme switching must be hot. No reload; no flash of unstyled content; no loss of editor state, transport state, console history, or visualisation traces.

1.4 The accent colour drives several derived UI elements (vis centre line, eval highlight). Theme authors must specify accent or accept a deterministic derivation from the foreground.

## Open / Deferred

2.1 **Custom themes (unimplemented).** `AppSettings.ui.customThemes` exists as an untyped (`unknown[]`) slot that is persisted/normalised but never populated or rendered. There is no UI to author a custom theme and `ThemeSettings.tsx` iterates only the built-in catalogue. A user-defined-theme data model, an authoring surface, and merge-into-picker rendering are all deferred. When implemented, custom themes should appear alongside built-in themes in the picker and the `customThemes` storage should be extracted from `AppSettings` into a dedicated themes store.
