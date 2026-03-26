import { Component, createSignal, createEffect, on, onMount, onCleanup, Show } from "solid-js";
import { MiniVis } from "../lessons/MiniVis";
import type { VisSignal } from "./guideTypes";
import {
  evalInUseqWasm,
  evalOutputAtTime,
  ensureUseqWasmLoaded,
  wasmRuntimePort,
} from "../../../runtime/wasmInterpreter";

const SAMPLE_COUNT = 200;
const DEBOUNCE_MS = 300;
const PERF_BUDGET_MS = 100;
const WASM_POLL_MS = 1000;

interface LiveProbeProps {
  code: string;
  outputs?: string[];
  fallbackSignals?: VisSignal[];
  height?: number;
  /** Number of bars the x-axis spans. Defaults to 1. */
  bars?: number;
}

export const LiveProbe: Component<LiveProbeProps> = (props) => {
  const [signals, setSignals] = createSignal<VisSignal[]>(
    props.fallbackSignals ?? [],
  );
  const [wasmReady, setWasmReady] = createSignal(false);
  const [hasError, setHasError] = createSignal(false);
  const [isComplex, setIsComplex] = createSignal(false);

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let wasmPollTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  async function probe(code: string, outputs: string[]) {
    if (disposed) return;

    // // console.debug("[LiveProbe] probe()", { code: code.slice(0, 60), outputs });

    // Check WASM availability
    const caps = wasmRuntimePort.capabilities();
    // console.debug("[LiveProbe] capabilities:", caps);
    if (!caps.enabled) {
      // console.debug("[LiveProbe] WASM not enabled, scheduling poll");
      setWasmReady(false);
      scheduleWasmPoll(code, outputs);
      return;
    }

    // Try to ensure WASM is actually loaded (not just enabled in settings)
    try {
      // console.debug("[LiveProbe] calling ensureUseqWasmLoaded...");
      await ensureUseqWasmLoaded();
      // console.debug("[LiveProbe] WASM loaded successfully");
    } catch {
      // console.warn("[LiveProbe] ensureUseqWasmLoaded failed:", e);
      setWasmReady(false);
      scheduleWasmPoll(code, outputs);
      return;
    }

    if (disposed) return;
    setWasmReady(true);

    try {
      // Evaluate the code to register definitions
      // console.debug("[LiveProbe] evaluating code...");
      const evalResult = await evalInUseqWasm(code);
      // console.debug("[LiveProbe] eval result:", evalResult);
    } catch {
      // console.warn("[LiveProbe] evalInUseqWasm failed:", e);
      setHasError(true);
      return;
    }

    if (disposed) return;

    // Sample each output across a 0-1 second window
    const start = performance.now();
    const newSignals: VisSignal[] = [];

    for (const outputName of outputs) {
      const samples: number[] = [];
      let failed = false;

      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const elapsed = performance.now() - start;
        if (elapsed > PERF_BUDGET_MS) {
          // console.warn("[LiveProbe] perf budget exceeded at", elapsed, "ms");
          setIsComplex(true);
          return;
        }

        const barsCount = props.bars ?? 1;
        const time = (i / (SAMPLE_COUNT - 1)) * barsCount;
        try {
          const value = await evalOutputAtTime(outputName, time);
          samples.push(Number.isFinite(value) ? value : 0);
        } catch {
          failed = true;
          break;
        }
      }

      if (failed) {
        // console.warn("[LiveProbe] sampling failed for", outputName);
        setHasError(true);
        return;
      }

      // Determine if digital (only 0 or 1 values)
      const isDigital = samples.every((v) => v === 0 || v === 1);

      newSignals.push({
        label: outputName,
        fn: (phase: number) => {
          const idx = Math.min(
            Math.round(phase * (SAMPLE_COUNT - 1)),
            SAMPLE_COUNT - 1,
          );
          return samples[idx] ?? 0;
        },
        digital: isDigital,
      });
    }

    if (disposed) return;
    // console.debug("[LiveProbe] success!", newSignals.length, "signals sampled in", (performance.now() - start).toFixed(1), "ms");
    setSignals(newSignals);
    setHasError(false);
    setIsComplex(false);
  }

  function scheduleWasmPoll(code: string, outputs: string[]) {
    clearTimeout(wasmPollTimer);
    if (disposed) return;
    wasmPollTimer = setTimeout(() => {
      probe(code, outputs);
    }, WASM_POLL_MS);
  }

  // Re-probe when code or outputs change (debounced)
  createEffect(
    on(
      () => [props.code, props.outputs] as const,
      ([code, outputs]) => {
        if (!outputs || outputs.length === 0) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          probe(code, outputs);
        }, DEBOUNCE_MS);
      },
    ),
  );

  // Also probe immediately on mount (catches case where WASM is already loaded)
  onMount(() => {
    const outputs = props.outputs;
    // console.debug("[LiveProbe] mounted, outputs:", outputs);
    if (outputs && outputs.length > 0) {
      probe(props.code, outputs);
    }
  });

  onCleanup(() => {
    disposed = true;
    clearTimeout(debounceTimer);
    clearTimeout(wasmPollTimer);
  });

  const height = () => props.height ?? 80;

  return (
    <div class="live-probe" style={{ position: "relative" }}>
      <MiniVis signals={signals()} height={height()} bars={props.bars} />

      <Show when={!wasmReady() && !signals().length}>
        <div
          class="live-probe-overlay"
          style={{
            position: "absolute",
            inset: "0",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "pointer-events": "none",
          }}
        >
          <span
            style={{
              "font-size": "10px",
              opacity: "0.4",
              "font-family": "var(--code-font, monospace)",
            }}
          >
            loading interpreter...
          </span>
        </div>
      </Show>

      <Show when={hasError()}>
        <div
          class="live-probe-error"
          style={{
            position: "absolute",
            top: "4px",
            right: "4px",
            width: "6px",
            height: "6px",
            "border-radius": "50%",
            "background-color": "#ff4444",
            opacity: "0.7",
          }}
        />
      </Show>

      <Show when={isComplex()}>
        <div
          class="live-probe-complex"
          style={{
            position: "absolute",
            bottom: "4px",
            right: "6px",
            "font-size": "9px",
            opacity: "0.35",
            "font-family": "var(--code-font, monospace)",
          }}
        >
          complex expression
        </div>
      </Show>
    </div>
  );
};
