// src/ui/menu/RadialMenu.tsx
//
// Pure presentational SVG renderer for the gamepad-driven radial menu
// (the centre-screen, double-ring, content-picker overlay specified by
// docs/specs/radial-menu.md).
//
// PROPS-IN ONLY. No imports from src/runtime/, src/effects/, runtimeService,
// the menu store, the gamepad layer, or src/lib/menu/state.ts. The component
// is deterministic from its props — feeding identical (state, manifest) yields
// identical DOM. Sub-phase is derived inline from raw state fields so this file
// stays orthogonal to the reducer (the bead's acceptance criterion).
//
// Mounted by `src/ui/adapters/radialMenu.ts` (Track H3) which subscribes to the
// menu store and forwards the latest state. The dispatcher / state machine /
// verb application live elsewhere; this file only paints what's there.
//
// Layout (spec §6, §3.2):
//
//   ┌─────────── full-screen dim backdrop ───────────┐
//   │                                                │
//   │           [tab strip with active marker]       │
//   │                                                │
//   │         ╭─ left ring   ╭─ right ring           │
//   │        │   (categories) │  (items)             │
//   │        │      [centre slot — previewSlot]      │
//   │         ╰──            ╰──                     │
//   │                                                │
//   │           [verb-hint row, when frozen]         │
//   │                                                │
//   └────────────────────────────────────────────────┘
//
// CSS hooks are class names only (the project's `menu.css` is owned by Track G3
// — useq-perform-4zt.69.30 — and is responsible for layout, colours, and
// animation). Where layout-dependent geometry is required (segment paths,
// label positions) we inline the values; everything else is class-driven.
//
// References to spec sections are to docs/specs/radial-menu.md.

import { For, Show, createMemo, type JSX } from "solid-js";
import { polarToCartesian } from "../../utils/geometry";
import "./menu.css";
import type {
  Manifest,
  MenuCategory,
  MenuItem,
  MenuState,
  MenuStateOpen,
  MenuStateNumpad,
  MenuStateT9,
  OpenSubPhase,
  ShoulderHeld,
  Verb,
} from "../../lib/menu/types";

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface RadialMenuProps {
  /** Current state. When `phase === 'closed'` the component renders nothing. */
  readonly state: MenuState;
  /**
   * Active manifest. Read for tab/category/item labels and segment counts.
   * Decoupled from `state.manifest` (which open/sub-mode states also carry)
   * so the renderer works the same regardless of which sub-state is active.
   */
  readonly manifest: Manifest;
  /**
   * Optional centre-slot content. The breadcrumb + live-preview panel lives
   * in `src/ui/menu/CenterPanel.tsx` (parallel Track G2) — the parent
   * adapter slots it in here. Decoupling keeps both components renderable
   * in isolation.
   */
  readonly previewSlot?: JSX.Element;
}

// ---------------------------------------------------------------------------
// Geometry constants
// ---------------------------------------------------------------------------

// SVG viewBox is fixed; CSS resizes the surface. Fixed viewBox keeps the
// segment-path math constant and avoids reactive recomputation.
const VIEW = 560;
const CENTRE = VIEW / 2;
const RING_OUTER = 252;
const RING_INNER = 168;
const SUBMODE_OUTER = 232;
const SUBMODE_INNER = 92;
const PREVIEW_RADIUS = 138; // covers the centre slot

