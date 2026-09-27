/**
 * Wired toolbar components owned by the application Solid root.
 */
import { createSignal, onMount, onCleanup } from "solid-js";
import {
  TransportToolbar,
  type TransportAction,
  type TransportToolbarProps,
} from "../TransportToolbar";
import { MainToolbar, type ConnectionState, type MainToolbarAction } from "../MainToolbar";
import { OnboardingBanner } from "../OnboardingBanner";
import { EngineIndicator } from "../../audio/engineIndicator";
import { editor } from "../../lib/editorStore";
import { adjustFontSize, loadCode, saveCode } from "../../effects/editor";
import {
  animateConnect as animateConnectChannel,
  codeEvaluated as codeEvaluatedChannel,
} from "../../contracts/runtimeChannels";
import {
  engineStateChanged,
  engineStateStore,
  type EngineStateSnapshot,
} from "../../contracts/synthesisChannels";
import { getActiveSynthesisService } from "../../runtime/activeSynthesisService";
import { createEngineIndicatorResumeHandler } from "./engineIndicatorRecovery";
import {
  getRuntimeServiceSnapshot,
  subscribeRuntimeService,
  toggleRuntimeConnection,
} from "../../runtime/runtimeService";
import { toggleChromePanel } from "./panels";
import { toggleVisualisationPanel } from "./visualisationPanel";
import { getTransportOrchestrator } from "../../effects/transportOrchestrator";
import { getActiveWasmRuntimePort } from "../../runtime/activeWasmRuntimePort";
import { useActorSignal } from "../../lib/useActorSignal";
import { visualisationSession } from "../../effects/visualisationSession";
import { dispatchRuntimeCodeEvaluation } from "../../runtime/runtimeCodeEvaluation";
import { resolver } from "../../editors/keymaps";
import type { ActionId } from "../../lib/keybindings/actions";
import { isMac } from "../../lib/keybindings/osReserved";
import { formatBpm } from "../toolbar/BpmControl";
import { resolveToolbarShortcuts } from "../toolbar/shortcutLabels";

// ── Toolbar shortcuts (transport.md §1.7.2) ─────────────────────────
//
// Toolbar buttons that correspond to an action-registry action show that
// action's live binding in their tooltip. The registry has no transport,
// file, font-size, settings or connect actions yet, so only these map.
const MAIN_TOOLBAR_ACTIONS: Partial<Record<MainToolbarAction, ActionId>> = {
  graph: "panel.vis",
  help: "panel.help",
};
const TRANSPORT_TOOLBAR_ACTIONS: Partial<Record<TransportAction, ActionId>> = {};

function lookupLiveBinding(action: ActionId): string | undefined {
  return resolver.resolved().get(action)?.key;
}

/**
 * Read a numeric runtime cell from the active WASM port without publishing a
 * user-visible evaluation. Null when WASM is unavailable or the value is not
 * a finite number.
 */
