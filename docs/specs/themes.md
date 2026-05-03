# Themes

> Spec: theme catalogue and atomic application across surfaces. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/editors/themes.ts` — theme catalogue (ThemeSpec definitions, CodeMirror extensions, CSS variable injection)
- `src/lib/themes.ts` — theme name registry and validation helpers (import-boundary-safe)
- `src/ui/settings/ThemeSettings.tsx` — theme picker UI in the settings panel

1.1 The app ships a **fixed catalogue of named themes** including light and dark variants. Each theme defines: name, variant (`light`/`dark`), CodeMirror settings (background, foreground, caret, selection, line highlight, gutter colours), highlight tag styles, and an optional accent colour. (see `src/editors/themes.ts` for catalogue, `src/lib/themes.ts` for name registry)

1.2 **Theme application is atomic across three surfaces**: the CodeMirror compartment, the document-root CSS variables (chrome/toolbar/panel colours), and the visualisation palette (dark or light). All three must remain in sync — no surface may show a stale theme. (see `src/editors/themes.ts`)

1.3 **Custom themes** may be persisted in settings as user-defined entries. They appear alongside built-in themes in the picker. (see `src/ui/settings/ThemeSettings.tsx`)

1.4 Theme switching must be hot. No reload; no flash of unstyled content; no loss of editor state, transport state, console history, or visualisation traces.

1.5 The accent colour drives several derived UI elements (vis centre line, eval highlight). Theme authors must specify accent or accept a deterministic derivation from the foreground.

## Open / Deferred

2.1 **`customThemes` extraction.** Custom themes currently live inside `AppSettings` as runtime data. Flagged for extraction to a themes store; deferred for cost reasons.
