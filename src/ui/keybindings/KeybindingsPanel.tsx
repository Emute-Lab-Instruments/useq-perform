/**
 * KeybindingsPanel — editable keybinding settings panel.
 *
 * Shows all bindings grouped by category. Each row has an edit button that
 * enters a "listening" mode to capture a new key combo. Conflict resolution
 * is handled inline with swap/nearby suggestions.
 */

import {
  Component,
  For,
  Show,
  createSignal,
  onCleanup,
  createEffect,
} from "solid-js";

import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { resolver } from "../../editors/keymaps";
import {
  actions,
  getAction,
  type ActionId,
  type ActionCategory,
} from "../../lib/keybindings/actions";
import { defaultKeyBindings } from "../../lib/keybindings/defaults";
import { keyEventToNotation } from "../../lib/keybindings/keyNotation";
import type {
  RebindResult,
  RebindSuggestion,
} from "../../lib/keybindings/resolver";

// ---------------------------------------------------------------------------
// Category display order (same grouping as KeybindingsTab)
// ---------------------------------------------------------------------------

const categoryDisplay: { category: ActionCategory; title: string }[] = [
  { category: "core", title: "Evaluation" },
  { category: "ui", title: "Panels" },
  { category: "editor", title: "Editor" },
  { category: "structure", title: "Structure" },
  { category: "probe", title: "Probe" },
  { category: "navigation", title: "Navigation" },
];

