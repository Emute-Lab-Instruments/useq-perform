import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { RadialMenu, type RadialTheme } from "./RadialMenu";

export type PickerEntry = {
  label: string;
  value?: unknown;
  insertText?: string;
  special?: string;
  [key: string]: unknown;
};

export type PickerCategory = {
  label: string;
  id?: string;
  items: PickerEntry[];
  [key: string]: unknown;
};

export type DoubleRadialPickerProps = {
  title?: string;
  categories: PickerCategory[];
  onSelect: (entry: PickerEntry) => void;
  onCancel: () => void;
  /** default: 0.5 */
  stickThreshold?: number;
  /** default: 360 */
  menuSize?: number;
  /** default: 0.35 */
  innerRadiusRatio?: number;
};

const THEME_LEFT: RadialTheme = {
  inactiveFill: "#1f2937",
  activeFill: "rgba(34,211,238,0.65)",
  lockedFill: "#06b6d4",
  hoverOverlayFill: "rgba(255,255,255,0.18)",
  stroke: "#0b1220",
  textInactive: "#67e8f9",
  textActive: "#0b1220",
  glowClass: "double-radial-glow-cyan",
};

const THEME_RIGHT: RadialTheme = {
  inactiveFill: "#1f2937",
  activeFill: "rgba(244,63,94,0.6)",
  lockedFill: "#f43f5e",
  hoverOverlayFill: "rgba(255,255,255,0.18)",
  stroke: "#0b1220",
  textInactive: "#fda4af",
  textActive: "#0b1220",
  glowClass: "double-radial-glow-rose",
};

const TAU = Math.PI * 2;

function angleFromVec(x: number, y: number) {
  // Standard gamepad coordinate system: up is negative y, right is positive x
  // Use y directly without inversion to fix reversed control
  const ang = Math.atan2(y, x);
  return (ang + TAU) % TAU; // 0..TAU
}

function sectorFromAngle(angle: number, count: number) {
  if (!count || count <= 0) return 0;
  const size = TAU / count;
  let idx = Math.floor(angle / size);
  if (idx < 0) idx = 0;
  if (idx >= count) idx = count - 1;
  return idx;
}

function wrapIndex(idx: number, count: number) {
  if (count <= 0) return 0;
  return ((idx % count) + count) % count;
}

