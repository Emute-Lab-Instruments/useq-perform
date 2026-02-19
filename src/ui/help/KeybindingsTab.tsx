import { Component, For, createSignal, Show, onMount } from "solid-js";
import { settings, updateSettingsStore } from "../../utils/settingsStore";

interface Binding {
  description: string;
  action: string;
  key: string;
}

const formatKeyForDisplay = (key: string, osFamily: string) => {
  let out = key;
  // Normalize case: common aliases
  out = out.replace(/Mod/gi, osFamily === "mac" ? "Cmd" : "Ctrl");
  out = out.replace(/Meta/gi, osFamily === "mac" ? "Cmd" : "Win");
  if (osFamily === "mac") {
    out = out.replace(/Alt/gi, "Option");
  }
  return out;
};

const KeybindingRow: Component<{ 
  binding: Binding; 
  osFamily: string;
  onEdit: (binding: Binding) => void;
}> = (props) => {
  return (
    <div class="panel-row">
      <label class="panel-label">{props.binding.description}</label>
      <div class="panel-control">
        <span 
          class="key-binding" 
          onClick={() => props.onEdit(props.binding)}
        >
          {formatKeyForDisplay(props.binding.key, props.osFamily)}
        </span>
      </div>
    </div>
  );
};

export const KeybindingsTab: Component = () => {
  const [editingBinding, setEditingBinding] = createSignal<Binding | null>(null);

  const osFamily = () => settings.ui?.osFamily || "pc";

  const setOsFamily = (os: "pc" | "mac") => {
    updateSettingsStore({
      ui: { ...settings.ui, osFamily: os }
    });
  };

  const getEffectiveKeybinding = (action: string, defaultKey: string) => {
    return (settings.keymaps && settings.keymaps[action]) || defaultKey;
  };

  const coreBindings = () => [
    {
      description: "Execute Code (now)",
      action: "evalNow",
      key: getEffectiveKeybinding("evalNow", "Mod-Enter"),
    },
    {
      description: "Execute Code (quantised)",
      action: "evalQuantised",
      key: getEffectiveKeybinding("evalQuantised", "Alt-Enter"),
    },
    {
      description: "Toggle Help Panel",
      action: "toggleHelp",
      key: getEffectiveKeybinding("toggleHelp", "Alt-h"),
    },
    {
      description: "Toggle Signal Visualization",
      action: "toggleSerialVis",
      key: getEffectiveKeybinding("toggleSerialVis", "Alt-g"),
    },
    {
      description: "Show Documentation for Symbol around cursor",
      action: "showDocumentationForSymbol",
      key: getEffectiveKeybinding("showDocumentationForSymbol", "Alt-f"),
    },
  ];

  const editorBindings = () => [
    {
      description: "Delete from cursor till end of current list",
      action: "slurpForward",
      key: getEffectiveKeybinding("slurpForward", "Ctrl-k"),
    },
    {
      description: "Slurp Forward",
      action: "slurpForward",
      key: getEffectiveKeybinding("slurpForward", "Ctrl-]"),
    },
    {
      description: "Slurp Backward",
      action: "slurpBackward",
      key: getEffectiveKeybinding("slurpBackward", "Ctrl-["),
    },
    {
      description: "Barf Forward",
      action: "barfForward",
      key: getEffectiveKeybinding("barfForward", "Ctrl-'"),
    },
    {
      description: "Barf Backward",
      action: "barfBackward",
      key: getEffectiveKeybinding("barfBackward", "Ctrl-;"),
    },
    {
      description: "Undo",
      action: "undo",
      key: getEffectiveKeybinding("undo", "Mod-z"),
    },
    {
      description: "Redo",
      action: "redo",
      key: getEffectiveKeybinding("redo", "Shift-Mod-z"),
    },
  ];

  const navigationBindings = () => [
    {
      description: "Go to Start of Line",
      action: "goLineStart",
      key: getEffectiveKeybinding("goLineStart", "Home"),
    },
    {
      description: "Go to End of Line",
      action: "goLineEnd",
      key: getEffectiveKeybinding("goLineEnd", "End"),
    },
  ];

  const saveKeybinding = (action: string, key: string) => {
    const updatedKeymaps = {
      ...(settings.keymaps || {}),
      [action]: key,
    };
    updateSettingsStore({ keymaps: updatedKeymaps });
    setEditingBinding(null);
  };

  return (
    <div class="panel-tab-content">
      <div class="panel-section">
        <h3 class="panel-section-title">Platform</h3>
        <div class="panel-row">
          <label class="panel-label">OS</label>
          <div class="panel-control">
            <label>
              <input
                type="radio"
                name="os-family"
                value="pc"
                checked={osFamily() !== "mac"}
                onChange={() => setOsFamily("pc")}
              />
              <span> Linux/Windows</span>
            </label>
            <label style={{ "margin-left": "12px" }}>
              <input
                type="radio"
                name="os-family"
                value="mac"
                checked={osFamily() === "mac"}
                onChange={() => setOsFamily("mac")}
              />
              <span> macOS</span>
            </label>
          </div>
        </div>
      </div>

      <div class="panel-section">
        <h3 class="panel-section-title">Core Actions</h3>
        <For each={coreBindings()}>
          {(binding) => (
            <KeybindingRow 
              binding={binding} 
              osFamily={osFamily()} 
              onEdit={setEditingBinding} 
            />
          )}
        </For>
      </div>

      <div class="panel-section">
        <h3 class="panel-section-title">Editor Actions</h3>
        <For each={editorBindings()}>
          {(binding) => (
            <KeybindingRow 
              binding={binding} 
              osFamily={osFamily()} 
              onEdit={setEditingBinding} 
            />
          )}
        </For>
      </div>

      <div class="panel-section">
        <h3 class="panel-section-title">Navigation</h3>
        <For each={navigationBindings()}>
          {(binding) => (
            <KeybindingRow 
              binding={binding} 
              osFamily={osFamily()} 
              onEdit={setEditingBinding} 
            />
          )}
        </For>
      </div>

      <Show when={editingBinding()}>
        {(binding) => (
          <KeybindingEditModal 
            binding={binding()} 
            onCancel={() => setEditingBinding(null)}
            onSave={(newKey) => saveKeybinding(binding().action, newKey)}
          />
        )}
      </Show>
    </div>
  );
};

