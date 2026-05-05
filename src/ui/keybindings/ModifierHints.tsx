import {
  createSignal,
  onCleanup,
  Show,
  Switch,
  Match,
  type JSX,
} from "solid-js";
import { settings } from "../../utils/settingsStore.ts";
import { editor } from "../../lib/editorStore.ts";
import { getHandler } from "../../lib/keybindings/handlers.ts";
import { actions, type ActionId } from "../../lib/keybindings/actions.ts";
import { defaultKeyBindings } from "../../lib/keybindings/defaults.ts";
import {
  MODIFIER_KEYS,
  MODIFIER_LABELS,
  getHintsForModifier,
  getChordCompletions,
  isChordLeader,
  type HintEntry,
  type HintStyle,
} from "./hintData.ts";
import {
  hintState,
  heldModifier,
  pendingChordPrefix,
  expandedNamespaces,
  sticky,
  startModifierHold,
  handleNonModifierKey,
  handleModifierRelease,
  handleMouseEnter,
  handleMouseLeave,
  getStickyModifier,
  dismissHints,
  toggleNamespace,
} from "./hintStateMachine.ts";
import { ModifierHintsCursor, getEditorCursorPosition } from "./hints/ModifierHintsCursor.tsx";
import { ModifierHintsBar } from "./hints/ModifierHintsBar.tsx";
import { ModifierHintsModal } from "./hints/ModifierHintsModal.tsx";

export function ModifierHints(): JSX.Element {
  const [position, setPosition] = createSignal<{ x: number; y: number } | null>(null);

  const style = (): HintStyle =>
    (settings.keybindings?.modifierHintStyle as HintStyle) ?? "cursor";

  const visible = () => hintState() !== "HIDDEN";

  const hints = (): HintEntry[] => {
    const state = hintState();
    if (state === "MODIFIER_ACTIVE") {
      const mod = heldModifier();
      return mod ? getHintsForModifier(mod) : [];
    }
    if (state === "CHORD_PENDING") {
      const prefix = pendingChordPrefix();
      return prefix ? getChordCompletions(prefix) : [];
    }
    return [];
  };

  const header = (): string => {
    const state = hintState();
    if (state === "MODIFIER_ACTIVE") {
      const mod = heldModifier();
      if (!mod) return "";
      return (MODIFIER_LABELS[mod] ?? mod) + " + ...";
    }
    if (state === "CHORD_PENDING") {
      const prefix = pendingChordPrefix();
      if (!prefix) return "";
      return prefix + " → ...";
    }
    return "";
  };

  function executeEntry(entry: HintEntry): void {
    if (!entry.actionId) return;
    const handler = getHandler(entry.actionId);
    if (handler) {
      const action = actions[entry.actionId] as { requiresEditor?: boolean };
      const view = editor();
      if (action.requiresEditor && view) {
        (handler as (v: any) => boolean)(view);
      } else if (!action.requiresEditor) {
        (handler as () => boolean)();
      }
    }
    dismissHints();
  }

  function handleToggleExpand(entry: HintEntry): void {
    toggleNamespace(entry.key);
  }

  /**
   * In sticky mode (modifier released, mouse in popup), bare keystrokes
   * should be dispatched as if the modifier were still held.
   * Returns true if the key was handled (should preventDefault + stop propagation).
   */
  function handleStickyKey(key: string): boolean {
    const mod = getStickyModifier();
    if (!mod) return false;

    const state = hintState();

    if (state === "MODIFIER_ACTIVE") {
      // Check if this is a chord leader under the sticky modifier
      if (isChordLeader(mod, key)) {
        handleNonModifierKey(key);
        return true;
      }
      // Try to find and execute a direct binding
      const bindingKey = mod + "-" + key;
      const binding = defaultKeyBindings.find(
        (b) => b.key === bindingKey && !b.when
      );
      if (binding) {
        const handler = getHandler(binding.action as ActionId);
        if (handler) {
          const action = actions[binding.action as ActionId] as { requiresEditor?: boolean };
          const view = editor();
          if (action.requiresEditor && view) {
            (handler as (v: any) => boolean)(view);
          } else if (!action.requiresEditor) {
            (handler as () => boolean)();
          }
        }
        dismissHints();
        return true;
      }
    }

    if (state === "CHORD_PENDING") {
      const prefix = pendingChordPrefix();
      if (!prefix) return false;
      const bindingKey = prefix + " " + key;
      const binding = defaultKeyBindings.find(
        (b) => b.key === bindingKey && !b.when
      );
      if (binding) {
        const handler = getHandler(binding.action as ActionId);
        if (handler) {
          const action = actions[binding.action as ActionId] as { requiresEditor?: boolean };
          const view = editor();
          if (action.requiresEditor && view) {
            (handler as (v: any) => boolean)(view);
          } else if (!action.requiresEditor) {
            (handler as () => boolean)();
          }
        }
        dismissHints();
        return true;
      }
    }

    return false;
  }

  function onKeyDown(e: KeyboardEvent): void {
    const modPrefix = MODIFIER_KEYS[e.key];
    if (modPrefix) {
      if (heldModifier() === null) {
        startModifierHold(modPrefix);
        if (style() === "cursor") {
          setPosition(getEditorCursorPosition());
        }
      }
    } else if (e.key === "Escape") {
      dismissHints();
    } else {
      // In sticky mode, intercept the bare key and execute the binding ourselves
      if (sticky() && handleStickyKey(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      handleNonModifierKey(e.key);
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    const modPrefix = MODIFIER_KEYS[e.key];
    if (modPrefix) {
      handleModifierRelease(modPrefix);
    }
  }

  function onBlur(): void {
    dismissHints();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);

    onCleanup(() => {
      dismissHints();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    });
  }

  return (
    <Show when={visible() && hints().length > 0}>
      <div class="mh-content-fade">
        <Switch>
          <Match when={style() === "cursor"}>
            <ModifierHintsCursor
              header={header()}
              entries={hints()}
              expandedNamespaces={expandedNamespaces()}
              onExecute={executeEntry}
              onToggleExpand={handleToggleExpand}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              position={position()}
            />
          </Match>
          <Match when={style() === "bar"}>
            <ModifierHintsBar
              header={header()}
              entries={hints()}
              expandedNamespaces={expandedNamespaces()}
              onExecute={executeEntry}
              onToggleExpand={handleToggleExpand}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            />
          </Match>
          <Match when={style() === "modal"}>
            <ModifierHintsModal
              header={header()}
              entries={hints()}
              expandedNamespaces={expandedNamespaces()}
              onExecute={executeEntry}
              onToggleExpand={handleToggleExpand}
              onBackdropClick={dismissHints}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            />
          </Match>
        </Switch>
      </div>
    </Show>
  );
}
