import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { getAngle, polarToCartesian } from "../utils/geometry";

export type RadialTheme = {
  inactiveFill: string;
  activeFill: string;
  lockedFill: string;
  hoverOverlayFill: string;
  stroke: string;
  textInactive: string;
  textActive: string;
  glowClass?: string;
};

export type RadialMenuProps = {
  segmentCount: number;
  activeSegment: number | null;
  lockedSegment?: number | null;
  onHoverSegment: (index: number | null) => void;
  onSelectSegment?: (index: number) => void;
  labels?: string[];
  size?: number;
  innerRadiusRatio?: number;
  disabled?: boolean;
  theme?: Partial<RadialTheme>;
  /** If true, mouse movement can update hover */
  pointerEnabled?: boolean;
};

const DEFAULT_THEME: RadialTheme = {
  inactiveFill: "#1f2937", // slate-800
  activeFill: "#22d3ee", // cyan-400
  lockedFill: "#06b6d4", // cyan-500
  hoverOverlayFill: "rgba(255,255,255,0.18)",
  stroke: "#0b1220", // deep slate
  textInactive: "#cbd5e1", // slate-300
  textActive: "#0b1220",
};

function clampIndex(idx: number, n: number) {
  if (n <= 0) return 0;
  if (idx < 0) return 0;
  if (idx >= n) return n - 1;
  return idx;
}

export function RadialMenu(props: RadialMenuProps) {
  const size = () => props.size ?? 360;
  const innerRatio = () => props.innerRadiusRatio ?? 0.35;
  const pointerEnabled = () => props.pointerEnabled ?? true;

  const theme = createMemo<RadialTheme>(() => ({
    ...DEFAULT_THEME,
    ...(props.theme || {}),
  }));

  let svgRef: SVGSVGElement | undefined;
  const [isPointerInside, setIsPointerInside] = createSignal(false);

  const radius = createMemo(() => size() / 2);
  const center = createMemo(() => size() / 2);
  const innerRadius = createMemo(() => radius() * innerRatio());
  const bandMidRadius = createMemo(() => (radius() + innerRadius()) / 2);

  const degreesPerSegment = createMemo(() => 360 / Math.max(1, props.segmentCount));

  const labelPos = (index: number) => {
    const angle = index * degreesPerSegment() + degreesPerSegment() / 2;
    return polarToCartesian(center(), center(), bandMidRadius(), angle);
  };

  const segmentPath = (i: number) => {
    const dps = degreesPerSegment();
    const startAngle = i * dps;
    const endAngle = (i + 1) * dps;

    const startOuter = polarToCartesian(center(), center(), radius(), endAngle);
    const endOuter = polarToCartesian(center(), center(), radius(), startAngle);
    const startInner = polarToCartesian(center(), center(), innerRadius(), endAngle);
    const endInner = polarToCartesian(center(), center(), innerRadius(), startAngle);

    const largeArcFlag = dps <= 180 ? "0" : "1";

    return [
      "M",
      startOuter.x,
      startOuter.y,
      "A",
      radius(),
      radius(),
      0,
      largeArcFlag,
      0,
      endOuter.x,
      endOuter.y,
      "L",
      endInner.x,
      endInner.y,
      "A",
      innerRadius(),
      innerRadius(),
      0,
      largeArcFlag,
      1,
      startInner.x,
      startInner.y,
      "Z",
    ].join(" ");
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!pointerEnabled() || props.disabled) return;
    if (!svgRef) return;

    const rect = svgRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const cx = center();
    const cy = center();
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < innerRadius() || dist > radius()) {
      if (props.activeSegment !== null) props.onHoverSegment(null);
      return;
    }

    const angle = getAngle(x, y, cx, cy);
    const idx = clampIndex(Math.floor(angle / degreesPerSegment()) % props.segmentCount, props.segmentCount);
    if (idx !== props.activeSegment) props.onHoverSegment(idx);
  };

  const handlePointerLeave = () => {
    setIsPointerInside(false);
    props.onHoverSegment(null);
  };

  const handlePointerEnter = () => setIsPointerInside(true);

  const handleClick = () => {
    if (props.disabled) return;
    if (props.activeSegment !== null && props.onSelectSegment) props.onSelectSegment(props.activeSegment);
  };

  // Attach pointer listeners directly for best perf.
  const attachPointerHandlers = (el: SVGSVGElement) => {
    const onMove = (e: PointerEvent) => handlePointerMove(e);
    const onLeave = () => handlePointerLeave();
    const onEnter = () => handlePointerEnter();

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerenter", onEnter);

    onCleanup(() => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerenter", onEnter);
    });
  };

  return (
    <div
      class={`radial-menu ${props.disabled ? "is-disabled" : ""} ${props.activeSegment !== null ? "is-active" : ""} ${
        theme().glowClass && props.activeSegment !== null ? theme().glowClass : ""
      }`}
      style={{ width: `${size()}px`, height: `${size()}px` }}
    >
      <svg
        ref={(el) => {
          svgRef = el;
          attachPointerHandlers(el);
        }}
        width={size()}
        height={size()}
        viewBox={`0 0 ${size()} ${size()}`}
        class={`radial-menu-svg ${pointerEnabled() && !props.disabled ? "pointer" : ""}`}
        onClick={handleClick}
        style={{ transform: `scale(${props.activeSegment !== null || isPointerInside() ? 1.02 : 1})` }}
      >
        <For each={Array.from({ length: Math.max(0, props.segmentCount) })}>
          {(_, iAcc) => {
            const i = iAcc();
            const isActive = () => props.activeSegment === i;
            const isLocked = () => (props.lockedSegment ?? null) === i;

            const fill = () => {
              if (isLocked()) return theme().lockedFill;
              if (isActive()) return theme().activeFill;
              return theme().inactiveFill;
            };

            const d = createMemo(() => segmentPath(i));

            return (
              <g>
                <path d={d()} fill={fill()} stroke={theme().stroke} stroke-width={2} stroke-linejoin="round" />
                <Show when={!isLocked() && isActive()}>
                  <path d={d()} fill={theme().hoverOverlayFill} />
                </Show>
              </g>
            );
          }}
        </For>

        {/* Labels */}
        <For each={Array.from({ length: Math.max(0, props.segmentCount) })}>
          {(_, iAcc) => {
            const i = iAcc();
            const pos = createMemo(() => labelPos(i));
            const isActive = () => props.activeSegment === i;
            const isLocked = () => (props.lockedSegment ?? null) === i;
            const textColor = () => (isActive() || isLocked() ? theme().textActive : theme().textInactive);

            const label = () => {
              const raw = props.labels?.[i] ?? `${i + 1}`;
              // keep it compact
              return String(raw).length > 10 ? `${String(raw).slice(0, 10)}…` : String(raw);
            };

            return (
              <text
                x={pos().x}
                y={pos().y}
                fill={textColor()}
                font-size={14}
                font-family="var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)"
                text-anchor="middle"
                dominant-baseline="middle"
                style={{ "pointer-events": "none", "user-select": "none" }}
              >
                {label()}
              </text>
            );
          }}
        </For>

        {/* center dot */}
        <circle
          cx={center()}
          cy={center()}
          r={Math.max(2, innerRadius() * 0.08)}
          fill={props.activeSegment !== null ? theme().activeFill : theme().inactiveFill}
          opacity={0.9}
        />
      </svg>
    </div>
  );
}