async function readRuntimeNumber(name: string): Promise<number | null> {
  try {
    const text = await getActiveWasmRuntimePort().evalCodeSilently(name);
    if (text === null) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Wrapper that reads orchestrator state and passes it as props. */
export function ConnectedTransportToolbar() {
  const orchestrator = getTransportOrchestrator();
  const { state, send } = useActorSignal(orchestrator.actor);
  const [bpm, setBpm] = createSignal<number | null>(null);
  const [beatsPerBar, setBeatsPerBar] = createSignal<number | null>(null);
  const [shortcuts, setShortcuts] = createSignal<Partial<Record<TransportAction, string>>>({});

  // BPM and beats-per-bar are runtime cells. Refresh event-driven: on mount,
  // after every evaluation (including our own set-bpm commit, which the WASM
  // port publishes on `codeEvaluated`), and whenever the runtime session
  // changes (e.g. the WASM Worker finishes its readiness handshake).
  let alive = true;
  let refreshSeq = 0;
  const refreshTiming = async () => {
    const seq = ++refreshSeq;
    const [nextBpm, nextBeats] = await Promise.all([
      readRuntimeNumber("bpm"),
      readRuntimeNumber("beats-per-bar"),
    ]);
    // Drop stale responses that resolve after a newer refresh started.
    if (!alive || seq !== refreshSeq) return;
    setBpm(nextBpm);
    setBeatsPerBar(nextBeats);
  };

  // transport.md §1.7.3: commit through the shared runtime eval fan-out so
  // hardware (with the immediate `@` marker) and WASM both receive the form.
  const commitBpm = async (value: number) => {
    setBpm(value); // optimistic; the refresh below reconciles
    const form = `(set-bpm ${formatBpm(value)})`;
    try {
      await dispatchRuntimeCodeEvaluation({ code: `@${form}`, wasmCode: form });
    } finally {
      if (alive) void refreshTiming();
    }
  };

  onMount(() => {
    void refreshTiming();
    setShortcuts(resolveToolbarShortcuts(TRANSPORT_TOOLBAR_ACTIONS, lookupLiveBinding, isMac()));
    const unsubEval = codeEvaluatedChannel.subscribe(() => {
      void refreshTiming();
    });
    const unsubSession = subscribeRuntimeService(() => {
      void refreshTiming();
    });
    onCleanup(() => {
      alive = false;
      unsubEval();
      unsubSession();
    });
  });

  return (
    <TransportToolbar
      state={state().value as TransportToolbarProps["state"]}
      mode={state().context.mode as TransportToolbarProps["mode"]}
      progress={visualisationSession.state.bar}
      bpm={bpm()}
      beatsPerBar={beatsPerBar()}
      onBpmCommit={(value) => void commitBpm(value)}
      shortcuts={shortcuts()}
      onPlay={() => send({ type: "PLAY" })}
      onPause={() => send({ type: "PAUSE" })}
      onStop={() => send({ type: "STOP" })}
      onRewind={() => send({ type: "REWIND" })}
      onClear={() => send({ type: "CLEAR" })}
    >
      <div id="engine-indicator-root">
        <WiredEngineIndicator />
      </div>
    </TransportToolbar>
  );
}

function deriveConnectionState(snapshot: ReturnType<typeof getRuntimeServiceSnapshot>): ConnectionState {
  const { connectionMode, transportMode } = snapshot.session;
  if (connectionMode === "browser") return "wasm";
  if (connectionMode === "hardware" && transportMode === "both") return "both";
  if (connectionMode === "hardware") return "hardware";
  return "none";
}

export function WiredMainToolbar() {
  const [connectionState, setConnectionState] = createSignal<ConnectionState>(
    deriveConnectionState(getRuntimeServiceSnapshot())
  );
  const [shortcuts, setShortcuts] = createSignal<Partial<Record<MainToolbarAction, string>>>({});

  // Adapter owns the channel subscription; child just registers a callback.
  let animateCallback: (() => void) | undefined;

  onMount(() => {
    setShortcuts(resolveToolbarShortcuts(MAIN_TOOLBAR_ACTIONS, lookupLiveBinding, isMac()));
    const unsubRuntimeService = subscribeRuntimeService((nextState) => {
      setConnectionState(deriveConnectionState(nextState));
    });
    const unsubAnimateConnect = animateConnectChannel.subscribe(() => {
      animateCallback?.();
    });
    onCleanup(() => {
      unsubRuntimeService();
      unsubAnimateConnect();
    });
  });

  return (
    <MainToolbar
      connectionState={connectionState()}
      shortcuts={shortcuts()}
      onConnect={() => toggleRuntimeConnection()}
      onToggleGraph={() => toggleVisualisationPanel()}
      onLoadCode={() => loadCode(editor())}
      onSaveCode={() => saveCode(editor())}
      onFontSizeUp={() => adjustFontSize(editor(), 1)}
      onFontSizeDown={() => adjustFontSize(editor(), -1)}
      onSettings={() => toggleChromePanel("settings")}
      onHelp={() => toggleChromePanel("help")}
      onAnimateConnect={(cb) => { animateCallback = cb; }}
    />
  );
}

// ── Onboarding Banner ───────────────────────────────────────────────
export function WiredOnboardingBanner() {
  return <OnboardingBanner />;
}

// ── Engine Indicator ────────────────────────────────────────────────
//
// VAL-ENGINE-020 / VAL-ENGINE-021: the synthesis engine indicator is a
// transport-family member. It subscribes to the typed
// `engineStateChanged` channel and passes the latest snapshot to the
// pure-view `EngineIndicator` component as props. The indicator itself
// is the recovery affordance; there is NO separate permanent Enable
// Sound command. The resume handler routes through the active
// synthesis service accessor so the adapter never imports the service
// singleton directly.

const INITIAL_ENGINE_SNAPSHOT: EngineStateSnapshot = Object.freeze({
  state: "off",
  reasonKey: null,
  reasonMessage: null,
  transitionCount: 0,
  transitionedAt: 0,
});

export function WiredEngineIndicator() {
  const [snapshot, setSnapshot] = createSignal<EngineStateSnapshot>(
    engineStateStore.current ?? INITIAL_ENGINE_SNAPSHOT,
  );

  onMount(() => {
    const unsub = engineStateChanged.subscribe((next) => {
      setSnapshot(next);
    });
    onCleanup(() => {
      unsub();
    });
  });

  const onResume = createEngineIndicatorResumeHandler(snapshot, getActiveSynthesisService);

  return <EngineIndicator state={snapshot()} onResume={onResume} />;
}
