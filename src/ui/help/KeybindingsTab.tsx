import { Component, For } from "solid-js";
import { settings, updateSettingsStore } from "../../utils/settingsStore";

interface Binding {
  description: string;
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
}> = (props) => {
  return (
    <div class="panel-row">
      <label class="panel-label">{props.binding.description}</label>
      <div class="panel-control">
        <span class="key-binding key-binding--static">
          {formatKeyForDisplay(props.binding.key, props.osFamily)}
        </span>
      </div>
    </div>
  );
};

export const KeybindingsTab: Component = () => {
  const osFamily = () => settings.ui?.osFamily || "pc";

  const setOsFamily = (os: "pc" | "mac") => {
    updateSettingsStore({
      ui: { ...settings.ui, osFamily: os }
    });
  };

  const coreBindings = () => [
    {
      description: "Execute Code (now)",
      key: "Mod-Enter",
    },
    {
      description: "Execute Code (quantised)",
      key: "Alt-Enter",
    },
    {
      description: "Toggle Help Panel",
      key: "Alt-h",
    },
    {
      description: "Toggle Signal Visualization",
      key: "Alt-g",
    },
    {
      description: "Show Documentation for Symbol around cursor",
      key: "Alt-f",
    },
  ];

  const editorBindings = () => [
    {
      description: "Delete from cursor till end of current list",
      key: "Ctrl-k",
    },
    {
      description: "Slurp Forward",
      key: "Ctrl-]",
    },
    {
      description: "Slurp Backward",
      key: "Ctrl-[",
    },
    {
      description: "Barf Forward",
      key: "Ctrl-'",
    },
    {
      description: "Barf Backward",
      key: "Ctrl-;",
    },
    {
      description: "Undo",
      key: "Mod-z",
    },
    {
      description: "Redo",
      key: "Shift-Mod-z",
    },
  ];

  const navigationBindings = () => [
    {
      description: "Go to Start of Line",
      key: "Home",
    },
    {
      description: "Go to End of Line",
      key: "End",
    },
  ];

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
        <p class="panel-help-copy">
          Shortcuts are fixed in this build. This tab reflects the live defaults and only
          changes modifier names for your platform.
        </p>
      </div>

      <div class="panel-section">
        <h3 class="panel-section-title">Core Actions</h3>
        <For each={coreBindings()}>
          {(binding) => (
            <KeybindingRow 
              binding={binding} 
              osFamily={osFamily()} 
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
            />
          )}
        </For>
      </div>
    </div>
  );
};