const KeybindingEditModal: Component<{
  binding: Binding;
  onCancel: () => void;
  onSave: (newKey: string) => void;
}> = (props) => {
  const [newKey, setNewKey] = createSignal("Press keys...");
  let bindingEl: HTMLDivElement | undefined;
  onMount(() => bindingEl?.focus());

  const handleKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Build the key string
    let keyString = "";
    if (e.ctrlKey) keyString += "Ctrl-";
    if (e.altKey) keyString += "Alt-";
    if (e.shiftKey) keyString += "Shift-";
    if (e.metaKey) keyString += "Meta-";

    // Get the key name
    let key = e.key;
    if (key === " ") key = "Space";
    if (key === "Control" || key === "Alt" || key === "Shift" || key === "Meta") {
      // Don't add modifier keys on their own
      return;
    }

    keyString += key;
    setNewKey(keyString);
  };

  return (
    <>
      <div class="keybinding-overlay" onClick={props.onCancel} />
      <div class="keybinding-modal">
        <div class="keybinding-content">
          <h4>Edit Shortcut for: {props.binding.description}</h4>
          <p>Press the keys you want to use for this action.</p>
          <div class="current-binding">Current: {props.binding.key}</div>
          <div
            class="new-binding"
            tabindex="0"
            onKeyDown={handleKeyDown}
            ref={bindingEl}
          >
            {newKey()}
          </div>
          <div class="keybinding-buttons">
            <button class="panel-button" onClick={props.onCancel}>
              Cancel
            </button>
            <button
              class="panel-button primary"
              disabled={newKey() === "Press keys..."}
              onClick={() => props.onSave(newKey())}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
