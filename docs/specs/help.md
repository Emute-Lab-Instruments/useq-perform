---
stability: stable
layer: behavioural
---

# Help, Reference, Snippets, Onboarding

> Spec: in-app education and orientation surfaces. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/ui/help/HelpPanel.tsx` — top-level help panel with tab switching
- `src/ui/help/ModuLispReferenceTab.tsx` — function reference tab (filterable, starred, expandable)
- `src/ui/help/CodeSnippetsTab.tsx` — code snippets tab (user-savable fragments)
- `src/ui/help/KeybindingsTab.tsx` — keybindings guide tab (auto-generated from action registry)
- `src/ui/help/ReferencePanel.tsx` — reference panel wrapper
- `src/ui/help/helpChannels.ts` — help-panel-local typed channels (search, tab switching)
- `src/ui/help/guide/` — guide system: `GuideTab.tsx`, `GuideSection.tsx`, `Playground.tsx`, `LiveProbe.tsx`, `guideData.ts`, `guideTypes.ts`, `contentBlocks.tsx`, `chapters/`
- `src/lib/helpContentPreloader.ts` — eager preload of help content
- `src/utils/referenceStore.ts` — reference data store (star/expand/version state)
- `src/utils/snippetStore.ts` — snippet data store (user + starter snippets)

---

## 1. Help Panel

1.1 The help panel has **four tabs**: Guide, Reference, Code Snippets, Keybindings (see `src/ui/help/HelpPanel.tsx`).

1.2 **Guide** is a chaptered user guide covering language, algebra, modulation, rhythm, and editor (see `src/ui/help/guide/GuideTab.tsx`, `src/ui/help/guide/chapters/`). Chapters are static markdown content with embedded live probes and small playgrounds. Detailed guide structure lives in [user-guide.md](user-guide.md).

1.3 **Reference** is the ModuLisp function reference, filterable by name and tag; tracks starred and expanded items per user (see `src/ui/help/ModuLispReferenceTab.tsx`, `src/utils/referenceStore.ts`). Starred items sort first.

1.4 **Code Snippets** lists user-savable code fragments (see `src/ui/help/CodeSnippetsTab.tsx`, `src/utils/snippetStore.ts`). The first load seeds a starter set (rhythm, modulation, melodic, interactive) with `createdAt = 0`; user-created snippets sort newer-first above the starters. Starred items sort first overall.

1.5 Each snippet has `id`, `title`, `code`, `tags`, `createdAt`. Operations: add, update (title/code/tags), delete (also removes from starred), toggle star.

1.5.1 **Snippet live oscilloscope (devmode).** When `visualisation.snippetOscilloscopesEnabled` is on (devmode-only toggle in the Visualisation → Probes settings group), each snippet card renders a small live oscilloscope strip outside the snippet's code editor (so it stays visible while the editor scrolls internally). The strip samples the snippet's first inner expression — the body of any leading `(an|dn|sn|qn …)` output binding is stripped before sampling so the live runtime is not re-bound — via `eval-at-time` over a one-second window around `visStore.currentTime`.

1.6 **Reference target version.** Reference content is tagged by uSEQ language version; the user may switch the target version via a control. The chosen version persists.

1.7 **Keybindings** is a read-only guide showing current keybinding assignments, organised by category (see `src/ui/help/KeybindingsTab.tsx`). It is a reference/learning surface, not a configuration UI — rebinding is done in the Settings panel's Keybindings tab. The keybindings guide is auto-generated from the action registry and always reflects the current bindings.

1.8 **Search.** Snippets and reference both expose a single search box that filters by title/code/tags and by name/description/tags respectively (routed via `src/ui/help/helpChannels.ts`). Search is case-insensitive substring; ranking promotes title matches over body matches.

## 2. Onboarding

2.1 An **onboarding banner** is shown when the user has not previously dismissed the banner (`useq:onboarding-dismissed` not set). This includes first-time users in `wasm` mode — the banner welcomes them and explains how to connect hardware. In `none` mode (no runtime at all), the banner is more urgent: it explains how to enable WASM or connect hardware to proceed.

2.2 Dismissing the banner persists `useq:onboarding-dismissed` and the banner does not return until that key is cleared. `?nosave` keeps the banner from being permanently dismissed.

2.3 The banner explains how to connect hardware or proceed in WASM-only mode and provides at least one actionable button (e.g. connect, learn more).

2.4 The banner must not occlude the editor; it docks in a non-intrusive region.