export function DoubleRadialPicker(props: DoubleRadialPickerProps) {
  const stickThreshold = () => props.stickThreshold ?? 0.5;
  const menuSize = () => props.menuSize ?? 360;
  const innerRatio = () => props.innerRadiusRatio ?? 0.35;

  const safeCategories = createMemo(() => (Array.isArray(props.categories) ? props.categories : []));

  const [leftHover, setLeftHover] = createSignal<number | null>(null);
  const [leftLocked, setLeftLocked] = createSignal(0);

  const [rightHover, setRightHover] = createSignal<number | null>(null);
  const [rightLocked, setRightLocked] = createSignal<number | null>(null);

  const leftLabels = createMemo(() => {
    return safeCategories().map((c) => String(c.label ?? ""));
  });
  const rightItems = createMemo(() => {
    const cats = safeCategories();
    if (!cats.length) return [] as PickerEntry[];
    const leftIdx = leftLocked();
    if (leftIdx == null || leftIdx === undefined) return [];
    const idx = Math.min(leftIdx, cats.length - 1);
    const items = cats[idx]?.items;
    return Array.isArray(items) ? items : [];
  });

  const rightLabels = createMemo(() => rightItems().map((e) => String(e.label ?? "")));

  const setCategory = (idx: number, { alsoHover = true } = {}) => {
    const cats = safeCategories();
    if (!cats.length) return;
    const next = Math.max(0, Math.min(cats.length - 1, idx));
    setLeftLocked(next);
    if (alsoHover) setLeftHover(next);

    // Reset right selection when category changes.
    setRightLocked(0);
    setRightHover(0);
  };

  const setItem = (idx: number, { alsoHover = true } = {}) => {
    // Get current items without creating reactive dependency
    const cats = safeCategories();
    if (!cats.length) return;
    const leftIdx = leftLocked();
    if (leftIdx == null || leftIdx === undefined) return;
    const catItems = cats[leftIdx]?.items;
    const items = Array.isArray(catItems) ? catItems : [];
    
    if (!items.length) {
      setRightLocked(0);
      setRightHover(0);
      return;
    }
    const next = Math.max(0, Math.min(items.length - 1, idx));
    setRightLocked(next);
    if (alsoHover) setRightHover(next);
  };

  // Ensure indices stay in range when data changes.
  createEffect(() => {
    const cats = safeCategories();
    if (!cats.length) return;
    const leftIdx = untrack(() => leftLocked());
    if (typeof leftIdx === 'number' && leftIdx >= cats.length) setLeftLocked(0);
  });

  createEffect(() => {
    // Get items without creating reactive dependency
    const cats = safeCategories();
    if (!cats.length) return;
    const leftIdx = leftLocked();
    if (leftIdx == null || leftIdx === undefined) return;
    const catItems = cats[leftIdx]?.items;
    const items = Array.isArray(catItems) ? catItems : [];
    
    // Use untracked to read rightLocked without creating dependency
    const r = untrack(() => rightLocked());
    if (!items.length) {
      setRightLocked(0);
      setRightHover(0);
      return;
    }
    if (r === null || r === undefined) {
      setRightLocked(0);
      setRightHover(0);
      return;
    }
    if (r >= items.length) setRightLocked(0);
  });

  const confirm = () => {
    const items = untrack(() => rightItems());
    if (!items.length) return;

    const rightIdx = untrack(() => rightLocked());
    const rightHov = untrack(() => rightHover());
    const idx = rightIdx ?? rightHov ?? 0;
    const entry = items[Math.max(0, Math.min(items.length - 1, idx))];
    if (!entry) return;

    // Match existing `showRadialPickerMenu` behavior for Number…
    if (entry.special === "number") {
      props.onSelect({ label: "0", value: 0, insertText: "0" });
      return;
    }

    props.onSelect(entry);
  };

  const cancel = () => props.onCancel();

  const onPickerEvent = (e: Event) => {
    const detail = (e as CustomEvent).detail || {};
    const action = detail.action as string | undefined;
    const direction = detail.direction as string | undefined;
    const leftStick = detail.leftStick as { x?: number; y?: number } | undefined;
    const rightStick = detail.rightStick as { x?: number; y?: number } | undefined;

    if (action === "cancel") {
      cancel();
      return;
    }
    if (action === "select") {
      confirm();
      return;
    }
    
    // Handle apply actions for different modes
    if (action === "apply") {
      const mode = detail.mode as string | undefined;
      const items = rightItems();
      if (!items.length) return;

    const rightIdx = rightLocked();
    const rightHov = rightHover();
    const idx = (rightIdx ?? rightHov ?? 0);
      const entry = items[Math.max(0, Math.min(items.length - 1, idx))];
      if (!entry) return;

      // Add mode to entry for later handling
      const entryWithMode = { ...entry, applyMode: mode };
      props.onSelect(entryWithMode);
      return;
    }

    // D-pad fallback
    const cats = safeCategories();
    const items = rightItems();

    if (direction === "left") {
      if (cats.length) setCategory(wrapIndex(leftLocked() - 1, cats.length));
      return;
    }
    if (direction === "right") {
      if (cats.length) setCategory(wrapIndex(leftLocked() + 1, cats.length));
      return;
    }
    if (direction === "up") {
      if (items.length) setItem(wrapIndex(((rightLocked() ?? 0) || 0) - 1, items.length));
      return;
    }
    if (direction === "down") {
      if (items.length) setItem(wrapIndex(((rightLocked() ?? 0) || 0) + 1, items.length));
      return;
    }

    // Stick-driven selection
    if (leftStick && Math.hypot(leftStick.x || 0, leftStick.y || 0) > stickThreshold()) {
      const ang = angleFromVec(leftStick.x || 0, leftStick.y || 0);
      const idx = sectorFromAngle(ang, Math.max(1, cats.length));
      if (idx !== leftLocked()) setCategory(idx);
    }

    if (rightStick && Math.hypot(rightStick.x || 0, rightStick.y || 0) > stickThreshold()) {
      const itemCount = Math.max(1, items.length);
      const ang = angleFromVec(rightStick.x || 0, rightStick.y || 0);
      const idx = sectorFromAngle(ang, itemCount);
      if (idx !== ((rightLocked() ?? 0) || 0)) setItem(idx);
    }
  };

  window.addEventListener("gamepadpickerinput", onPickerEvent as EventListener);
  onCleanup(() => window.removeEventListener("gamepadpickerinput", onPickerEvent as EventListener));

  // Pointer interactions
  const handleLeftSelect = (idx: number) => setCategory(idx);
  const handleRightSelect = (idx: number) => {
    setItem(idx);
    // Pointer click should confirm immediately.
    confirm();
  };

  return (
    <div class="picker-menu-overlay visible double-radial-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) cancel();
    }}>
      <div class="picker-menu visible double-radial-menu" role="dialog" aria-modal="true">
        <Show when={props.title}>
          <div class="picker-menu-title">{props.title}</div>
        </Show>

        <div class="double-radial-row">
          <div class="double-radial-column">
            <div class="double-radial-heading">Primary</div>
            <RadialMenu
              size={menuSize()}
              innerRadiusRatio={innerRatio()}
              segmentCount={safeCategories().length}
              activeSegment={leftHover() ?? leftLocked()}
              lockedSegment={leftLocked()}
              onHoverSegment={setLeftHover}
              onSelectSegment={handleLeftSelect}
              labels={leftLabels()}
              theme={THEME_LEFT}
              pointerEnabled={true}
            />
            <div class="double-radial-status">
              {leftHover() !== null ? `[ SELECTING : ${leftLabels()[leftHover()!] || ""} ]` : `[ ACTIVE : ${leftLabels()[leftLocked()] || ""} ]`}
            </div>
          </div>

          <div class="double-radial-column">
            <div class="double-radial-heading">Context</div>
            <RadialMenu
              size={menuSize()}
              innerRadiusRatio={innerRatio()}
              segmentCount={Math.max(1, rightItems().length)}
              activeSegment={rightHover() ?? rightLocked()}
              lockedSegment={rightLocked()}
              onHoverSegment={setRightHover}
              onSelectSegment={handleRightSelect}
              labels={rightLabels()}
              theme={THEME_RIGHT}
              pointerEnabled={true}
            />
            <div class="double-radial-status">
              {(() => {
                const rightIdx = rightLocked();
                const rightHov = rightHover();
                const idx = rightHov ?? rightIdx ?? 0;
                if (idx === null) return "WAITING_INPUT...";
                const label = rightLabels()[idx] || "";
                return rightHover() !== null ? `CMD > ${label}` : `EXEC > ${label}`;
              })()}
            </div>
          </div>
        </div>

        <div class="double-radial-hint">Gamepad: Left stick = category, Right stick = item, A = select, B/Back = cancel</div>
      </div>
    </div>
  );
}


