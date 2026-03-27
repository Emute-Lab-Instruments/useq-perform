// src/ui/keybindings/KeyboardVisualiser.tsx
//
// Keyboard visualiser with view and edit modes. Renders a physical keyboard
// layout with bindings colour-coded by action category. In edit mode, keys
// are clickable to rebind actions via a capture-next-keypress flow.

import { createMemo, createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import { getLayout, type KeyboardLayoutId, type KeyDef } from "../../lib/keybindings/layouts/index.ts";
import { actions, type ActionCategory, type ActionId } from "../../lib/keybindings/actions.ts";
import { defaultKeyBindings, type KeyBinding } from "../../lib/keybindings/defaults.ts";
import { keyEventToNotation } from "../../lib/keybindings/keyNotation.ts";
import type { BindingResolver, RebindResult, RebindSuggestion } from "../../lib/keybindings/resolver.ts";

// ---------------------------------------------------------------------------
// Category colour scheme
// ---------------------------------------------------------------------------

const categoryColors: Record<ActionCategory, string> = {
  core:       "#4DC9B0",
  editor:     "#FD971F",
  structure:  "#66BB6A",
  probe:      "#CE93D8",
  navigation: "#78909C",
  ui:         "#42A5F5",
  transport:  "#FFD54F",
  gamepad:    "#FF7043",
  menu:       "#AED581",
};

const categoryLabels: Record<ActionCategory, string> = {
  core:       "Core",
  editor:     "Editor",
  structure:  "Structure",
  probe:      "Probe",
  navigation: "Navigation",
  ui:         "UI",
  transport:  "Transport",
  gamepad:    "Gamepad",
  menu:       "Menu",
};

// ---------------------------------------------------------------------------
// CodeMirror key name -> physical KeyboardEvent.code mapping
// ---------------------------------------------------------------------------

const keyToCode: Record<string, string> = {
  // Letters
  a: "KeyA", b: "KeyB", c: "KeyC", d: "KeyD", e: "KeyE",
  f: "KeyF", g: "KeyG", h: "KeyH", i: "KeyI", j: "KeyJ",
  k: "KeyK", l: "KeyL", m: "KeyM", n: "KeyN", o: "KeyO",
  p: "KeyP", q: "KeyQ", r: "KeyR", s: "KeyS", t: "KeyT",
  u: "KeyU", v: "KeyV", w: "KeyW", x: "KeyX", y: "KeyY",
  z: "KeyZ",
  // Digits
  "0": "Digit0", "1": "Digit1", "2": "Digit2", "3": "Digit3",
  "4": "Digit4", "5": "Digit5", "6": "Digit6", "7": "Digit7",
  "8": "Digit8", "9": "Digit9",
  // Punctuation / symbols
  "[": "BracketLeft", "]": "BracketRight",
  ";": "Semicolon", "'": "Quote",
  ",": "Comma", ".": "Period", "/": "Slash",
  "\\": "Backslash", "`": "Backquote",
  "-": "Minus", "=": "Equal",
  // Named keys
  "Enter": "Enter", "Backspace": "Backspace",
  "Tab": "Tab", "Space": "Space",
  "Escape": "Escape", "Delete": "Delete",
  "Home": "Home", "End": "End",
  "ArrowUp": "ArrowUp", "ArrowDown": "ArrowDown",
  "ArrowLeft": "ArrowLeft", "ArrowRight": "ArrowRight",
  // Function keys
  "F1": "F1", "F2": "F2", "F3": "F3", "F4": "F4",
  "F5": "F5", "F6": "F6", "F7": "F7", "F8": "F8",
  "F9": "F9", "F10": "F10", "F11": "F11", "F12": "F12",
};

// ---------------------------------------------------------------------------
// Modifier parsing
// ---------------------------------------------------------------------------

const MODIFIERS = ["Mod", "Ctrl", "Alt", "Shift", "Meta"] as const;
type Modifier = (typeof MODIFIERS)[number];

interface ParsedBinding {
  modifiers: Set<Modifier>;
  baseCode: string;  // Physical key code
  action: ActionId;
  description: string;
  category: ActionCategory;
}

/**
 * Parse a CodeMirror key notation string into modifiers + physical key code.
 * Handles chords by taking only the first stroke (leader key).
 */
function parseKeyString(key: string): { modifiers: Set<Modifier>; baseKey: string } | null {
  // For chords like "Alt-s ]", take the first stroke
  const trimmed = key.trim();
  if (!trimmed) return null;
  const firstStroke = trimmed.split(" ")[0];
  const parts = firstStroke.split("-");
  const modifiers = new Set<Modifier>();
  const baseKey = parts[parts.length - 1];

  for (let i = 0; i < parts.length - 1; i++) {
    const mod = parts[i] as Modifier;
    if (MODIFIERS.includes(mod)) {
      modifiers.add(mod);
    }
  }

  // Handle edge case: key might be empty if notation ends with "-"
  if (!baseKey) return null;

  return { modifiers, baseKey };
}

function resolveToPhysicalCode(baseKey: string): string | null {
  // Direct lookup in our mapping table
  if (keyToCode[baseKey]) return keyToCode[baseKey];
  // Try lowercase for letter keys (CodeMirror uses lowercase)
  if (keyToCode[baseKey.toLowerCase()]) return keyToCode[baseKey.toLowerCase()];
  // Already a code? (e.g. "Enter", "Backspace" are both names and codes)
  return null;
}

// ---------------------------------------------------------------------------
// Build binding map: physical key code -> binding info
// ---------------------------------------------------------------------------

interface KeyBindingInfo {
  action: ActionId;
  description: string;
  category: ActionCategory;
  modifiers: Set<Modifier>;
  isChord: boolean;
  /** Original CodeMirror key notation (e.g. "Mod-s") */
  keyNotation: string;
}

function buildBindingMap(bindings: KeyBinding[]): Map<string, KeyBindingInfo[]> {
  const map = new Map<string, KeyBindingInfo[]>();

  for (const binding of bindings) {
    const parsed = parseKeyString(binding.key);
    if (!parsed) continue;

    const code = resolveToPhysicalCode(parsed.baseKey);
    if (!code) continue;

    const actionDef = actions[binding.action];
    if (!actionDef) continue;

    const info: KeyBindingInfo = {
      action: binding.action,
      description: actionDef.description,
      category: actionDef.category,
      modifiers: parsed.modifiers,
      isChord: binding.key.includes(" "),
      keyNotation: binding.key,
    };

    const existing = map.get(code) || [];
    existing.push(info);
    map.set(code, existing);
  }

  return map;
}

/**
 * Pick the "primary" binding for a key to display.
 * Prefers non-modifier bindings, then non-chord, then first found.
 */
function primaryBinding(infos: KeyBindingInfo[]): KeyBindingInfo {
  // Prefer bindings without modifiers (direct key press)
  const noMod = infos.find(b => b.modifiers.size === 0 && !b.isChord);
  if (noMod) return noMod;
  // Then any non-chord binding
  const nonChord = infos.find(b => !b.isChord);
  if (nonChord) return nonChord;
  return infos[0];
}

// ---------------------------------------------------------------------------
// Modifier key helpers
// ---------------------------------------------------------------------------

const MODIFIER_CODES = new Set([
  "ShiftLeft", "ShiftRight",
  "ControlLeft", "ControlRight",
  "AltLeft", "AltRight",
  "MetaLeft", "MetaRight",
  "CapsLock",
]);

/** Check if any binding uses a given modifier name */
function isModifierUsed(
  mod: Modifier,
  bindingMap: Map<string, KeyBindingInfo[]>,
): boolean {
  for (const infos of bindingMap.values()) {
    for (const info of infos) {
      if (info.modifiers.has(mod)) return true;
    }
  }
  return false;
}

/** Map physical modifier codes to their modifier name */
function codeToModifier(code: string): Modifier | null {
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  if (code === "MetaLeft" || code === "MetaRight") return "Mod";
  return null;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatModifiers(mods: Set<Modifier>): string {
  const parts: string[] = [];
  if (mods.has("Mod") || mods.has("Ctrl")) parts.push("Ctrl");
  if (mods.has("Alt")) parts.push("Alt");
  if (mods.has("Shift")) parts.push("Shift");
  if (mods.has("Meta")) parts.push("Meta");
  return parts.join("+");
}

// ---------------------------------------------------------------------------
// Base key size
// ---------------------------------------------------------------------------

const BASE_KEY_SIZE = 36; // px per unit width
const KEY_GAP = 2; // px between keys

// ---------------------------------------------------------------------------
// Chord completion helpers
// ---------------------------------------------------------------------------

/** Info about a key that completes a pending chord sequence. */
interface ChordCompletionInfo {
  action: ActionId;
  description: string;
  category: ActionCategory;
}

/**
 * Normalise heatmap key counts to 0-1 intensity per physical key code.
 */
function buildHeatByCode(heatmap: Map<string, number>): Map<string, number> {
  const result = new Map<string, number>();
  let max = 0;
  for (const count of heatmap.values()) {
    if (count > max) max = count;
  }
  if (max === 0) return result;
  for (const [key, count] of heatmap) {
    const parsed = parseKeyString(key);
    if (!parsed) continue;
    const code = resolveToPhysicalCode(parsed.baseKey);
    if (!code) continue;
    const intensity = count / max;
    const existing = result.get(code) ?? 0;
    result.set(code, Math.max(existing, intensity));
  }
  return result;
}

/**
 * Build a map from physical key code -> chord completion info for a given
 * leader prefix.  Scans the supplied bindings for chords that start with the
 * leader and extracts their second stroke.
 */
function buildChordCompletionMap(
  leader: string,
  bindings: KeyBinding[],
): Map<string, ChordCompletionInfo> {
  const map = new Map<string, ChordCompletionInfo>();
  const prefix = leader + " ";

  for (const binding of bindings) {
    if (!binding.key.startsWith(prefix)) continue;

    const secondStroke = binding.key.slice(prefix.length);
    const code = resolveToPhysicalCode(secondStroke);
    if (!code) continue;

    const actionDef = actions[binding.action];
    if (!actionDef) continue;

    map.set(code, {
      action: binding.action,
      description: actionDef.description,
      category: actionDef.category,
    });
  }

  return map;
}

/**
 * Resolve a leader key string (e.g. "Alt-e") to the physical code of its
 * base key so the visualiser can highlight it.
 */
function leaderToPhysicalCode(leader: string): string | null {
  const parsed = parseKeyString(leader);
  if (!parsed) return null;
  return resolveToPhysicalCode(parsed.baseKey);
}

// ---------------------------------------------------------------------------
// Edit mode types
// ---------------------------------------------------------------------------

interface EditConflict {
  message: string;
  displaced?: ActionId;
  suggestions: RebindSuggestion[];
}

// ---------------------------------------------------------------------------
// Set of all bound physical codes (for "free key" glow in edit mode)
// ---------------------------------------------------------------------------

function buildBoundCodeSet(bindingMap: Map<string, KeyBindingInfo[]>): Set<string> {
  return new Set(bindingMap.keys());
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface KeyProps {
  def: KeyDef;
  bindings: KeyBindingInfo[] | undefined;
  bindingMap: Map<string, KeyBindingInfo[]>;
  chordCompletions?: Map<string, ChordCompletionInfo>;
  chordLeaderCode?: string | null;
  inChordMode: boolean;
  // Edit mode props
  editMode: boolean;
  isListening: boolean;
  justRebound: boolean;
  isFreeKey: boolean;
  editConflict: EditConflict | null;
  onKeyClick?: (code: string, bindings: KeyBindingInfo[] | undefined) => void;
  // Heatmap
  heatIntensity?: number;
}

function Key(props: KeyProps) {
  const width = () => (props.def.w || 1) * BASE_KEY_SIZE - KEY_GAP;
  const isGap = () => !!props.def.gap;
  const isModifier = () => MODIFIER_CODES.has(props.def.code);

  const binding = () => {
    if (!props.bindings || props.bindings.length === 0) return null;
    return primaryBinding(props.bindings);
  };

  const modName = () => codeToModifier(props.def.code);
  const modUsed = () => {
    const m = modName();
    return m ? isModifierUsed(m, props.bindingMap) : false;
  };

  const bgColor = () => {
    const b = binding();
    if (b) return categoryColors[b.category];
    return undefined;
  };

  const tooltip = () => {
    if (props.isListening) return "Press a key to rebind, Escape to cancel";
    if (props.editMode && props.isFreeKey) return `${props.def.label} - available`;
    if (!props.bindings || props.bindings.length === 0) {
      return props.def.label || props.def.code;
    }
    return props.bindings
      .map(b => {
        const modStr = formatModifiers(b.modifiers);
        const prefix = modStr ? modStr + "+" : "";
        return `${prefix}${props.def.label}: ${b.description}`;
      })
      .join("\n");
  };

  const displayLabel = () => {
    if (props.isListening) return "Press key...";
    const b = binding();
    if (b) {
      const desc = b.description;
      const maxLen = Math.floor(((props.def.w || 1) * BASE_KEY_SIZE) / 6);
      if (desc.length > maxLen) {
        return b.action.split(".").pop() || desc.slice(0, maxLen);
      }
      return desc;
    }
    return props.def.label;
  };

  const handleClick = () => {
    if (!props.editMode || isGap()) return;
    props.onKeyClick?.(props.def.code, props.bindings);
  };

  return (
    <div
      class="kv-key"
      classList={{
        "kv-gap": isGap(),
        "kv-bound": !!binding(),
        "kv-unbound": !binding() && !isGap() && !isModifier(),
        "kv-modifier": isModifier(),
        "kv-modifier-used": isModifier() && modUsed(),
        "kv-has-modifier": !!binding()?.modifiers.size,
        "kv-edit-mode": props.editMode,
        "kv-listening": props.isListening,
        "kv-just-rebound": props.justRebound,
        "kv-free-key": props.editMode && props.isFreeKey && !isModifier() && !isGap(),
        "kv-clickable": props.editMode && !!binding() && !isGap(),
      }}
      title={tooltip()}
      style={{
        width: `${width()}px`,
        background: bgColor()
          ? `${bgColor()}20`
          : undefined,
        "border-color": props.isListening
          ? bgColor() || "#42A5F5"
          : bgColor()
            ? `${bgColor()}50`
            : undefined,
      }}
      onClick={handleClick}
    >
      <span class="kv-key-label">{props.def.label}</span>
      <Show when={binding() || props.isListening}>
        <span
          class="kv-key-action"
          style={{ color: props.isListening ? "rgba(255,255,255,0.8)" : bgColor() }}
        >
          {displayLabel()}
        </span>
      </Show>
      <Show when={props.bindings && props.bindings.length > 1 && !props.isListening}>
        <span class="kv-key-multi">+{props.bindings!.length - 1}</span>
      </Show>
      {/* Inline conflict overlay */}
      <Show when={props.editConflict}>
        {(conflict) => (
          <div class="kv-conflict-overlay">
            <span class="kv-conflict-msg">{conflict().message}</span>
          </div>
        )}
      </Show>
    </div>
  );
}

interface KeyRowProps {
  row: KeyDef[];
  bindingMap: Map<string, KeyBindingInfo[]>;
  // Edit mode pass-through
  editMode: boolean;
  listeningCode: string | null;
  justReboundCode: string | null;
  boundCodes: Set<string>;
  editConflict: EditConflict | null;
  editConflictCode: string | null;
  onKeyClick?: (code: string, bindings: KeyBindingInfo[] | undefined) => void;
  // Chord mode pass-through
  chordCompletions?: Map<string, ChordCompletionInfo>;
  chordLeaderCode?: string | null;
  inChordMode: boolean;
  // Heatmap pass-through
  heatIntensity?: Map<string, number>;
}

function KeyRow(props: KeyRowProps) {
  return (
    <div class="kv-row">
      <For each={props.row}>
        {(keyDef) => (
          <Key
            def={keyDef}
            bindings={props.bindingMap.get(keyDef.code)}
            bindingMap={props.bindingMap}
            inChordMode={props.inChordMode}
            chordCompletions={props.chordCompletions}
            chordLeaderCode={props.chordLeaderCode}
            editMode={props.editMode}
            isListening={props.listeningCode === keyDef.code}
            justRebound={props.justReboundCode === keyDef.code}
            isFreeKey={!props.boundCodes.has(keyDef.code)}
            editConflict={props.editConflictCode === keyDef.code ? props.editConflict : null}
            onKeyClick={props.onKeyClick}
            heatIntensity={props.heatIntensity?.get(keyDef.code)}
          />
        )}
      </For>
    </div>
  );
}

interface LegendProps {
  activeCategories: ActionCategory[];
}

function Legend(props: LegendProps) {
  return (
    <div class="kv-legend">
      <For each={props.activeCategories}>
        {(cat) => (
          <span class="kv-legend-item">
            <span
              class="kv-legend-dot"
              style={{ background: categoryColors[cat] }}
            />
            {categoryLabels[cat]}
          </span>
        )}
      </For>
    </div>
  );
}

interface CommandListProps {
  bindings: KeyBinding[];
}

function CommandList(props: CommandListProps) {
  const groups = createMemo(() => {
    const cats = new Map<ActionCategory, { action: ActionId; key: string; description: string }[]>();
    for (const b of props.bindings) {
      const actionDef = actions[b.action];
      if (!actionDef) continue;
      const cat = actionDef.category;
      if (!cats.has(cat)) cats.set(cat, []);
      cats.get(cat)!.push({
        action: b.action,
        key: b.key,
        description: actionDef.description,
      });
    }
    return cats;
  });

  return (
    <div class="kv-command-list">
      <For each={[...groups().entries()]}>
        {([cat, items]) => (
          <div class="kv-cmd-group">
            <div class="kv-cmd-group-title" style={{ color: categoryColors[cat] }}>
              {categoryLabels[cat]}
            </div>
            <For each={items}>
              {(item) => (
                <div class="kv-cmd-row">
                  <span class="kv-cmd-key">{item.key}</span>
                  <span class="kv-cmd-desc">{item.description}</span>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface KeyboardVisualiserProps {
  layout?: KeyboardLayoutId;
  /** Key bindings to display. Defaults to defaultKeyBindings when omitted. */
  bindings?: KeyBinding[];
  showLegend?: boolean;
  showCommandList?: boolean;
  mode?: "view" | "edit";
  resolver?: BindingResolver;
  onRebind?: (action: ActionId, newKey: string) => void;
  pendingChord?: () => string | null;
  heatmap?: Map<string, number>;
}

export default function KeyboardVisualiser(props: KeyboardVisualiserProps) {
  const layoutId = (): KeyboardLayoutId => props.layout ?? "qwerty-us";
  const activeBindings = (): KeyBinding[] => props.bindings ?? defaultKeyBindings;

  const layout = createMemo(() => getLayout(layoutId()));
  const isEditMode = () => (props.mode === "edit") && !!props.resolver;

  // Binding map recomputes when resolver version changes (edit mode)
  // or stays static from defaults (view mode).
  const [resolverVersion, setResolverVersion] = createSignal(0);

  const bindingMap = createMemo(() => {
    if (isEditMode() && props.resolver) {
      resolverVersion(); // subscribe to version bumps
      const resolved = props.resolver!.resolved();
      const bindings: KeyBinding[] = [];
      for (const [actionId, rb] of resolved) {
        bindings.push({ action: actionId, key: rb.key });
      }
      return buildBindingMap(bindings);
    }
    return buildBindingMap(activeBindings());
  });

  const boundCodes = createMemo(() => buildBoundCodeSet(bindingMap()));

  const activeCategories = createMemo((): ActionCategory[] => {
    const cats = new Set<ActionCategory>();
    for (const infos of bindingMap().values()) {
      for (const info of infos) {
        cats.add(info.category);
      }
    }
    const order: ActionCategory[] = [
      "core", "editor", "structure", "probe",
      "navigation", "ui", "transport", "gamepad", "menu",
    ];
    return order.filter(c => cats.has(c));
  });

  const showLegend = () => props.showLegend !== false;
  const showCommandList = () => props.showCommandList === true;

  // -----------------------------------------------------------------------
  // Edit mode state
  // -----------------------------------------------------------------------

  const [listeningCode, setListeningCode] = createSignal<string | null>(null);
  const [listeningAction, setListeningAction] = createSignal<ActionId | null>(null);
  const [justReboundCode, setJustReboundCode] = createSignal<string | null>(null);
  const [editConflict, setEditConflict] = createSignal<EditConflict | null>(null);
  const [editConflictCode, setEditConflictCode] = createSignal<string | null>(null);

  function handleKeyClick(code: string, bindings: KeyBindingInfo[] | undefined) {
    if (!isEditMode()) return;
    if (!bindings || bindings.length === 0) return;

    if (listeningCode() === code) {
      cancelListening();
      return;
    }

    const primary = primaryBinding(bindings);
    setEditConflict(null);
    setEditConflictCode(null);
    setListeningCode(code);
    setListeningAction(primary.action);
  }

  function cancelListening() {
    setListeningCode(null);
    setListeningAction(null);
    setEditConflict(null);
    setEditConflictCode(null);
  }

  function handleKeyCapture(e: KeyboardEvent) {
    const action = listeningAction();
    const code = listeningCode();
    if (!action || !code || !props.resolver) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelListening();
      return;
    }

    const notation = keyEventToNotation(e);
    if (!notation) return;

    e.preventDefault();
    e.stopPropagation();

    const result: RebindResult = props.resolver.rebind(action, notation);

    if (result.status === "ok") {
      setResolverVersion(v => v + 1);
      props.onRebind?.(action, notation);

      const parsed = parseKeyString(notation);
      const targetCode = parsed ? resolveToPhysicalCode(parsed.baseKey) : null;
      const flashCode = targetCode || code;
      setJustReboundCode(flashCode);
      setTimeout(() => {
        if (justReboundCode() === flashCode) setJustReboundCode(null);
      }, 600);

      cancelListening();
    } else if (result.status === "blocked") {
      setEditConflict({ message: `Blocked: ${result.reason}`, suggestions: [] });
      setEditConflictCode(code);
      setTimeout(() => {
        if (listeningCode() === code) {
          setEditConflict(null);
          setEditConflictCode(null);
        }
      }, 2500);
    } else if (result.status === "conflict") {
      const displacedDef = actions[result.displaced];
      const displacedName = displacedDef?.description ?? result.displaced;
      setEditConflict({
        message: `Conflicts with "${displacedName}"`,
        displaced: result.displaced,
        suggestions: result.suggestions,
      });
      setEditConflictCode(code);
    }
  }

  createEffect(() => {
    if (listeningCode() !== null) {
      window.addEventListener("keydown", handleKeyCapture, true);
    } else {
      window.removeEventListener("keydown", handleKeyCapture, true);
    }
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyCapture, true);
  });

  return (
    <div class="kv-container" classList={{ "kv-edit-active": isEditMode() }}>
      <div class="kv-layout" classList={{ "kv-with-commands": showCommandList() }}>
        <div class="kv-keyboard">
          <For each={layout().rows}>
            {(row) => (
              <KeyRow
                row={row}
                bindingMap={bindingMap()}
                editMode={isEditMode()}
                listeningCode={listeningCode()}
                justReboundCode={justReboundCode()}
                boundCodes={boundCodes()}
                editConflict={editConflict()}
                editConflictCode={editConflictCode()}
                onKeyClick={handleKeyClick}
                inChordMode={!!props.pendingChord?.()}
                chordCompletions={props.pendingChord?.() ? buildChordCompletionMap(props.pendingChord()!, activeBindings()) : undefined}
                chordLeaderCode={props.pendingChord?.() ? leaderToPhysicalCode(props.pendingChord()!) : null}
                heatIntensity={props.heatmap ? buildHeatByCode(props.heatmap) : undefined}
              />
            )}
          </For>
        </div>

        <Show when={showCommandList()}>
          <CommandList bindings={activeBindings()} />
        </Show>
      </div>

      <Show when={showLegend()}>
        <Legend activeCategories={activeCategories()} />
      </Show>

      <Show when={isEditMode()}>
        <div class="kv-edit-hint">
          <Show when={listeningCode()} fallback={<span>Click a bound key to rebind it</span>}>
            <span>Press a new key combo, or Escape to cancel</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}
