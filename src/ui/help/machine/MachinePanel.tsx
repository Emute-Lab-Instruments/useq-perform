/**
 * The Machine — the live schematic of how uSEQ thinks.
 *
 * Spec: `docs/specs/the-machine.md` §2. One scene, three regions left to
 * right: clock, program, outputs. Selecting a region reveals that idea's
 * one-paragraph explanation and an embedded playground (§2.3).
 *
 * `MachinePanel` is a pure view: it renders exactly the `MachineSnapshot` it
 * is handed and owns no subscription. `WiredMachinePanel` builds that
 * snapshot from the real stores and channels via `machineEvents.ts`.
 *
 * The honesty rule (§1.2) is structural here: nothing in this component
 * animates on a timer. The clock hand moves because `phase` changed, a row
 * flashes because `evalPulse` changed, a jack spark redraws because the
 * sampler reported new values. With no runtime, the scene renders visibly
 * quiescent (§6.3) rather than looping.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Component,
} from "solid-js";

import { PlaygroundBlock } from "../guide/Playground";
import { createMachineSources, type MachineSourceOverrides } from "./machineEvents";
import {
  MACHINE_REGIONS,
  QUIESCENT_SNAPSHOT,
  deriveRows,
  ideasForRegion,
  isHoldingLastGood,
  phaseAngleDegrees,
  rowStateLabel,
  sparkPoints,
  type MachineRegionId,
  type MachineSnapshot,
} from "./machineModel";

/** How long a program row stays flashed after an evaluation. */
const EVAL_FLASH_MS = 700;

const SPARK_WIDTH = 56;
const SPARK_HEIGHT = 18;
const DIAL_RADIUS = 22;

// ---------------------------------------------------------------------------
// Pure view
// ---------------------------------------------------------------------------

export interface MachinePanelProps {
  snapshot: MachineSnapshot;
  /** Region whose idea material is revealed, or null for the bare scene. */
  selectedRegion?: MachineRegionId | null;
  onSelectRegion?: (region: MachineRegionId | null) => void;
  /**
   * Render the embedded playgrounds for the selected region. Defaults to
   * true; the guide's opening block turns them off because chapter 0 already
   * carries the same playgrounds a few lines further down.
   */
  showPlaygrounds?: boolean;
}

