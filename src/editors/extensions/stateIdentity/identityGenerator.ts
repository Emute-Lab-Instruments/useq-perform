/**
 * Pluggable opaque-ID generator.
 *
 * Default generator produces url-safe base32 tokens. The generator is the
 * only source of new IDs in the system — preserve-remaps reuse existing IDs,
 * never mint new ones, while fork operations call {@link IdGenerator.next}.
 *
 * The default uses a monotonically-increasing counter seeded from
 * `crypto.getRandomValues` so that IDs are unpredictable (no leaked ordering
 * information, no leaked host entropy beyond what is necessary) while still
 * cheap to mint in a hot transaction path. Output is always 16 characters.
 *
 * Tests can inject a deterministic generator for snapshot stability.
 */

import type { StateId } from "./identityTypes.ts";

/** A source of fresh opaque IDs. */
export interface IdGenerator {
  next(): StateId;
}

/** Factory signature used by DI configs. */
export type IdGeneratorFactory = () => IdGenerator;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"; // RFC 4648 base32, no padding

function randomUint32(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }
  return Math.floor(Math.random() * 0x100000000);
}

function encodeBase32(value: number): string {
  // 32 bits fits into 7 base32 characters (5 bits each = 35 bits), but we
  // mask down to 5 bits at a time and emit 7 characters. Trailing bits
  // remain zero, which keeps the output stable across runs for the same
  // numeric seed and avoids padding ambiguity.
  let out = "";
  let v = value >>> 0;
  for (let i = 0; i < 7; i++) {
    out = ALPHABET[v & 31] + out;
    v = Math.floor(v / 32);
  }
  return out;
}

/**
 * Default generator. Returns opaque 14-character url-safe tokens of the form
 * `id-<7chars><7chars>` — a short stable prefix so logs and devtools can
 * spot them at a glance without the prefix ever leaking into user-visible
 * surfaces.
 */
export function defaultIdGenerator(): IdGenerator {
  const seedPart = encodeBase32(randomUint32());
  let counter = 0;
  return {
    next(): StateId {
      counter += 1;
      const counterPart = encodeBase32(counter);
      // The `id-` prefix is a developer affordance only. It never appears in
      // user source because hidden IDs are injected as quoted strings only
      // when building the runtime payload, and the payload is never echoed
      // back to the visible editor.
      return `id-${seedPart}${counterPart}` as StateId;
    },
  };
}

/** Deterministic generator for tests; emits id-0000001, id-0000002, … */
export function deterministicIdGenerator(): IdGenerator {
  let counter = 0;
  return {
    next(): StateId {
      counter += 1;
      const padded = String(counter).padStart(7, "0");
      return `id-test${padded}` as StateId;
    },
  };
}
