/**
 * Wired toolbar components owned by the application Solid root.
 */
import { createSignal, onMount, onCleanup } from "solid-js";
import { Effect } from "effect";
import { TransportToolbar, type TransportToolbarProps } from "../TransportToolbar";
import { MainToolbar, type ConnectionState } from "../MainToolbar";
import { OnboardingBanner } from "../OnboardingBanner";
import { EngineIndicator } from "../../audio/engineIndicator";
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

/** Wrapper that reads orchestrator state and passes it as props. */
export function ConnectedTransportToolbar() {
  const orchestrator = getTransportOrchestrator();
  const { state, send } = useActorSignal(orchestrator.actor as any);
  const [bpm, setBpm] = createSignal<number | null>(null);

  // BPM is a runtime cell; refresh on mount, after every code eval, and on
  // a slow timer to catch the post-load value when the worker comes up
  // before the user has evaluated anything.
  let alive = true;
  const refreshBpm = async () => {
    try {
      const text = await getActiveWasmRuntimePort().evalCodeSilently("bpm");
      if (!alive) return;
      if (text === null) {
        setBpm(null);
        return;
      }
      const parsed = Number(text);
      setBpm(Number.isFinite(parsed) ? parsed : null);
    } catch {
      if (alive) setBpm(null);
    }
  };

  onMount(() => {
    void refreshBpm();
    const unsub = codeEvaluatedChannel.subscribe(() => {
      void refreshBpm();
    });
    // Slow heartbeat so the box appears once the worker finishes loading
    // even if no code has been evaluated yet.
    const timer = window.setInterval(() => {
      if (bpm() === null) void refreshBpm();
    }, 1000);
    onCleanup(() => {
      alive = false;
      unsub();
      window.clearInterval(timer);
    });
  });

  return (
    <TransportToolbar
      state={state().value as TransportToolbarProps["state"]}
      mode={state().context.mode as TransportToolbarProps["mode"]}
      progress={visualisationSession.state.bar}
      bpm={bpm()}
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

  // Adapter owns the channel subscription; child just registers a callback.
  let animateCallback: (() => void) | undefined;

  onMount(() => {
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
      onConnect={() => toggleRuntimeConnection()}
      onToggleGraph={() => toggleVisualisationPanel()}
      onLoadCode={() => Effect.runPromise(loadCode())}
      onSaveCode={() => Effect.runPromise(saveCode())}
      onFontSizeUp={() => Effect.runPromise(adjustFontSize(1))}
      onFontSizeDown={() => Effect.runPromise(adjustFontSize(-1))}
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
