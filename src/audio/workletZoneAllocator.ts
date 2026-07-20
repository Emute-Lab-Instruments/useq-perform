/**
 * Host-owned shared-memory zone allocator (synthesis epic M2.1,
 * ergo 9a9370af).
 *
 * Normative contract (`synthesis.md` §2.3, §3.5):
 *
 *   - The worklet host owns a single WASM linear memory with a zone
 *     allocator; per-instance DSP state and audio I/O buffers are
 *     host-allocated zones, and node ports are offsets into that
 *     memory — patch-graph "stitching" is pointer wiring.
 *   - The arena is bounded (`SYNTH_MEMORY_MAX_BYTES`); zone exhaustion
 *     returns `-1` so the caller can surface a diagnostic — the arena
 *     never grows unboundedly and never throws on the audio thread.
 *   - Zones released by the retire-sweep are reclaimable: freed spans
 *     coalesce with adjacent free spans so long sessions do not
 *     fragment the arena into unusable slivers.
 *
 * Design:
 *
 *   - First-fit over a free list kept sorted by offset. Allocation and
 *     release run only at graph-mutation boundaries (never inside the
 *     steady-state `process()` path — VAL-ENGINE-034), so O(n) scans
 *     over at most `MAX_SYNTH_NODES`-order spans are fine.
 *   - The low `SYNTH_ARENA_NULL_GUARD_BYTES` bytes are never handed
 *     out: graph-delta messages use pointer 0 as the "worklet
 *     allocates on my behalf" sentinel, so offset 0 must never be a
 *     valid zone.
 *   - Alignment is honoured by carving the aligned span out of a free
 *     block and returning any leading/trailing remainder to the free
 *     list.
 *   - The allocator is pure JS with no `WebAssembly` dependency: the
 *     worklet shell instantiates it over the real memory buffer,
 *     Vitest instantiates it over a plain `ArrayBuffer` (or nothing at
 *     all — it only does offset arithmetic).
 */

import { SYNTH_ARENA_NULL_GUARD_BYTES } from "../contracts/synthesisControlAbi";
import type { WorkletMemoryAllocator } from "./workletCore";

/** Options for {@link createZoneAllocator}. */
export interface ZoneAllocatorOptions {
  /**
   * Total arena bound in bytes. Allocations never reach past this.
   * The worklet shell passes `min(memory.buffer.byteLength,
   * SYNTH_MEMORY_MAX_BYTES)`.
   */
  readonly limitBytes: number;
  /**
   * First allocatable byte. Defaults to
   * {@link SYNTH_ARENA_NULL_GUARD_BYTES} so pointer 0 stays the null
   * sentinel.
   */
  readonly baseOffset?: number;
}

/**
 * Zone allocator over the host-owned arena. Implements the
 * {@link WorkletMemoryAllocator} seam the worklet core consumes, plus
 * accounting accessors for tests and telemetry.
 */
export interface ZoneAllocator extends WorkletMemoryAllocator {
  /** First allocatable byte offset. */
  readonly baseOffset: number;
  /** Arena bound in bytes. */
  readonly limitBytes: number;
  /** Total bytes currently allocated (excludes alignment gaps). */
  allocatedBytes(): number;
  /** Total bytes currently free. */
  freeBytes(): number;
  /** Number of live zones. */
  zoneCount(): number;
}

/**
 * Create a first-fit, coalescing zone allocator over `[baseOffset,
 * limitBytes)`.
 */
export function createZoneAllocator(options: ZoneAllocatorOptions): ZoneAllocator {
  const baseOffset = Math.max(
    options.baseOffset ?? SYNTH_ARENA_NULL_GUARD_BYTES,
    1,
  );
  const limitBytes = Math.max(options.limitBytes, baseOffset);

  // Free spans sorted by offset, non-adjacent by construction (release
  // coalesces). Parallel arrays keep the structure allocation-light.
  const freeOffsets: number[] = [baseOffset];
  const freeSizes: number[] = [limitBytes - baseOffset];

  // Live zones: pointer → byte length.
  const zones = new Map<number, number>();
  let allocated = 0;

  function alignUp(offset: number, align: number): number {
    const a = align > 0 ? align : 1;
    return Math.ceil(offset / a) * a;
  }

  function allocate(bytes: number, align: number): number {
    if (!(bytes > 0)) return -1;
    for (let i = 0; i < freeOffsets.length; i++) {
      const start = freeOffsets[i];
      const size = freeSizes[i];
      const aligned = alignUp(start, align);
      const leadingGap = aligned - start;
      if (leadingGap + bytes > size) continue;

      // Carve [aligned, aligned + bytes) out of this span.
      const trailing = size - leadingGap - bytes;
      if (leadingGap > 0 && trailing > 0) {
        // Keep the leading gap in place, insert the trailing remainder.
        freeSizes[i] = leadingGap;
        freeOffsets.splice(i + 1, 0, aligned + bytes);
        freeSizes.splice(i + 1, 0, trailing);
      } else if (leadingGap > 0) {
        freeSizes[i] = leadingGap;
      } else if (trailing > 0) {
        freeOffsets[i] = aligned + bytes;
        freeSizes[i] = trailing;
      } else {
        freeOffsets.splice(i, 1);
        freeSizes.splice(i, 1);
      }

      zones.set(aligned, bytes);
      allocated += bytes;
      return aligned;
    }
    return -1;
  }

  function release(pointer: number): void {
    const bytes = zones.get(pointer);
    if (bytes === undefined) {
      // Unknown or double release: tolerated (best-effort cleanup path,
      // mirrors the core's release semantics).
      return;
    }
    zones.delete(pointer);
    allocated -= bytes;

    // Insert the span sorted by offset, then coalesce with neighbours.
    let insertAt = freeOffsets.length;
    for (let i = 0; i < freeOffsets.length; i++) {
      if (freeOffsets[i] > pointer) {
        insertAt = i;
        break;
      }
    }
    freeOffsets.splice(insertAt, 0, pointer);
    freeSizes.splice(insertAt, 0, bytes);

    // Coalesce with the following span.
    if (
      insertAt + 1 < freeOffsets.length &&
      freeOffsets[insertAt] + freeSizes[insertAt] === freeOffsets[insertAt + 1]
    ) {
      freeSizes[insertAt] += freeSizes[insertAt + 1];
      freeOffsets.splice(insertAt + 1, 1);
      freeSizes.splice(insertAt + 1, 1);
    }
    // Coalesce with the preceding span.
    if (
      insertAt > 0 &&
      freeOffsets[insertAt - 1] + freeSizes[insertAt - 1] === freeOffsets[insertAt]
    ) {
      freeSizes[insertAt - 1] += freeSizes[insertAt];
      freeOffsets.splice(insertAt, 1);
      freeSizes.splice(insertAt, 1);
    }
  }

  return {
    baseOffset,
    limitBytes,
    allocate,
    release,
    allocatedBytes: () => allocated,
    freeBytes: () => freeSizes.reduce((sum, s) => sum + s, 0),
    zoneCount: () => zones.size,
  };
}
