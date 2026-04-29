# Help, Reference, Snippets, Onboarding

> Spec: in-app education and orientation surfaces. Counterpart to [MAIN.md](MAIN.md).

## 1. Help Panel

1.1 The help panel has **three tabs**: Guide, Reference, Code Snippets.

1.2 **Guide** is a chaptered user guide covering language, algebra, modulation, rhythm, and editor. Chapters are static markdown content with embedded live probes and small playgrounds.

1.3 **Reference** has two sub-tabs: Language (ModuLisp function reference, filterable; tracks starred and expanded items per user) and Editor (current keybindings reference). Function reference is filterable by name and tag; starred items sort first.

1.4 **Code Snippets** lists user-savable code fragments. The first load seeds a starter set (rhythm, modulation, melodic, interactive) with `createdAt = 0`; user-created snippets sort newer-first above the starters. Starred items sort first overall.

1.5 Each snippet has `id`, `title`, `code`, `tags`, `createdAt`. Operations: add, update (title/code/tags), delete (also removes from starred), toggle star.

1.6 **Reference target version.** Reference content is tagged by uSEQ language version; the user may switch the target version via a control. The chosen version persists.

1.7 **Search.** Snippets and reference both expose a single search box that filters by title/code/tags and by name/description/tags respectively. Search is case-insensitive substring; ranking promotes title matches over body matches.

## 2. Onboarding

2.1 An **onboarding banner** is shown when both: the runtime mode is `none` (see [runtime-modes.md §1.2](runtime-modes.md)) *and* the user has not previously dismissed the banner.

2.2 Dismissing the banner persists `useq:onboarding-dismissed` and the banner does not return until that key is cleared. `?nosave` keeps the banner from being permanently dismissed.

2.3 The banner explains how to connect hardware or proceed in WASM-only mode and provides at least one actionable button (e.g. connect, learn more).

2.4 The banner must not occlude the editor; it docks in a non-intrusive region.
