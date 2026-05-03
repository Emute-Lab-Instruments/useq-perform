# Console

> Spec: console panel. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/utils/consoleStore.ts` — reactive message buffer, line limit, message types
- `src/ui/console/ConsolePanel.tsx` — console panel UI component (rendering, auto-scroll, animation)

1.1 The console panel displays a chronological message log: `log`, `warn`, `error`, and `wasm` types (the latter for WASM-evaluated result echoes). (see `src/utils/consoleStore.ts` for message types and buffer, `src/ui/console/ConsolePanel.tsx` for rendering)

1.2 Each entry has a timestamp and a type badge. Type badge visibility is `console.showTypeBadge` (advanced; default true). Timestamp visibility is `console.showTimestamp` (default true).

1.3 **Line limit.** The console caps stored messages at `ui.consoleLinesLimit` (default 1000). Beyond the limit, the oldest message is dropped per new message. (see `src/utils/consoleStore.ts`)

1.4 The console supports **inline markdown in content**: `**bold**`, `*italic*`, `` `code` ``, and `[label](url)` links. Other HTML must be escaped.

1.5 New entries animate in. Animation style is `console.entryAnimation` (`slide`, `fade`, `none`, default `slide`). Typewriter mode reveals text at `console.typewriterIntervalMs` (default 20ms) per character. A queue ensures only one entry animates at a time. **Burst pressure valve**: when > 3 messages are pending in the animation queue, all pending messages appear instantly and animation resumes for subsequent messages. (see `src/ui/console/ConsolePanel.tsx`)

1.6 **Auto-scroll.** When the user is within ~30 px of the bottom, new entries auto-scroll. When the user has scrolled away, an unread indicator appears and auto-scroll is suspended until the user scrolls back to the bottom or invokes a "scroll to latest" affordance. (see `src/ui/console/ConsolePanel.tsx`)

1.7 The console is the canonical surface for serial `{type:"log",...}` messages, **eval result echoes**, **runtime warnings**, and **bootstrap notices**. Errors that have a corresponding inline diagnostic must still appear in the console as a message.

1.8 A **clear** action wipes the message buffer. There is no per-type filter UI in v1.

## Open / Deferred

2.1 **Console filtering.** No per-type filter UI exists in v1. Whether to add filters/levels or keep the chronological log unfiltered is open.
