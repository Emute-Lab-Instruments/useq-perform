/**
 * widgetStoreBridge — connects the live-edit store to the CodeMirror widgets.
 *
 * Responsibilities:
 *  - Observe the store's reactive `slots` array via SolidJS `createComputed`
 *    and push updates into the CodeMirror `liveEditSlotsField` state field.
 *  - Route widget `onValueChange` callbacks back to `store.setValue`.
 *
 * Usage:
 *   const bridge = createWidgetStoreBridge();
 *   // After both the store and editor view are ready:
 *   bridge.attach(view, store);
 *   // On teardown:
 *   bridge.detach();
 *
 * Spec: docs/specs/live-edit.md §4
 */

import { createComputed, createRoot } from "solid-js";
import type { EditorView } from "@codemirror/view";
import type { LiveEditStoreAPI } from "../../../effects/liveEditStore.ts";
import type { LiveEditSlot, SlotValue } from "../../../contracts/liveEdit.ts";
import { setLiveEditSlots } from "./widgets.ts";

// ─── Public API ───────────────────────────────────────────────────────────────

export interface WidgetStoreBridge {
  /** Start syncing. Call after both store and editor view are ready. */
  attach(view: EditorView, store: LiveEditStoreAPI): void;
  /** Stop syncing and release reactive subscriptions. */
  detach(): void;
}

/**
 * Factory. Returns a bridge instance. The bridge is inert until `attach` is
 * called. Only one store+view pair can be attached at a time; calling
 * `attach` a second time implicitly detaches the previous pair first.
 */
export function createWidgetStoreBridge(): WidgetStoreBridge {
  let disposeReactiveRoot: (() => void) | null = null;

  function detach(): void {
    if (disposeReactiveRoot) {
      disposeReactiveRoot();
      disposeReactiveRoot = null;
    }
  }

  function attach(view: EditorView, store: LiveEditStoreAPI): void {
    // Always detach any previous binding before attaching a new one.
    detach();

    // Create a SolidJS reactive root that lives for the duration of the
    // attachment. The root gives us a cleanup scope: disposing it tears down
    // the createEffect subscription automatically.
    disposeReactiveRoot = createRoot((dispose) => {
      // Push store → editor: whenever the store's slots array changes,
      // update the CodeMirror state field.
      // `createComputed` is used (not `createEffect`) so that the sync runs
      // immediately and synchronously on each reactive update — matching the
      // imperative CodeMirror dispatch model and keeping tests predictable.
      //
      // We do a shallow snapshot of each slot's key fields to establish
      // fine-grained reactive dependencies on per-slot property changes
      // (not only on array additions/removals). SolidJS store proxies track
      // at the property level, so we must *read* each tracked field.
      createComputed(() => {
        const snapshot = store.slots.map((s) => ({
          id: s.id,
          kind: s.kind,
          value: s.value,
          state: s.state,
          modified: s.modified,
          min: s.min,
          max: s.max,
          step: s.step,
          precision: s.precision,
          options: s.options,
          seed: s.seed,
          range: s.range,
          name: s.name,
        }));
        setLiveEditSlots(view, snapshot as LiveEditSlot[]);
      });

      return dispose;
    });
  }

  return { attach, detach };
}

const mainEditorBridge = createWidgetStoreBridge();

/** Attach the process-wide live-edit store to the current main editor. */
export function attachLiveEditStoreBridge(
  view: EditorView,
  store: LiveEditStoreAPI,
): void {
  if (!view || typeof view.dispatch !== "function") return;
  mainEditorBridge.attach(view, store);
}

// ─── Callback factory ─────────────────────────────────────────────────────────

/**
 * Returns a `onValueChange` callback suitable for passing to
 * `createLiveEditWidgetsExtension`. Routes widget interactions to
 * `store.setValue`, which also computes the `modified` flag.
 *
 * This is a standalone helper so the bridge and the widget config can be
 * wired together without creating a circular dependency between the two.
 *
 * @example
 *   const onValueChange = createValueChangeHandler(store);
 *   createLiveEditWidgetsExtension({ onValueChange });
 */
export function createValueChangeHandler(
  store: LiveEditStoreAPI,
): (slotId: string, value: SlotValue) => void {
  return (slotId, value) => {
    store.setValue(slotId, value);
  };
}
