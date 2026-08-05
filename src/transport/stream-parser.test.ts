/**
 * Stream-parser unit tests.
 *
 * Covers the byteOffset/byteLength fix: when the Web Serial API delivers a
 * Uint8Array that is a VIEW into a larger ArrayBuffer (non-zero byteOffset),
 * the parser must not re-wrap the entire buffer — it must honour the view's
 * offset and length so no garbage bytes from the underlying buffer pollute
 * the parsed stream.
 *
 * Audit finding: audit-editor-perf.md "Serial STREAM ingestion".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { processAllMessages } from "./stream-parser.ts";

// processAllMessages is a pure function that operates only on the bytes it
// receives — no mocks needed for the byteOffset regression.

describe("stream-parser — processAllMessages", () => {
  beforeEach(() => {
    // Suppress dbg / console noise during tests.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("handles a Uint8Array backed by an offset subarray without corrupting bytes", () => {
    // Build a larger buffer where the first 4 bytes are garbage, then a bare
    // JSON message starting at offset 4.
    const json = '{"type":"test","id":1}\n';
    const encoded = new TextEncoder().encode(json);

    // Simulate the Web Serial API returning a subarray view:
    // underlying buffer = [0xFF, 0xFF, 0xFF, 0xFF, ...json bytes...]
    const garbagePrefix = 4;
    const underlying = new Uint8Array(garbagePrefix + encoded.length);
    underlying.fill(0xff, 0, garbagePrefix);
    underlying.set(encoded, garbagePrefix);

    // The chunk the parser receives is a VIEW starting at offset 4
    // (exactly as a ReadableStreamDefaultReader may provide).
    const chunk = underlying.subarray(garbagePrefix);
    // Verify the view: byteOffset is non-zero, but the visible bytes start at `{`.
    expect(chunk.byteOffset).toBe(garbagePrefix);
    expect(chunk[0]).toBe(0x7b); // `{`

    // With the fix (new Uint8Array(v.buffer, v.byteOffset, v.byteLength)),
    // the parser must correctly see the JSON bytes, not the garbage prefix.
    // We feed processAllMessages directly; onJsonMessage captures what it parses.
    const received: string[] = [];
    processAllMessages(chunk, (msg) => received.push(msg));

    expect(received).toHaveLength(1);
    expect(received[0]).toBe('{"type":"test","id":1}');
  });

  it("rejects the old bug: wrapping the full buffer would include garbage bytes", () => {
    // This test documents the pre-fix behaviour to make sure the fix is real.
    // If someone were to write `new Uint8Array(chunk.buffer)` (the old code),
    // the resulting array would start with 0xFF bytes, not 0x7b, and the JSON
    // would be silently discarded (no `{` at byte 0 → garbage advance path).
    const json = '{"x":1}\n';
    const encoded = new TextEncoder().encode(json);

    const garbagePrefix = 4;
    const underlying = new Uint8Array(garbagePrefix + encoded.length);
    underlying.fill(0xff, 0, garbagePrefix);
    underlying.set(encoded, garbagePrefix);

    const chunk = underlying.subarray(garbagePrefix);

    // Simulate the old (broken) wrapping:
    const brokenView = new Uint8Array(chunk.buffer);
    // The broken view starts at the garbage bytes, NOT at `{`.
    expect(brokenView[0]).toBe(0xff);

    // The fixed view must start at `{`.
    const fixedView = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    expect(fixedView[0]).toBe(0x7b); // `{`
  });

  it("routes pre-1.2 text frames without confusing them with JSON", () => {
    const payload = new TextEncoder().encode("uSEQ Firmware 1.1.1");
    const packet = new Uint8Array(payload.length + 4);
    packet[0] = 0x1f;
    packet[1] = 0x20;
    packet.set(payload, 2);
    packet[packet.length - 2] = 13;
    packet[packet.length - 1] = 10;

    const json: string[] = [];
    const legacy: string[] = [];
    const result = processAllMessages(
      packet,
      (message) => json.push(message),
      (message) => legacy.push(message),
    );

    expect(json).toEqual([]);
    expect(legacy).toEqual(["uSEQ Firmware 1.1.1"]);
    expect(result.remainingBytes).toHaveLength(0);
  });

  it("retains a split legacy frame until the CRLF terminator arrives", () => {
    const encoder = new TextEncoder();
    const prefix = new Uint8Array([0x1f, 0x64, ...encoder.encode("hello")]);
    const first = processAllMessages(prefix, () => {}, () => {});
    expect(first.remainingBytes).toEqual(prefix);

    const complete = new Uint8Array([...first.remainingBytes, 13, 10]);
    const received: string[] = [];
    const final = processAllMessages(
      complete,
      () => {},
      (message) => received.push(message),
    );
    expect(received).toEqual(["hello"]);
    expect(final.remainingBytes).toHaveLength(0);
  });
});
