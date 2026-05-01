# uSEQ Wire Protocol

> **This document has moved.**
>
> The canonical wire-protocol spec now lives in the firmware repo:
> [`src-useq/docs/specs/wire-protocol.md`](../src-useq/docs/specs/wire-protocol.md).
>
> The wire protocol is a contract between firmware (which receives) and
> editor (which sends), and the firmware side is the authoritative
> receiver. Keeping the spec there means it stays bundled with the code
> that has to honour it.
>
> The previous contents of this file were a mix of historical legacy mode,
> current behaviour, and aspirational future shape, and had drifted from
> both implementations. They are deliberately not preserved here — the new
> spec supersedes them outright. See `src-useq/docs/specs/wire-protocol.md
> §10` for the migration notes describing what was removed and what
> changed.