// Visual choice (not pinned by spec): we render a full circle subdivided into
// segments, not the §3.2.2 strict "left ring on left half, right ring on right
// half" half-circles. Reason: half-circle layouts at v1 segment counts (≤8
// categories, ≤12 items) waste >50% of the ring's arc length and produce
// awkwardly-tall slices. A whole-circle ring per side, drawn concentrically
// with the right ring inside the left, tracks better with stick polar
// coordinates and matches the established radial-menu pointer mapping.
// Flagged in the report — easy to switch back to half-circles if desired.

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RadialMenu(props: RadialMenuProps): JSX.Element {
  return (
    <Show when={props.state.phase !== "closed"}>
      <div class="radial-menu-root" role="dialog" aria-modal="true" aria-label="Radial menu">
        <div class="radial-menu-backdrop" />
        <div class="radial-menu-frame">
          <Show when={props.state.phase === "open"}>
            {renderOpen(props.state as MenuStateOpen, props.manifest, props.previewSlot)}
          </Show>
          <Show when={props.state.phase === "numpad"}>
            {renderNumpad(props.state as MenuStateNumpad, props.previewSlot)}
          </Show>
          <Show when={props.state.phase === "t9"}>
            {renderT9(props.state as MenuStateT9, props.previewSlot)}
          </Show>
        </div>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Sub-phase derivation (spec §2.4)
// ---------------------------------------------------------------------------
//
// Inlined here rather than imported from src/lib/menu/state.ts — the bead's
// acceptance criterion bars this file from depending on the reducer module so
// the renderer is logic-free. The derivation is a 4-line table read.

function deriveSubPhase(state: MenuStateOpen): OpenSubPhase {
  if (state.frozen !== null) return "frozen";
  if (state.leftHover === null && state.rightHover === null) return "cyclingLeftTabs";
  if (state.leftHover !== null && state.rightHover === null) return "cyclingRightTabs";
  return "picking";
}

// ---------------------------------------------------------------------------
// Open-state rendering (spec §6, §3.2, §3.3)
// ---------------------------------------------------------------------------

function renderOpen(
  state: MenuStateOpen,
  manifest: Manifest,
  previewSlot: JSX.Element | undefined,
): JSX.Element {
  // Cache derived structures so JSX expressions don't re-walk the manifest
  // per attribute access (perf budget §11.5).
  const phase = createMemo(() => deriveSubPhase(state));
  const activeTab = createMemo(() => manifest.tabs[state.leftTabIdx]);
  const categories = createMemo(() => activeTab()?.categories ?? []);
  const hoveredCategory = createMemo<MenuCategory | undefined>(() => {
    if (state.leftHover === null) return undefined;
    return categories()[state.leftHover];
  });
  const items = createMemo<readonly MenuItem[]>(
    () => hoveredCategory()?.items ?? [],
  );

  return (
    <div class={`radial-menu-open subphase-${phase()}`}>
      {/* Tab strip across top — spec §3.2.4, §3.2.5 */}
      <div class="radial-menu-tab-strip">
        <For each={manifest.tabs}>
          {(tab, i) => (
            <span
              class="radial-menu-tab-label"
              classList={{ "is-active": i() === state.leftTabIdx }}
              data-tab-id={tab.id}
            >
              {tab.label}
            </span>
          )}
        </For>
      </div>

      <svg
        class="radial-menu-svg"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        width={VIEW}
        height={VIEW}
        role="img"
        aria-label={`Radial menu, tab ${activeTab()?.label ?? ""}`}
      >
        {/* Left ring — categories of the active tab */}
        <Ring
          segmentCount={categories().length}
          hover={state.leftHover}
          frozenIdx={
            state.frozen !== null
              ? findCategoryIndex(activeTab()?.categories ?? [], state.frozen.leftPicked)
              : null
          }
          outerR={RING_OUTER}
          innerR={(RING_OUTER + RING_INNER) / 2}
          ringClass="radial-menu-left-ring"
          dimmed={phase() === "frozen" && state.frozen?.leftPicked !== undefined && state.shoulderHeld === "right"}
          labels={categories().map((c) => c.label)}
        />

        {/* Right ring — items of the hovered category */}
        <Ring
          segmentCount={items().length}
          hover={state.rightHover}
          frozenIdx={
            state.frozen !== null
              ? findItemIndex(items(), state.frozen.rightPicked)
              : null
          }
          outerR={(RING_OUTER + RING_INNER) / 2}
          innerR={RING_INNER}
          ringClass="radial-menu-right-ring"
          dimmed={phase() === "frozen" && state.shoulderHeld === "left"}
          labels={items().map((i) => i.label)}
        />

        {/* Sub-phase visual cues */}
        <Show when={phase() === "cyclingLeftTabs"}>
          <ShoulderCueArrows side="both" pulse />
        </Show>
        <Show when={phase() === "cyclingRightTabs"}>
          <ShoulderCueArrows side="both" pulse />
        </Show>
        <Show when={phase() === "frozen" && state.frozen}>
          <FreezeChevron held={state.shoulderHeld} />
          <FreezeLockGlyph />
        </Show>

        {/* Centre dot anchor — purely visual */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={PREVIEW_RADIUS}
          class="radial-menu-centre-bg"
          fill="none"
          pointer-events="none"
        />
      </svg>

      {/* Centre slot — Track G2's CenterPanel goes here */}
      <div class="radial-menu-centre-slot" data-subphase={phase()}>
        {previewSlot}
      </div>

      {/* Verb-hint row, only meaningful in frozen state — spec §9.2 */}
      <Show when={phase() === "frozen"}>
        <VerbHints held={state.shoulderHeld} />
      </Show>

      {/* Right-tab indicator (bottom) — spec §3.2.4 */}
      <Show when={(activeTab()?.rightTabs?.length ?? 0) > 1}>
        <div class="radial-menu-right-tab-strip">
          <For each={activeTab()?.rightTabs ?? []}>
            {(rt, i) => (
              <span
                class="radial-menu-right-tab-label"
                classList={{ "is-active": i() === state.rightTabIdx }}
                data-right-tab-id={rt.id}
              >
                {rt.label}
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ring — concentric SVG segments + labels
// ---------------------------------------------------------------------------

interface RingProps {
  readonly segmentCount: number;
  readonly hover: number | null;
  readonly frozenIdx: number | null;
  readonly outerR: number;
  readonly innerR: number;
  readonly ringClass: string;
  readonly dimmed: boolean;
  readonly labels: readonly string[];
}

function Ring(props: RingProps): JSX.Element {
  return (
    <Show when={props.segmentCount > 0} fallback={<EmptyRingPlaceholder r={props.outerR} />}>
      <g
        class={props.ringClass}
        classList={{ "is-dimmed": props.dimmed }}
      >
        <For each={Array.from({ length: props.segmentCount })}>
          {(_, iAcc) => {
            const i = iAcc();
            const isHovered = () => props.hover === i;
            const isFrozen = () => props.frozenIdx === i;
            const path = segmentPath(i, props.segmentCount, props.outerR, props.innerR);
            const labelPos = segmentLabelPos(i, props.segmentCount, (props.outerR + props.innerR) / 2);
            const truncated = truncate(props.labels[i] ?? `${i + 1}`, 14);
            return (
              <g class="radial-menu-segment" classList={{ "is-hover": isHovered(), "is-frozen": isFrozen() }}>
                <path d={path} class="radial-menu-segment-fill" />
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  class="radial-menu-segment-label"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  pointer-events="none"
                >
                  {truncated}
                </text>
              </g>
            );
          }}
        </For>
      </g>
    </Show>
  );
}

function EmptyRingPlaceholder(props: { readonly r: number }): JSX.Element {
  // §6.2.1 — empty category renders a placeholder so the user sees "no items".
  return (
    <g class="radial-menu-empty-ring">
      <circle cx={CENTRE} cy={CENTRE} r={props.r} class="radial-menu-empty-ring-outline" fill="none" />
      <text
        x={CENTRE}
        y={CENTRE}
        class="radial-menu-empty-ring-label"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        no items
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Frozen-state visual cues (spec §6.4 / §9.2)
// ---------------------------------------------------------------------------

function FreezeLockGlyph(): JSX.Element {
  // A small lock icon at the top of the centre slot. Tells the user "your
  // pick is latched; stick movement no longer changes it."
  return (
    <g class="radial-menu-freeze-lock" pointer-events="none">
      <circle cx={CENTRE} cy={CENTRE - PREVIEW_RADIUS - 18} r={10} class="radial-menu-freeze-lock-bg" />
      <text
        x={CENTRE}
        y={CENTRE - PREVIEW_RADIUS - 18}
        class="radial-menu-freeze-lock-glyph"
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="12"
      >
        ⌬
      </text>
    </g>
  );
}

interface FreezeChevronProps {
  readonly held: ShoulderHeld;
}

function FreezeChevron(props: FreezeChevronProps): JSX.Element {
  // Per spec §6.4 — handedness chevron points toward the held shoulder so the
  // user sees which hand will fire. 'both' shows opposing chevrons; 'none' is
  // structurally impossible in `frozen` but we degrade gracefully (no glyph).
  return (
    <g class="radial-menu-freeze-chevron" pointer-events="none" data-handedness={props.held}>
      <Show when={props.held === "left" || props.held === "both"}>
        <text x={CENTRE - 60} y={CENTRE} class="radial-menu-chevron-glyph" text-anchor="middle" dominant-baseline="middle">
          ◀
        </text>
      </Show>
      <Show when={props.held === "right" || props.held === "both"}>
        <text x={CENTRE + 60} y={CENTRE} class="radial-menu-chevron-glyph" text-anchor="middle" dominant-baseline="middle">
          ▶
        </text>
      </Show>
    </g>
  );
}

interface VerbHintsProps {
  readonly held: ShoulderHeld;
}

function VerbHints(props: VerbHintsProps): JSX.Element {
  // §9.2 — verb-hint row showing which face button fires which verb, with
  // handedness annotated by an arrow glyph reflecting the current `held`.
  const arrow = () =>
    props.held === "left" ? "←" : props.held === "right" ? "→" : props.held === "both" ? "↔" : "";
  return (
    <div class="radial-menu-verb-hints">
      <span class="radial-menu-verb-hint" data-face="A">
        <span class="radial-menu-verb-key">A</span> Insert {arrow()}
      </span>
      <span class="radial-menu-verb-hint" data-face="X">
        <span class="radial-menu-verb-key">X</span> Replace
      </span>
      <span class="radial-menu-verb-hint" data-face="Y">
        <span class="radial-menu-verb-key">Y</span> WrapWith {arrow()}
      </span>
      <span class="radial-menu-verb-hint" data-face="B">
        <span class="radial-menu-verb-key">B</span> Call {arrow()}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-phase shoulder cue — small LB/RB pulse glyph (spec §3.3 table)
// ---------------------------------------------------------------------------

interface ShoulderCueArrowsProps {
  readonly side: "left" | "right" | "both";
  readonly pulse: boolean;
}

function ShoulderCueArrows(props: ShoulderCueArrowsProps): JSX.Element {
  // Tells the user "LB/RB cycle the active tab" by drawing small arrow
  // glyphs near the top of the SVG with a CSS-driven pulse animation.
  return (
    <g class="radial-menu-shoulder-cue" classList={{ "is-pulsing": props.pulse }} pointer-events="none">
      <Show when={props.side === "left" || props.side === "both"}>
        <text x={CENTRE - 220} y={40} class="radial-menu-shoulder-cue-glyph" text-anchor="middle">
          ◀ LB
        </text>
      </Show>
      <Show when={props.side === "right" || props.side === "both"}>
        <text x={CENTRE + 220} y={40} class="radial-menu-shoulder-cue-glyph" text-anchor="middle">
          RB ▶
        </text>
      </Show>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Numpad sub-mode (spec §14.2 / §14.3)
// ---------------------------------------------------------------------------

const NUMPAD_INNER_KEYS = [
  // 8 compass positions on the inner ring + centre.
  // Order matches §14.2 inner-ring spec: NW=1, N=2, NE=3, W=4, E=6, SW=7, S=8, SE=9
  { angle: 315, label: "1" },
  { angle: 0, label: "2" },
  { angle: 45, label: "3" },
  { angle: 270, label: "4" },
  { angle: 90, label: "6" },
  { angle: 225, label: "7" },
  { angle: 180, label: "8" },
  { angle: 135, label: "9" },
];

const NUMPAD_OUTER_KEYS = [
  // Outer ring per §14.2: S=0, SW=',', SE='.', N=±, NE=e, E=⌫, NW=Esc, W=✓
  { angle: 180, label: "0" },
  { angle: 225, label: "," },
  { angle: 135, label: "." },
  { angle: 0, label: "±" },
  { angle: 45, label: "e" },
  { angle: 90, label: "⌫" },
  { angle: 315, label: "Esc" },
  { angle: 270, label: "✓" },
];

function renderNumpad(state: MenuStateNumpad, previewSlot: JSX.Element | undefined): JSX.Element {
  return (
    <div class="radial-menu-numpad">
      <svg
        class="radial-menu-svg"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        width={VIEW}
        height={VIEW}
        role="img"
        aria-label="Numpad sub-mode"
      >
        <For each={NUMPAD_OUTER_KEYS}>
          {(k) => <PolarKey angle={k.angle} radius={SUBMODE_OUTER * 0.92} label={k.label} ring="outer" />}
        </For>
        <For each={NUMPAD_INNER_KEYS}>
          {(k) => <PolarKey angle={k.angle} radius={(SUBMODE_OUTER + SUBMODE_INNER) / 2} label={k.label} ring="inner" />}
        </For>
        {/* Centre key (5) */}
        <PolarKey angle={0} radius={0} label="5" ring="centre" />
      </svg>

      <div class="radial-menu-centre-slot" data-subphase="numpad">
        <Show when={previewSlot} fallback={<DefaultBufferDisplay buffer={state.buffer} kind="number" verb={state.activeVerb} />}>
          {previewSlot}
        </Show>
      </div>

      <div class="radial-menu-verb-hints">
        <span class="radial-menu-verb-hint">
          <span class="radial-menu-verb-key">A</span> append
        </span>
        <span class="radial-menu-verb-hint">
          <span class="radial-menu-verb-key">X</span> commit + new
        </span>
        <span class="radial-menu-verb-hint">
          <span class="radial-menu-verb-key">Y</span> ⌫
        </span>
        <span class="radial-menu-verb-hint">
          <span class="radial-menu-verb-key">B</span> exit
        </span>
        <span class="radial-menu-verb-hint">
          <span class="radial-menu-verb-key">Start</span> ✓
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// T9 sub-mode (spec §14.4)
// ---------------------------------------------------------------------------

const T9_KEYS = [
  // Same polar grid as numpad — multi-tap maps tap-count → letter (§14.4).
  { angle: 315, label: "1", letters: "-_/" },
  { angle: 0, label: "2", letters: "abc" },
  { angle: 45, label: "3", letters: "def" },
  { angle: 270, label: "4", letters: "ghi" },
  { angle: 90, label: "6", letters: "mno" },
  { angle: 225, label: "7", letters: "pqrs" },
  { angle: 180, label: "8", letters: "tuv" },
  { angle: 135, label: "9", letters: "wxyz" },
];

const T9_CENTRE = { label: "5", letters: "jkl" };

function renderT9(state: MenuStateT9, previewSlot: JSX.Element | undefined): JSX.Element {
  return (
    <div class="radial-menu-t9">
      <svg
        class="radial-menu-svg"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        width={VIEW}
        height={VIEW}
        role="img"
        aria-label="T9 sub-mode"
      >
        <For each={T9_KEYS}>
          {(k) => (
            <T9Key
              angle={k.angle}
              radius={(SUBMODE_OUTER + SUBMODE_INNER) / 2}
              digit={k.label}
              letters={state.caseMode === "upper" ? k.letters.toUpperCase() : k.letters}
              isActive={state.lastKey === k.label}
            />
          )}
        </For>
        <T9Key
          angle={0}
          radius={0}
          digit={T9_CENTRE.label}
          letters={state.caseMode === "upper" ? T9_CENTRE.letters.toUpperCase() : T9_CENTRE.letters}
          isActive={state.lastKey === T9_CENTRE.label}
        />
        {/* Caps indicator (§14.4.2) — RB latches caps */}
        <text
          x={VIEW - 40}
          y={32}
          class="radial-menu-t9-caps"
          text-anchor="end"
          classList={{ "is-active": state.caseMode === "upper" }}
        >
          {state.caseMode === "upper" ? "ABC" : "abc"}
        </text>
      </svg>

      <div class="radial-menu-centre-slot" data-subphase="t9">
        <Show when={previewSlot} fallback={<DefaultBufferDisplay buffer={state.buffer} kind="text" verb={state.activeVerb} />}>
          {previewSlot}
        </Show>
      </div>

      <div class="radial-menu-verb-hints">
        <span class="radial-menu-verb-hint">
          <span class="radial-menu-verb-key">A</span> cycle letter
        </span>
        <span class="radial-menu-verb-hint">
          <span class="radial-menu-verb-key">X</span> commit + new
        </span>
        <span class="radial-menu-verb-hint">
          <span class="radial-menu-verb-key">Y</span> ⌫
        </span>
        <span class="radial-menu-verb-hint">
          <span class="radial-menu-verb-key">B</span> exit
        </span>
        <span class="radial-menu-verb-hint">
          <span class="radial-menu-verb-key">Start</span> ✓
        </span>
      </div>
    </div>
  );
}

interface PolarKeyProps {
  readonly angle: number;
  readonly radius: number;
  readonly label: string;
  readonly ring: "inner" | "outer" | "centre";
}

function PolarKey(props: PolarKeyProps): JSX.Element {
  const pos = polarToCartesian(CENTRE, CENTRE, props.radius, props.angle);
  return (
    <g class={`radial-menu-key radial-menu-key-${props.ring}`}>
      <circle cx={pos.x} cy={pos.y} r={26} class="radial-menu-key-bg" />
      <text x={pos.x} y={pos.y} class="radial-menu-key-label" text-anchor="middle" dominant-baseline="middle">
        {props.label}
      </text>
    </g>
  );
}

interface T9KeyProps {
  readonly angle: number;
  readonly radius: number;
  readonly digit: string;
  readonly letters: string;
  readonly isActive: boolean;
}

function T9Key(props: T9KeyProps): JSX.Element {
  const pos = polarToCartesian(CENTRE, CENTRE, props.radius, props.angle);
  return (
    <g class="radial-menu-t9-key" classList={{ "is-active": props.isActive }}>
      <circle cx={pos.x} cy={pos.y} r={30} class="radial-menu-t9-key-bg" />
      <text x={pos.x} y={pos.y - 6} class="radial-menu-t9-key-digit" text-anchor="middle" dominant-baseline="middle">
        {props.digit}
      </text>
      <text x={pos.x} y={pos.y + 12} class="radial-menu-t9-key-letters" text-anchor="middle" dominant-baseline="middle">
        {props.letters}
      </text>
    </g>
  );
}

// Lightweight default for the buffer display when no previewSlot is supplied
// (e.g. Storybook stories that render this component in isolation). The real
// CenterPanel from Track G2 supersedes this when mounted.
interface DefaultBufferDisplayProps {
  readonly buffer: string;
  readonly kind: "number" | "text";
  readonly verb: Verb;
}

function DefaultBufferDisplay(props: DefaultBufferDisplayProps): JSX.Element {
  return (
    <div class="radial-menu-buffer-display" data-kind={props.kind}>
      <div class="radial-menu-buffer-label">
        Type {props.kind === "number" ? "number" : "text"}
        <span class="radial-menu-buffer-verb"> · {props.verb.kind}</span>
      </div>
      <div class="radial-menu-buffer-value">
        {props.buffer || <span class="radial-menu-buffer-placeholder">_</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers (segment paths, label positions)
// ---------------------------------------------------------------------------

function segmentPath(
  index: number,
  segmentCount: number,
  outerR: number,
  innerR: number,
): string {
  if (segmentCount <= 0) return "";
  if (segmentCount === 1) {
    // A single full ring — render two-arc full circle annulus.
    return [
      `M ${CENTRE - outerR} ${CENTRE}`,
      `A ${outerR} ${outerR} 0 1 0 ${CENTRE + outerR} ${CENTRE}`,
      `A ${outerR} ${outerR} 0 1 0 ${CENTRE - outerR} ${CENTRE}`,
      `M ${CENTRE - innerR} ${CENTRE}`,
      `A ${innerR} ${innerR} 0 1 1 ${CENTRE + innerR} ${CENTRE}`,
      `A ${innerR} ${innerR} 0 1 1 ${CENTRE - innerR} ${CENTRE}`,
      "Z",
    ].join(" ");
  }
  const dps = 360 / segmentCount;
  const startAngle = index * dps;
  const endAngle = (index + 1) * dps;

  const startOuter = polarToCartesian(CENTRE, CENTRE, outerR, endAngle);
  const endOuter = polarToCartesian(CENTRE, CENTRE, outerR, startAngle);
  const startInner = polarToCartesian(CENTRE, CENTRE, innerR, endAngle);
  const endInner = polarToCartesian(CENTRE, CENTRE, innerR, startAngle);

  const largeArcFlag = dps <= 180 ? "0" : "1";

  return [
    "M",
    startOuter.x,
    startOuter.y,
    "A",
    outerR,
    outerR,
    0,
    largeArcFlag,
    0,
    endOuter.x,
    endOuter.y,
    "L",
    endInner.x,
    endInner.y,
    "A",
    innerR,
    innerR,
    0,
    largeArcFlag,
    1,
    startInner.x,
    startInner.y,
    "Z",
  ].join(" ");
}

function segmentLabelPos(index: number, segmentCount: number, midR: number): { x: number; y: number } {
  if (segmentCount <= 0) return { x: CENTRE, y: CENTRE };
  const dps = 360 / segmentCount;
  const angle = index * dps + dps / 2;
  return polarToCartesian(CENTRE, CENTRE, midR, angle);
}

function findCategoryIndex(
  categories: readonly MenuCategory[],
  id: string,
): number | null {
  const i = categories.findIndex((c) => c.id === id);
  return i < 0 ? null : i;
}

function findItemIndex(items: readonly MenuItem[], id: string): number | null {
  const i = items.findIndex((it) => it.id === id);
  return i < 0 ? null : i;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
