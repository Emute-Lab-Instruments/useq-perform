/**
 * CenterPanel — the breadcrumb + live-preview centre region of the radial
 * menu (spec §3.2.3 + §9 + §15.5).
 *
 * Pure presentational component. All inputs arrive as props; the parent
 * (RadialMenu / wired adapter) is responsible for resolving:
 *   - `hoveredItem` from `state.rightHover` against the manifest,
 *   - `currentVerb`  from `shoulderHeld` (the verb that would fire on next
 *     face press),
 *   - `previewTree`  by applying `(currentVerb, hoveredItem)` against the
 *     captured cursor target.
 *
 * Keeping this component prop-pure means it stories trivially and stays
 * cheap to test. No imports from runtime/ or effects/. CSS class names
 * are forward-references for the menu.css file produced by G3 — this
 * file does not write CSS.
 *
 * Spec: docs/specs/radial-menu.md §6.5 (centre area), §9 (breadcrumb +
 * preview), §15.5 (sub-mode breadcrumb + preview).
 */

import { Show, type JSX } from "solid-js";

import type {
  Manifest,
  MenuItem,
  MenuState,
  MenuStateOpen,
  Verb,
} from "../../lib/menu/types.ts";
import { subPhase } from "../../lib/menu/state.ts";
import type { Tree } from "../../editors/extensions/structure/core/types.ts";
import { printNode } from "../../editors/extensions/structure/adapter/printTree.ts";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CenterPanelProps {
  /** Current menu state (closed / open / numpad / t9). */
  readonly state: MenuState;
  /** The manifest the menu was opened with — used to resolve breadcrumb labels. */
  readonly manifest: Manifest;
  /**
   * The item under the right-stick hover (or the frozen-snapshot's picked item).
   * `null` when no item is hovered (e.g. cyclingLeftTabs / cyclingRightTabs).
   * Caller resolves this from `state.rightHover` or `state.frozen` against the
   * manifest.
   */
  readonly hoveredItem: MenuItem | null;
  /**
   * The verb that would fire on the next face press, given current
   * `shoulderHeld`. `null` while no verb is yet selected (cycling sub-phases,
   * or before a hand has been chosen). Caller computes.
   */
  readonly currentVerb: Verb | null;
  /**
   * Result of applying `(currentVerb, hoveredItem)` to the captured cursor
   * target. `null` when no preview is computable (no hover, sub-mode, etc.).
   */
  readonly previewTree: Tree | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CenterPanel(props: CenterPanelProps): JSX.Element {
  return (
    <div class="menu-center-panel" data-component="CenterPanel">
      <div class="menu-center-breadcrumb">{renderBreadcrumb(props)}</div>
      <div class="menu-center-preview">{renderPreview(props)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breadcrumb rendering (spec §9, §15.5.1)
// ---------------------------------------------------------------------------

/**
 * Render the breadcrumb text content. Branching:
 *   - closed              → empty.
 *   - open/cyclingLeftTabs → "<TabName> (cycling…)"
 *   - open/cyclingRightTabs → "<TabName> > <CategoryName>"
 *   - open/picking         → "<TabName> > <CategoryName> > <ItemName>"
 *   - open/frozen          → same as picking, but drawn from the frozen
 *                            snapshot's picked IDs.
 *   - numpad               → "Numbers (numpad)"
 *   - t9                   → "Symbols (t9)"
 *
 * The verb label is appended in parens for `picking` / `frozen` so the user
 * can read the predicted action ("Insert · Replace · WrapWith · Call").
 */
function renderBreadcrumb(props: CenterPanelProps): JSX.Element {
  const s = props.state;

  if (s.phase === "closed") return null;

  if (s.phase === "numpad") {
    return <span class="menu-breadcrumb-text">Numbers (numpad)</span>;
  }

  if (s.phase === "t9") {
    return <span class="menu-breadcrumb-text">Symbols (t9)</span>;
  }

  // s.phase === "open"
  const phase = subPhase(s);
  const tabLabel = resolveTabLabel(props.manifest, s);
  const categoryLabel = resolveCategoryLabel(props.manifest, s);
  const itemLabel = props.hoveredItem?.label ?? null;
  const verbLabel = props.currentVerb ? formatVerb(props.currentVerb) : null;

  if (phase === "cyclingLeftTabs") {
    return (
      <span class="menu-breadcrumb-text">
        {tabLabel} <span class="menu-breadcrumb-hint">(cycling…)</span>
      </span>
    );
  }

  if (phase === "cyclingRightTabs") {
    return (
      <span class="menu-breadcrumb-text">
        {tabLabel} <span class="menu-breadcrumb-sep">›</span>{" "}
        {categoryLabel ?? "—"}
      </span>
    );
  }

  // picking | frozen — both render the full chain. They differ in source-of-
  // truth for the picked IDs (live hover vs frozen snapshot), but the parent
  // resolves `hoveredItem` accordingly so this branch can treat them uniformly.
  return (
    <span class="menu-breadcrumb-text" classList={{ "menu-breadcrumb-frozen": phase === "frozen" }}>
      {tabLabel} <span class="menu-breadcrumb-sep">›</span>{" "}
      {categoryLabel ?? "—"} <span class="menu-breadcrumb-sep">›</span>{" "}
      {itemLabel ?? "—"}
      <Show when={verbLabel !== null}>
        {" "}
        <span class="menu-breadcrumb-verb">[{verbLabel}]</span>
      </Show>
    </span>
  );
}

/** Resolve the active left-tab's label from the manifest. */
function resolveTabLabel(manifest: Manifest, s: MenuStateOpen): string {
  const tab = manifest.tabs[s.leftTabIdx];
  return tab?.label ?? "—";
}

/**
 * Resolve the active category's label.
 *
 * - `frozen`              → from `frozen.leftPicked` (CategoryId).
 * - `cyclingRightTabs` /
 *   `picking`             → from `leftHover` index into the active tab.
 * - otherwise             → null (no category in scope).
 */
function resolveCategoryLabel(
  manifest: Manifest,
  s: MenuStateOpen,
): string | null {
  const tab = manifest.tabs[s.leftTabIdx];
  if (!tab) return null;

  if (s.frozen !== null) {
    const picked = tab.categories.find((c) => c.id === s.frozen!.leftPicked);
    return picked?.label ?? null;
  }

  if (s.leftHover !== null) {
    const cat = tab.categories[s.leftHover];
    return cat?.label ?? null;
  }

  return null;
}

/**
 * Format a Verb as a short, human-readable label. Uppercases the first letter
 * of the kind for breadcrumb display; appends a one-letter handedness hint
 * for `'left'` / `'right'`. `'both'` is rendered as the v1 reserved-no-op
 * tag (§5 / §13.4).
 */
function formatVerb(v: Verb): string {
  const kind =
    v.kind === "wrapWith"
      ? "Wrap"
      : v.kind === "call"
        ? "Call"
        : v.kind === "insert"
          ? "Insert"
          : "Replace";
  const hand = v.hand === "both" ? " (both·reserved)" : ` (${v.hand})`;
  return `${kind}${hand}`;
}

// ---------------------------------------------------------------------------
// Preview rendering (spec §9.2, §15.5.2)
// ---------------------------------------------------------------------------

/**
 * Render the preview pane. Branching by phase:
 *   - numpad → big buffer text.
 *   - t9     → big buffer text with case-mode hint.
 *   - open   → serialised previewTree (or placeholder when null).
 *   - closed → nothing.
 *
 * Tree serialisation reuses `printNode` from
 * `editors/extensions/structure/adapter/printTree.ts` — a pure flat printer
 * with no CodeMirror dependency. The full document is printed; callers that
 * want partial previews should pass a Tree containing only the relevant
 * subtree (caller's responsibility).
 *
 * Limitation: `printNode` is the flat printer (no formatting / no syntax
 * highlight). Spec §9.2 calls for "rendered in a different colour" to mark
 * the proposed mutation; that diff-highlight requires more context than this
 * pure component has. G3 (CSS) and a future iteration of the parent will
 * decorate the preview.
 */
function renderPreview(props: CenterPanelProps): JSX.Element {
  const s = props.state;

  if (s.phase === "closed") return null;

  if (s.phase === "numpad") {
    return (
      <pre class="menu-preview-buffer menu-preview-numpad">
        <span class="menu-preview-buffer-text">{s.buffer || " "}</span>
        <span class="menu-preview-cursor">_</span>
      </pre>
    );
  }

  if (s.phase === "t9") {
    return (
      <pre class="menu-preview-buffer menu-preview-t9">
        <span class="menu-preview-buffer-text">{s.buffer || " "}</span>
        <span class="menu-preview-cursor">_</span>
        <Show when={s.caseMode === "upper"}>
          <span class="menu-preview-case-hint"> [CAPS]</span>
        </Show>
      </pre>
    );
  }

  // s.phase === "open"
  if (props.previewTree === null) {
    return (
      <div class="menu-preview-placeholder">hover an item to preview</div>
    );
  }

  return (
    <pre class="menu-preview-code">
      <code>{printNode(props.previewTree.root)}</code>
    </pre>
  );
}