export const MachinePanel: Component<MachinePanelProps> = (props) => {
  const snapshot = () => props.snapshot;
  const live = () => snapshot().live;
  const selected = () => props.selectedRegion ?? null;

  // Flash the program region when — and only when — an evaluation happened.
  const [flashing, setFlashing] = createSignal(false);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(
    on(
      () => snapshot().evalPulse,
      (pulse, prevPulse) => {
        if (prevPulse === undefined || pulse === prevPulse) return;
        setFlashing(true);
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => setFlashing(false), EVAL_FLASH_MS);
      },
    ),
  );

  onCleanup(() => clearTimeout(flashTimer));

  const handAngle = createMemo(() => phaseAngleDegrees(snapshot().clock.phase));

  const toggleRegion = (region: MachineRegionId) => {
    props.onSelectRegion?.(selected() === region ? null : region);
  };

  return (
    <div
      class="machine"
      classList={{ "machine--quiescent": !live() }}
      data-testid="machine"
      data-live={live() ? "true" : "false"}
    >
      <div class="machine-scene" role="group" aria-label="How uSEQ thinks">
        {/* ── Clock ──────────────────────────────────────────────── */}
        <button
          type="button"
          class="machine-region machine-region--clock"
          classList={{ "machine-region--selected": selected() === "clock" }}
          aria-pressed={selected() === "clock"}
          data-testid="machine-region-clock"
          onClick={() => toggleRegion("clock")}
        >
          <span class="machine-region-title">{MACHINE_REGIONS[0].title}</span>
          <svg
            class="machine-dial"
            viewBox="0 0 56 56"
            aria-hidden="true"
            data-testid="machine-dial"
            data-clock-state={snapshot().clock.state}
          >
            <circle
              class="machine-dial-face"
              cx="28"
              cy="28"
              r={DIAL_RADIUS}
              fill="none"
            />
            <line
              class="machine-dial-hand"
              data-testid="machine-dial-hand"
              x1="28"
              y1="28"
              x2="28"
              y2={28 - DIAL_RADIUS + 3}
              transform={`rotate(${handAngle().toFixed(2)} 28 28)`}
            />
          </svg>
          <span class="machine-region-caption">{MACHINE_REGIONS[0].caption}</span>
          <span class="machine-clock-state" data-testid="machine-clock-state">
            {snapshot().clock.state}
          </span>
        </button>

        <span class="machine-flow" aria-hidden="true">
          {"→"}
        </span>

        {/* ── Program ────────────────────────────────────────────── */}
        <button
          type="button"
          class="machine-region machine-region--program"
          classList={{
            "machine-region--selected": selected() === "program",
            "machine-region--flash": flashing(),
          }}
          aria-pressed={selected() === "program"}
          data-testid="machine-region-program"
          data-flashing={flashing() ? "true" : "false"}
          onClick={() => toggleRegion("program")}
        >
          <span class="machine-region-title">{MACHINE_REGIONS[1].title}</span>
          <span class="machine-rows" data-testid="machine-rows">
            <Show
              when={snapshot().rows.length > 0}
              fallback={
                <span class="machine-rows-empty" data-testid="machine-rows-empty">
                  nothing running
                </span>
              }
            >
              <For each={snapshot().rows}>
                {(row) => (
                  <span
                    class="machine-row"
                    data-testid={`machine-row-${row.output}`}
                    data-state={row.state}
                    data-lkg={isHoldingLastGood(row) ? "true" : "false"}
                    title={row.message}
                  >
                    <span
                      class="machine-row-output"
                      style={row.colour ? { color: row.colour } : undefined}
                    >
                      {row.output}
                    </span>
                    <span class="machine-row-expr">
                      {row.expressionText ?? "—"}
                    </span>
                    <span class="machine-row-state">
                      {rowStateLabel(row.state)}
                    </span>
                  </span>
                )}
              </For>
            </Show>
          </span>
          <span class="machine-region-caption">{MACHINE_REGIONS[1].caption}</span>
        </button>

        <span class="machine-flow" aria-hidden="true">
          {"→"}
        </span>

        {/* ── Outputs ────────────────────────────────────────────── */}
        <button
          type="button"
          class="machine-region machine-region--outputs"
          classList={{ "machine-region--selected": selected() === "outputs" }}
          aria-pressed={selected() === "outputs"}
          data-testid="machine-region-outputs"
          onClick={() => toggleRegion("outputs")}
        >
          <span class="machine-region-title">{MACHINE_REGIONS[2].title}</span>
          <span class="machine-jacks" data-testid="machine-jacks">
            <Show
              when={snapshot().rows.length > 0}
              fallback={
                <span class="machine-jacks-empty" data-testid="machine-jacks-empty">
                  no signal
                </span>
              }
            >
              <For each={snapshot().rows}>
                {(row) => (
                  <span
                    class="machine-jack"
                    data-testid={`machine-jack-${row.output}`}
                    data-state={row.state}
                    data-spark-points={String(row.spark.length)}
                  >
                    <span class="machine-jack-ring" aria-hidden="true" />
                    <svg
                      class="machine-spark"
                      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <Show when={row.spark.length > 0}>
                        <polyline
                          class="machine-spark-line"
                          data-testid={`machine-spark-${row.output}`}
                          fill="none"
                          stroke={row.colour ?? "currentColor"}
                          points={sparkPoints(row.spark, SPARK_WIDTH, SPARK_HEIGHT)}
                        />
                      </Show>
                    </svg>
                    <span class="machine-jack-label">{row.output}</span>
                  </span>
                )}
              </For>
            </Show>
          </span>
          <span class="machine-region-caption">{MACHINE_REGIONS[2].caption}</span>
        </button>
      </div>

      <Show when={!live()}>
        <p class="machine-quiescent-note" data-testid="machine-quiescent-note">
          {snapshot().quiescentReason ?? "No runtime available."}
        </p>
      </Show>

      <Show when={selected()}>
        {(region) => (
          <div class="machine-detail" data-testid="machine-detail">
            <For each={ideasForRegion(region())}>
              {(idea) => (
                <section
                  class="machine-idea"
                  data-testid={`machine-idea-${idea.id}`}
                >
                  <h4 class="machine-idea-title">
                    <span class="machine-idea-ordinal">{idea.ordinal}</span>
                    {idea.title}
                  </h4>
                  <p class="machine-idea-explanation">{idea.explanation}</p>
                  <Show when={props.showPlaygrounds !== false}>
                    <PlaygroundBlock playground={idea.playground} />
                  </Show>
                </section>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Wired variant
// ---------------------------------------------------------------------------

export interface WiredMachinePanelProps {
  showPlaygrounds?: boolean;
  /** Test seam — see `machineEvents.ts`. Unused by the app. */
  sources?: MachineSourceOverrides;
}

/**
 * The schematic, reading the real app. Used by the guide's chapter-0 opening
 * block and by the standalone panel (the-machine.md §2.4).
 */
export const WiredMachinePanel: Component<WiredMachinePanelProps> = (props) => {
  const sources = createMachineSources(props.sources ?? {});
  const [selected, setSelected] = createSignal<MachineRegionId | null>(null);

  const snapshot = createMemo<MachineSnapshot>(() => {
    if (!sources.live()) {
      return {
        ...QUIESCENT_SNAPSHOT,
        clock: { ...QUIESCENT_SNAPSHOT.clock },
        rows: [],
      };
    }
    return {
      live: true,
      quiescentReason: null,
      clock: {
        state: sources.clockState(),
        phase: sources.phase(),
        timeSeconds: sources.timeSeconds(),
      },
      rows: deriveRows({
        expressions: sources.expressions(),
        health: sources.health(),
        sampleWindowFor: sources.sampleWindowFor,
      }),
      evalPulse: sources.evalPulse(),
    };
  });

  return (
    <MachinePanel
      snapshot={snapshot()}
      selectedRegion={selected()}
      onSelectRegion={setSelected}
      showPlaygrounds={props.showPlaygrounds}
    />
  );
};
