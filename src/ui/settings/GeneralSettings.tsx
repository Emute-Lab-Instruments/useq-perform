import { createSignal, onCleanup, onMount } from "solid-js";
import {
  resetSettings,
} from "../../runtime/runtimeService.ts";
import { settings as globalSettings, requestSettingsUpdate } from "../../utils/settingsStore.ts";
import { PersonalSettings } from "./PersonalSettings";
import { EditorSettings } from "./EditorSettings";
import { EvalResultsSettings } from "./EvalResultsSettings";
import { StorageSettings } from "./StorageSettings";
import { UISettings } from "./UISettings";
import { VisualisationSettings } from "./VisualisationSettings";
import { ConfigurationManagement, handleSettingsExport, handleSettingsImport } from "./ConfigurationManagement";
import { ConsoleSettings } from "./ConsoleSettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { KeybindingsSettings } from "./KeybindingsSettings";
import { RuntimeDiagnosticsSettings } from "./RuntimeDiagnosticsSettings";
import { HardwareSettings } from "./HardwareSettings";
import { MidiSettings } from "./MidiSettings";
import type { MidiInputDescriptor, MidiPermissionState } from "../../contracts/midi.ts";
import type { MidiInputService } from "../../effects/midiInput.ts";
import { midiInput as productionMidiInput } from "../../effects/liveEditMidiRuntime.ts";
import type { AppSettings } from "../../lib/appSettings.ts";
import { confirmDialog, type ConfirmDialogFn } from "../adapters/modal";

export interface GeneralSettingsProps {
  /** Current settings object. Defaults to the global reactive settings store. */
  settings?: AppSettings;
  /** Callback to apply a partial settings update. Defaults to requestSettingsUpdate. */
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
  /** Callback to reset all settings. Defaults to runtimeService.resetSettings. */
  onResetSettings?: () => void;
  /** Callback invoked after reset or import when a page reload is needed. Defaults to window.location.reload. */
  onReload?: () => void;
  /** In-app confirmation dialog. Defaults to the imperative modal adapter's confirmDialog. */
  confirm?: ConfirmDialogFn;
  /**
   * Web MIDI input service backing the MIDI settings section (live-edit.md
   * §5.6). Defaults to the production singleton from liveEditMidiRuntime;
   * tests and stories inject a fake.
   */
  midiInput?: MidiInputService;
}

/**
 * Bridge the live-edit MIDI input service into the pure MidiSettings section
 * (live-edit.md §5.6). The service exposes callback subscriptions rather than
 * Solid signals, so this mirrors the liveEditPanel adapter: hold signals,
 * subscribe on mount, clean up on unmount.
 *
 * Authority note: the live-edit panel header keeps its inline permission
 * affordance because the learn flow needs a just-in-time gate next to the
 * learn buttons (§5.8.2). This section is the authority for the full
 * permission state and per-device enable/disable management. Both surfaces
 * read and drive the same MidiInputService singleton, so there is one source
 * of truth.
 */
function MidiSettingsSection(props: { midiInput: MidiInputService }) {
  const [permission, setPermission] = createSignal<MidiPermissionState>(
    props.midiInput.permission,
  );
  const [inputs, setInputs] = createSignal<MidiInputDescriptor[]>(
    [...props.midiInput.inputs],
  );

  onMount(() => {
    const unsubscribePermission = props.midiInput.onPermissionChanged(setPermission);
    const unsubscribeDevices = props.midiInput.onDevicesChanged((next) => setInputs([...next]));
    onCleanup(unsubscribePermission);
    onCleanup(unsubscribeDevices);
  });

  return (
    <MidiSettings
      permission={permission()}
      inputs={inputs()}
      onRequestPermission={() => void props.midiInput.requestAccess()}
      onToggleInput={(id, enabled) => props.midiInput.setInputEnabled(id, enabled)}
    />
  );
}

export function GeneralSettings(props: GeneralSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? requestSettingsUpdate)(patch);
  const reload = () => (props.onReload ?? (() => window.location.reload()))();

  const handleReset = async () => {
    const ok = await (props.confirm ?? confirmDialog)({
      title: "Reset all settings?",
      message: "All settings return to their default values. The page will reload.",
      confirmLabel: "Reset settings",
      destructive: true,
    });
    if (ok) {
      (props.onResetSettings ?? resetSettings)();
      reload();
    }
  };

  return (
    <div class="panel-tab-content">
      <PersonalSettings settings={s()} onUpdateSettings={update} />
      <EditorSettings settings={s()} onUpdateSettings={update} />
      <ConsoleSettings settings={s()} onUpdateSettings={update} />
      <EvalResultsSettings settings={s()} onUpdateSettings={update} />
      <StorageSettings settings={s()} onUpdateSettings={update} />
      <UISettings settings={s()} onUpdateSettings={update} />
      <KeybindingsSettings settings={s()} onUpdateSettings={update} />
      <VisualisationSettings settings={s()} onUpdateSettings={update} />
      {/* live-edit.md §5.6 — Web MIDI input devices (permission + per-device enable). */}
      <MidiSettingsSection midiInput={props.midiInput ?? productionMidiInput} />
      {/* calibration.md §2.1 — hardware entry point (not settings-driven). */}
      <HardwareSettings />
      <AdvancedSettings settings={s()} onUpdateSettings={update} />
      <RuntimeDiagnosticsSettings />
      <ConfigurationManagement onReload={reload} confirm={props.confirm} />

      <div class="settings-footer">
        <div class="settings-footer-group">
          <button class="panel-button" onClick={handleSettingsExport()}>
            Export settings
          </button>
          <button class="panel-button" onClick={handleSettingsImport(reload, { confirm: props.confirm })}>
            Import settings
          </button>
        </div>
        <button class="panel-button reset" onClick={handleReset}>
          Reset all settings
        </button>
      </div>
    </div>
  );
}