const displayCategories = new Set(categoryDisplay.map((c) => c.category));

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const formatKeyForDisplay = (key: string, osFamily: string): string => {
  let out = key;
  out = out.replace(/Mod/gi, osFamily === "mac" ? "Cmd" : "Ctrl");
  out = out.replace(/Meta/gi, osFamily === "mac" ? "Cmd" : "Win");
  if (osFamily === "mac") {
    out = out.replace(/Alt/gi, "Option");
  }
  return out;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BindingEntry {
  actionId: ActionId;
  description: string;
  key: string;
}

interface BindingSection {
  title: string;
  bindings: BindingEntry[];
}

interface ConflictState {
  actionId: ActionId;
  newKey: string;
  displaced: ActionId;
  suggestions: RebindSuggestion[];
}

// ---------------------------------------------------------------------------
// Build sections from resolver state
// ---------------------------------------------------------------------------

function buildSections(
  resolvedMap: Map<ActionId, { key: string }>,
): BindingSection[] {
  const grouped = new Map<ActionCategory, BindingEntry[]>();

  for (const binding of defaultKeyBindings) {
    if (binding.when) continue;

    const actionDef = actions[binding.action];
    if (!actionDef) continue;

    const cat = actionDef.category;
    if (!displayCategories.has(cat)) continue;

    const resolved = resolvedMap.get(binding.action);
    const key = resolved?.key ?? binding.key;

    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push({
      actionId: binding.action,
      description: actionDef.description,
      key,
    });
  }

  return categoryDisplay
    .filter((c) => grouped.has(c.category))
    .map((c) => ({
      title: c.title,
      bindings: grouped.get(c.category)!,
    }));
}

// ---------------------------------------------------------------------------
// KeybindingsPanel component
// ---------------------------------------------------------------------------

export const KeybindingsPanel: Component = () => {
  const osFamily = () => settings.ui?.osFamily || "pc";

  // Reactive snapshot of resolver state. Incremented on every successful rebind.
  const [version, setVersion] = createSignal(0);

  // Which action is currently in "listening" mode (null = none).
  const [listeningAction, setListeningAction] = createSignal<ActionId | null>(
    null,
  );

  // Active conflict awaiting user decision.
  const [conflict, setConflict] = createSignal<ConflictState | null>(null);

  // Derived sections — recomputes when version changes.
  const sections = () => {
    version(); // subscribe
    return buildSections(resolver.resolved());
  };

  // ------------------------------------------------------------------
  // Key capture listener
  // ------------------------------------------------------------------

  function startListening(actionId: ActionId) {
    setConflict(null);
    setListeningAction(actionId);
  }

  function stopListening() {
    setListeningAction(null);
    setConflict(null);
  }

  function handleKeyCapture(e: KeyboardEvent) {
    const action = listeningAction();
    if (!action) return;

    // Escape cancels
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopListening();
      return;
    }

    const notation = keyEventToNotation(e);
    if (!notation) return; // bare modifier press

    e.preventDefault();
    e.stopPropagation();

    const result: RebindResult = resolver.rebind(action, notation);

    if (result.status === "ok") {
      persistOverrides();
      setVersion((v) => v + 1);
      stopListening();
    } else if (result.status === "blocked") {
      // Show blocked reason briefly, then return to listening
      setConflict({
        actionId: action,
        newKey: notation,
        displaced: action, // not actually displaced, reusing field for display
        suggestions: [],
      });
      // Auto-clear after a moment — user stays in listening mode
      setTimeout(() => {
        if (listeningAction() === action) {
          setConflict(null);
        }
      }, 2500);
    } else if (result.status === "conflict") {
      // Show conflict inline — user picks resolution
      setConflict({
        actionId: action,
        newKey: notation,
        displaced: result.displaced,
        suggestions: result.suggestions,
      });
      // Exit listening mode — user resolves via conflict buttons
      setListeningAction(null);
    }
  }

  // Attach/detach the global keydown listener when listening state changes.
  createEffect(() => {
    if (listeningAction() !== null) {
      window.addEventListener("keydown", handleKeyCapture, true);
    } else {
      window.removeEventListener("keydown", handleKeyCapture, true);
    }
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyCapture, true);
  });

  // ------------------------------------------------------------------
  // Conflict resolution actions
  // ------------------------------------------------------------------

  function resolveSwap(c: ConflictState, target: string) {
    // Swap: move displaced action to target key, then rebind original action
    const swapResult = resolver.rebind(c.displaced, target);
    if (swapResult.status === "ok") {
      const rebindResult = resolver.rebind(c.actionId, c.newKey);
      if (rebindResult.status === "ok") {
        persistOverrides();
        setVersion((v) => v + 1);
      }
    }
    setConflict(null);
  }

  function resolveNearby(c: ConflictState, target: string) {
    // Move displaced action to a nearby free key, then rebind original action
    resolveSwap(c, target); // Same logic
  }

  function cancelConflict() {
    setConflict(null);
  }

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------

  function persistOverrides() {
    const resolved = resolver.resolved();
    const overrides: Record<string, string> = {};

    for (const def of defaultKeyBindings) {
      const current = resolved.get(def.action);
      if (current && current.key !== def.key) {
        overrides[def.action] = current.key;
      }
    }

    updateSettingsStore({
      keybindings: {
        ...settings.keybindings,
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      },
    });
  }

  // ------------------------------------------------------------------
  // Reset all to defaults
  // ------------------------------------------------------------------

  function resetAllToDefaults() {
    // Rebind every action back to its default key
    for (const def of defaultKeyBindings) {
      const current = resolver.resolved().get(def.action);
      if (current && current.key !== def.key) {
        resolver.rebind(def.action, def.key);
      }
    }

    updateSettingsStore({
      keybindings: {
        ...settings.keybindings,
        overrides: undefined,
      },
    });

    setVersion((v) => v + 1);
    setConflict(null);
    setListeningAction(null);
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div class="panel-tab-content">
      <For each={sections()}>
        {(section) => (
          <div class="panel-section">
            <h3 class="panel-section-title">{section.title}</h3>
            <div class="panel-section-body">
              <For each={section.bindings}>
                {(binding) => (
                  <KeybindingRow
                    binding={binding}
                    osFamily={osFamily()}
                    isListening={listeningAction() === binding.actionId}
                    conflict={
                      conflict()?.actionId === binding.actionId
                        ? conflict()!
                        : null
                    }
                    displacedByConflict={
                      conflict()?.displaced === binding.actionId &&
                      conflict()?.actionId !== binding.actionId
                        ? conflict()!
                        : null
                    }
                    onEdit={() => startListening(binding.actionId)}
                    onCancel={stopListening}
                    onSwap={resolveSwap}
                    onNearby={resolveNearby}
                    onCancelConflict={cancelConflict}
                    formatKey={formatKeyForDisplay}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </For>

      <div class="panel-section">
        <div class="panel-section-body">
          <div class="panel-row" style={{ "justify-content": "flex-start" }}>
            <button class="panel-button reset" onClick={resetAllToDefaults}>
              Reset All to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// KeybindingRow sub-component
// ---------------------------------------------------------------------------

const KeybindingRow: Component<{
  binding: BindingEntry;
  osFamily: string;
  isListening: boolean;
  conflict: ConflictState | null;
  displacedByConflict: ConflictState | null;
  onEdit: () => void;
  onCancel: () => void;
  onSwap: (c: ConflictState, target: string) => void;
  onNearby: (c: ConflictState, target: string) => void;
  onCancelConflict: () => void;
  formatKey: (key: string, osFamily: string) => string;
}> = (props) => {
  const displayKey = () =>
    props.formatKey(props.binding.key, props.osFamily);

  const displacedAction = () => {
    if (!props.conflict) return null;
    return getAction(props.conflict.displaced);
  };

  return (
    <div class="kb-row-wrapper">
      <div class="panel-row">
        <label class="panel-label">{props.binding.description}</label>
        <div class="panel-control kb-control">
          <Show
            when={!props.isListening}
            fallback={
              <span class="key-binding kb-listening">Press a key...</span>
            }
          >
            <span class="key-binding">{displayKey()}</span>
          </Show>
          <Show
            when={!props.isListening}
            fallback={
              <button
                class="kb-edit-btn"
                onClick={props.onCancel}
                title="Cancel"
              >
                &#x2715;
              </button>
            }
          >
            <button
              class="kb-edit-btn"
              onClick={props.onEdit}
              title="Rebind this shortcut"
            >
              &#x270E;
            </button>
          </Show>
        </div>
      </div>

      {/* Conflict / blocked inline UI */}
      <Show when={props.conflict}>
        {(c) => (
          <div class="kb-conflict">
            <Show
              when={c().suggestions.length > 0}
              fallback={
                <span class="kb-conflict-blocked">
                  Blocked: {getAction(c().displaced)?.description ?? c().displaced}
                </span>
              }
            >
              <span class="kb-conflict-msg">
                Conflicts with "{getAction(c().displaced)?.description ?? c().displaced}"
              </span>
              <div class="kb-conflict-actions">
                <For each={c().suggestions}>
                  {(suggestion) => (
                    <Show when={suggestion.type === "swap"}>
                      <button
                        class="panel-button kb-conflict-btn"
                        onClick={() =>
                          props.onSwap(c(), suggestion.target)
                        }
                      >
                        Swap
                      </button>
                    </Show>
                  )}
                </For>
                <For each={c().suggestions}>
                  {(suggestion) => (
                    <Show when={suggestion.type === "nearby"}>
                      <button
                        class="panel-button kb-conflict-btn"
                        onClick={() =>
                          props.onNearby(c(), suggestion.target)
                        }
                      >
                        Use {props.formatKey(suggestion.target, props.osFamily)}{" "}
                        instead
                      </button>
                    </Show>
                  )}
                </For>
                <button
                  class="panel-button kb-conflict-btn"
                  onClick={props.onCancelConflict}
                >
                  Cancel
                </button>
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* Show a notice on the displaced row when another row has a conflict targeting it */}
      <Show when={props.displacedByConflict}>
        <div class="kb-conflict">
          <span class="kb-conflict-msg">
            Will be displaced by this rebind
          </span>
        </div>
      </Show>
    </div>
  );
};
