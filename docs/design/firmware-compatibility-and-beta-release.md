# Firmware compatibility and beta release

Status: prepared, not deployed. Last reviewed: 2026-08-05. Tracking epic:
ergo `dc3933e2`; production cutover: `6fc96486`.

## Decision

Ship one current editor. It negotiates the transport and keeps a deliberately
small pre-1.2 adapter for core evaluation. Keep only the current v1.2 compiler
in WASM: running an old interpreter in a second WASM bundle would duplicate the
largest and fastest-changing semantic surface. When legacy hardware is
authoritative, the current WASM stays available for browser-local work but is
not used to manufacture inline results, diagnostics, or future projections for
that hardware evaluation.

At cutover, preserve the exact previously deployed editor at `/legacy/`. This
is a rollback and diagnosis surface, not the primary compatibility mechanism.
It must be copied from the live deployment immediately before replacing `/`;
building an old Git revision later is not equivalent to preserving what users
actually had.

## User-facing differences

| Area | Pre-1.2 firmware | v1.2 firmware/editor |
| --- | --- | --- |
| Connect | A safe raw/text firmware-info probe runs before any JSON bytes | JSON `hello`, explicit version, protocol, target, capabilities, and I/O config |
| Evaluate | Raw ModuLisp; `@` means immediate and no prefix means the old quantised path | JSON eval requests; current firmware owns quantisation |
| Feedback | Framed text messages; no request identity or structured result | Request-correlated result, console text, metadata, and diagnostics |
| Visualisation | Existing fixed binary stream only; no subscription negotiation | Configured stream channels/rates plus current WASM shadow/projection |
| Errors | Text output and legacy interpreter behaviour | Source spans, categories, suggestions, per-output health, last-known-good policy |
| Live controls | Old physical-input and firmware-specific forms | `live-edit` slots, state snapshots, binary input updates, hardware events, calibration |
| Language/runtime | Old tree-walking interpreter and its historical builtins/semantics | Compiled signal DAG, reactive cells/functions, declared state and UGens, current limits and diagnostics |
| Update UX | Target cannot be identified over the old protocol, so the user must choose it | Firmware reports the exact target; the updater preselects the matching UF2 |

The language row is a compatibility warning, not an exhaustive rename table.
Git history confirms that the old 1.1.1 surface included hardware/flash forms
such as `knob`, `rot`, `sw*`, `useq-memory-*`, and clock/scheduler operations,
while the current compiler adds or formalises reactive functions, declared
state/UGens, `live-edit`, state identity, structured failure semantics, and
synth declarations. Code using only names accepted by both runtimes can still
differ semantically; the attached firmware's result is authoritative.

## Differences that matter to the editor

| Contract | Legacy adapter | Protocol v1 |
| --- | --- | --- |
| Framing | Accept `0x1f 0x20` and `0x1f 0x64`, terminated by CRLF | Accept bare JSON lines; transitional framed JSON remains readable |
| Requests | At most one captured text reply; no correlation ID | Concurrent request map keyed by `requestId` and timeouts |
| Capabilities | Fixed conservative set: raw eval and legacy stream | Advertised additive capability names |
| Hardware identity | Version only; target unknown | Version, protocol number, exact build target, capabilities |
| Connection health | No heartbeat | JSON ping heartbeat |
| State/config | No I/O config, state snapshot, failure-mode sync, live-input slot sync, or calibration API | All are explicit JSON messages |
| Diagnostics | Console text only | Eval and unsolicited structured diagnostics |
| WASM relationship | No shadowing: current WASM cannot truthfully stand in for the old interpreter | Current WASM is the matching browser-local/shadow profile |

Probe order is a correctness property, not a latency preference. The 1.1.1
receive loop treats any first byte other than `@` or the binary stream marker
as scheduled ModuLisp, so sending JSON first would mutate its run queue. The
legacy probe is newline-terminated; current JSON firmware can reject and
discard that complete line before accepting `hello`.

The adapter must not grow feature-by-feature. A JSON-only caller rejects in
legacy mode. Temporary complexity exists solely for the named requirement:
people with already-shipped modules must retain core live coding while they
decide whether to update. Remove it after supported users are upgraded and the
legacy endpoint has completed an announced retirement window.

## Beta channel

Firmware uses SemVer prereleases: `1.2.0-beta.1`, `1.2.0-beta.2`, …, followed
by `1.2.0`. Stable `1.2.0` sorts after every `1.2.0-beta.N`. The firmware build
identity is compiled into one header and returned by both `ready` and `hello`.
Every beta increment is a source commit changing that identity, so an artifact
cannot silently acquire a new public version without a reviewable firmware
change.

The editor checks `/firmware/beta/manifest.json` only after a successful
hardware handshake. Absence (404) means no public beta and produces no prompt.
The manifest names the version, channel, publication time, exact hardware
target, immutable same-origin UF2 URL, byte size, and SHA-256. The updater
downloads into memory, checks size and hash, then enables the browser download.
SHA-256 catches corruption or a mismatched file after the manifest is loaded;
the same-origin manifest is not a publisher signature.

Prepare a release from reviewed UF2 files:

```sh
npm run prepare:firmware-beta -- \
  --version 1.2.0-beta.1 \
  --artifact musicthing=/path/to/musicthing.uf2 \
  --artifact hardware_v0_2=/path/to/hardware_v0_2.uf2 \
  --artifact hardware_v1_0=/path/to/hardware_v1_0.uf2 \
  --notes /path/to/release-notes.html
```

Review the generated immutable directory and manifest together. Publishing
the static files activates the editor prompt; removing the manifest disables
new offers without removing already-published artifacts.

## Cutover gate

Do not replace production merely because native/unit tests pass. Complete all
of the following under ergo `6fc96486`:

1. Record the deployed root's exact files and hashes, then copy that exact tree
   to `/legacy/`; verify it loads and can read a mirrored `useqcode` value.
2. Test the new root in the release Chromium browser with a physical 1.1.1
   module: detect legacy mode, preserve `@`/unprefixed eval semantics, receive
   time/value streams, save code, reload, and open `/legacy/` without loss.
3. Test a physical beta module for every published hardware target: identity,
   JSON eval, heartbeat, diagnostics, stream configuration, update prompt,
   1200-baud BOOTSEL handoff, selected artifact, size/hash verification, flash,
   reboot, and reconnect.
4. Test WASM-only startup and JSON-hardware shadow mode so the compatibility
   branch has not changed the current path.
5. Publish immutable beta artifacts first, manifest last; replace `/` only
   after `/legacy/` works. Keep the previous root available for atomic rollback.

No beta UF2, manifest, legacy archive, DNS, or production root is changed by
the preparation commit.
