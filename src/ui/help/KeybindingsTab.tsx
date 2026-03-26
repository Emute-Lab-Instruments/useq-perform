import { Component, For } from "solid-js";
import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { actions, type ActionCategory } from "../../lib/keybindings/actions";
import { defaultKeyBindings } from "../../lib/keybindings/defaults";

interface Binding {
  description: string;
  key: string;
}

interface BindingSection {
  title: string;
  bindings: Binding[];
}

// Categories to display and their display names, in order.
const categoryDisplay: { category: ActionCategory; title: string }[] = [
  { category: "core", title: "Evaluation" },
  { category: "ui", title: "Panels" },
  { category: "editor", title: "Editor" },
  { category: "structure", title: "Structure" },
  { category: "probe", title: "Probe" },
  { category: "navigation", title: "Navigation" },
];

const displayCategories = new Set(categoryDisplay.map((c) => c.category));

/**
 * Build sections from the action registry and default bindings.
 * Skips bindings with `when` clauses (internal/contextual bindings).
 */
function buildSections(): BindingSection[] {
  // Group bindings by category
  const grouped = new Map<ActionCategory, Binding[]>();

  for (const binding of defaultKeyBindings) {
    // Skip contextual bindings (picker, backspace gate, etc.)
    if (binding.when) continue;

    const actionDef = actions[binding.action];
    if (!actionDef) continue;

    const cat = actionDef.category;
    if (!displayCategories.has(cat)) continue;

    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push({
      description: actionDef.description,
      key: binding.key,
    });
  }

  return categoryDisplay
    .filter((c) => grouped.has(c.category))
    .map((c) => ({
      title: c.title,
      bindings: grouped.get(c.category)!,
    }));
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

  const sections = buildSections();

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

      <For each={sections}>
        {(section) => (
          <div class="panel-section">
            <h3 class="panel-section-title">{section.title}</h3>
            <For each={section.bindings}>
              {(binding) => (
                <KeybindingRow
                  binding={binding}
                  osFamily={osFamily()}
                />
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
};
