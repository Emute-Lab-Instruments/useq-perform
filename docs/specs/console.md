---
stability: stable
layer: behavioural
---

# Console

> Spec: console panel. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/utils/consoleStore.ts` — reactive message buffer, line limit, message types
- `src/ui/console/ConsolePanel.tsx` — console panel UI component (rendering, auto-scroll, animation)

1.1 The console panel displays a chronological message log: `log`, `warn`, `error`, and `wasm` types (the latter for WASM-evaluated result echoes). (see `src/utils/consoleStore.ts` for message types and buffer, `src/ui/console/ConsolePanel.tsx` for rendering)

1.2 Each entry has a timestamp and a type badge. Type badge visibility is `console.showTypeBadge` (advanced; default true). Timestamp visibility is `console.showTimestamp` (default true).

1.3 **Line limit.** The console caps stored messages at `ui.consoleLinesLimit` (default 1000). Beyond the limit, the oldest message is dropped per new message. (see `src/utils/consoleStore.ts`)

1.4 The console supports **inline markdown in content**: `**bold**`, `*italic*`, `` `code` ``, and `[label](https://example.com)` links. Other HTML must be escaped.

1.5 New entries animate in. Animation style is `console.entryAnimation` (`slide`, `fade`, `none`, default `slide`). The `slide` and `fade` styles are independent per-entry CSS transitions (all new entries animate concurrently). **Typewriter** mode reveals text at `console.typewriterIntervalMs` (default 20ms) per character and is the only serialized style: a queue ensures only one entry typewrites at a time. **Burst pressure valve** (typewriter only): when > 3 messages are pending in the typewriter queue, all pending messages appear instantly and animation resumes for subsequent messages. (see `src/ui/console/ConsolePanel.tsx`)

1.6 **Auto-scroll.** When the user is within ~30 px of the bottom, new entries auto-scroll. When the user has scrolled away, an unread indicator appears and auto-scroll is suspended until the user scrolls back to the bottom or invokes a "scroll to latest" affordance. (see `src/ui/console/ConsolePanel.tsx`)

1.7 The console is the canonical surface for serial `{type:"log",...}` messages, **eval result echoes**, **runtime warnings**, and **bootstrap notices**. Errors that have a corresponding inline diagnostic must still appear in the console as a message.

1.8 A **clear** action wipes the message buffer. A compact **filter row** between the title bar and the log provides view-only filtering: per-type toggles (`log` / `warn` / `error` / `wasm`), a case-insensitive text search that matches each entry's **stripped** plain text, and a match count (`visible/total`, shown only while a filter is active). Filtering never drops messages from the store; auto-scroll and unread behaviour (§1.6) keep operating against the filtered view. A filter change that hides the currently-typewriting entry treats that entry as finished so the typewriter queue keeps advancing.

1.9 **Copy affordance.** Each entry has a hover "copy" control that copies the entry's plain (stripped) text to the clipboard.

1.10 **Layout persistence.** The panel's size, position, collapsed state, and per-type filter toggles persist under the `consoleLayout` key through the central persistence service, so `?nosave` gates writes (see [persistence.md](persistence.md)). The panel is dragged by its title bar; a drag switches it from the default bottom-right anchor to a viewport position. Restored geometry is clamped to the current viewport and to `MIN_W`/`MIN_H`; missing or corrupt persisted fields fall back to defaults (persistence.md §1.6).

## Open / Deferred

2.1 **Console filtering** — resolved. Per-type toggles, text search, and a match count shipped as the view-only filter row (§1.8); the chronological store itself remains unfiltered.
