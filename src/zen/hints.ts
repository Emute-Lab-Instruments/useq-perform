import type { ActionId } from "../lib/keybindings/actions";
import { modalShiftLayers } from "../lib/gamepad/paradigms/modal-shift";
import { defaultKeyBindings } from "../lib/keybindings/defaults";
import type { Layer } from "../lib/gamepad/types";

export interface ButtonHint {
  gamepad: string | null;
  keyboard: string | null;
}

// Build a reverse lookup: ActionId → gamepad button description
function buildGamepadReverseLookup(layers: readonly Layer[]): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const layer of layers) {
    if (!layer.gestures) continue;
    for (const [gestureKey, binding] of Object.entries(layer.gestures)) {
      const actionId = typeof binding === "string" ? binding : undefined;
      if (!actionId) continue;
      if (lookup.has(actionId)) continue; // first match wins (higher layers first)

      const hint = gestureKeyToHint(gestureKey, layer.name as string);
      if (hint) lookup.set(actionId, hint);
    }
  }

  return lookup;
}

function gestureKeyToHint(gestureKey: string, layerName: string): string | null {
  // gestureKey format: "tap:A", "held:Up", "chord:A+LB"
  const [kind, rest] = gestureKey.split(":");
  if (!rest) return null;

  const isShifted = layerName.includes("lb") || layerName.includes("rb");
  const modifier = layerName.includes("lb") ? "LB + " : layerName.includes("rb") ? "RB + " : "";

  switch (kind) {
    case "tap":
    case "held":
      return `${modifier}${rest}`;
    case "chord":
      return rest.replace("+", " + ");
    default:
      return rest;
  }
}

// Build reverse lookup: ActionId → keyboard shortcut
function buildKeyboardReverseLookup(): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const binding of defaultKeyBindings) {
    if (lookup.has(binding.action)) continue;
    if (binding.when) continue; // skip context-dependent bindings
    lookup.set(binding.action, formatKeyboardShortcut(binding.key));
  }
  return lookup;
}

function formatKeyboardShortcut(key: string): string {
  return key
    .replace("Mod-", "Ctrl+")
    .replace("Alt-", "Alt+")
    .replace("Shift-", "Shift+")
    .replace("Ctrl-", "Ctrl+")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("Enter", "Enter");
}

const gamepadLookup = buildGamepadReverseLookup(modalShiftLayers);
const keyboardLookup = buildKeyboardReverseLookup();

export function getButtonHint(actionId: ActionId): ButtonHint {
  return {
    gamepad: gamepadLookup.get(actionId) ?? null,
    keyboard: keyboardLookup.get(actionId) ?? null,
  };
}

export function getHintSequence(actions: ActionId[]): ButtonHint[] {
  return actions.map(getButtonHint);
}

export function getDeduplicatedHints(actions: ActionId[]): { action: ActionId; hint: ButtonHint }[] {
  const seen = new Set<string>();
  const result: { action: ActionId; hint: ButtonHint }[] = [];
  for (const action of actions) {
    if (seen.has(action)) continue;
    seen.add(action);
    result.push({ action, hint: getButtonHint(action) });
  }
  result.sort((a, b) => a.action.localeCompare(b.action));
  return result;
}

export function formatGamepadHint(hint: ButtonHint): string {
  if (hint.gamepad) return hint.gamepad;
  return "";
}

export function formatKeyboardHint(hint: ButtonHint): string {
  if (hint.keyboard) return hint.keyboard;
  return "";
}
