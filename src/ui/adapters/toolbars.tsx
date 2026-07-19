/**
 * Toolbar adapters - mount functions for toolbars.
 *
 * Uses createSolidAdapter for mount lifecycle.
 */
import { createSignal, onMount, onCleanup } from "solid-js";
import { Effect } from "effect";
import { TransportToolbar, type TransportToolbarProps } from "../TransportToolbar";
import { MainToolbar, type ConnectionState } from "../MainToolbar";
import { OnboardingBanner } from "../OnboardingBanner";
import { EngineIndicator } from "../../audio/engineIndicator";
import { createSolidAdapter } from "./createSolidAdapter";
import { adjustFontSize, loadCode, saveCode } from "../../effects/editor";
import {
  animateConnect as animateConnectChannel,
  codeEvaluated as codeEvaluatedChannel,
} from "../../contracts/runtimeChannels";
import {
  engineStateChanged,
  type EngineStateSnapshot,
} from "../../contracts/synthesisChannels";
import { getActiveSynthesisService } from "../../runtime/activeSynthesisService";
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
import { visStore } from "../../utils/visualisationStore";

const TRANSPORT_ROOT_ID = "panel-top-toolbar-root";
const MAIN_ROOT_ID = "panel-toolbar-root";

function ensureTransportRoot(): HTMLElement {
  const existing = document.getElementById(TRANSPORT_ROOT_ID);
  if (existing) return existing;

  const oldToolbar = document.getElementById("panel-top-toolbar");
  const el = document.createElement("div");
  el.id = TRANSPORT_ROOT_ID;

  if (oldToolbar) {
    oldToolbar.replaceWith(el);
  } else {
    document.body.prepend(el);
  }

  return el;
}

function ensureMainRoot(): HTMLElement {
  const existing = document.getElementById(MAIN_ROOT_ID);
  if (existing) return existing;

  const oldToolbar = document.getElementById("panel-toolbar");
  const el = document.createElement("div");
  el.id = MAIN_ROOT_ID;

  if (oldToolbar) {
    oldToolbar.replaceWith(el);
  } else {
    document.body.appendChild(el);
  }

  return el;
}

/** Wrapper that reads orchestrator state and passes it as props. */
function ConnectedTransportToolbar() {
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
      progress={visStore.bar}
      bpm={bpm()}
      onPlay={() => send({ type: "PLAY" })}
      onPause={() => send({ type: "PAUSE" })}
      onStop={() => send({ type: "STOP" })}
      onRewind={() => send({ type: "REWIND" })}
      onClear={() => send({ type: "CLEAR" })}
    />
  );
}

const transportAdapter = createSolidAdapter({
  containerId: TRANSPORT_ROOT_ID,
  ensureRoot: ensureTransportRoot,
  Component: () => <ConnectedTransportToolbar />,
});

function deriveConnectionState(snapshot: ReturnType<typeof getRuntimeServiceSnapshot>): ConnectionState {
  const { connectionMode, transportMode } = snapshot.session;
  if (connectionMode === "browser") return "wasm";
  if (connectionMode === "hardware" && transportMode === "both") return "both";
  if (connectionMode === "hardware") return "hardware";
  return "none";
}

function WiredMainToolbar() {
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

const mainAdapter = createSolidAdapter({
  containerId: MAIN_ROOT_ID,
  ensureRoot: ensureMainRoot,
  Component: () => <WiredMainToolbar />,
});

/**
 * Mount the transport toolbar.
 * Replaces the existing #panel-top-toolbar element if present.
 * In non-browser environments, this is a no-op.
 */
export function mountTransportToolbar(root?: HTMLElement): void {
  transportAdapter.mount(root);
}

/**
 * Mount the main toolbar.
 * Replaces the existing #panel-toolbar element if present.
 * In non-browser environments, this is a no-op.
 */
export function mountMainToolbar(root?: HTMLElement): void {
  mainAdapter.mount(root);
}

// ── Onboarding Banner ───────────────────────────────────────────────

const ONBOARDING_ROOT_ID = "onboarding-banner-root";

const onboardingAdapter = createSolidAdapter({
  containerId: ONBOARDING_ROOT_ID,
  Component: () => <OnboardingBanner />,
});

/**
 * Mount the onboarding banner.
 * Renders a dismissible inline banner near the Connect button area.
 */
export function mountOnboardingBanner(root?: HTMLElement): void {
  onboardingAdapter.mount(root);
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

const ENGINE_INDICATOR_ROOT_ID = "engine-indicator-root";

function ensureEngineIndicatorRoot(): HTMLElement {
  const existing = document.getElementById(ENGINE_INDICATOR_ROOT_ID);
  if (existing) return existing;
  const el = document.createElement("div");
  el.id = ENGINE_INDICATOR_ROOT_ID;
  // Mount inside the transport toolbar area when it exists so the
  // indicator sits visually with the transport-family controls.
  const transport = document.getElementById(TRANSPORT_ROOT_ID);
  if (transport) {
    transport.appendChild(el);
  } else {
    document.body.prepend(el);
  }
  return el;
}

const INITIAL_ENGINE_SNAPSHOT: EngineStateSnapshot = Object.freeze({
  state: "off",
  reasonKey: null,
  reasonMessage: null,
  transitionCount: 0,
  transitionedAt: 0,
});

function WiredEngineIndicator() {
  const [snapshot, setSnapshot] = createSignal<EngineStateSnapshot>(
    INITIAL_ENGINE_SNAPSHOT,
  );

  onMount(() => {
    const unsub = engineStateChanged.subscribe((next) => {
      setSnapshot(next);
    });
    onCleanup(() => {
      unsub();
    });
  });

  const onResume = () => {
    // VAL-ENGINE-018: clicking the suspended indicator is a real user
    // pointer interaction. The browser honours it for AudioContext
    // activation. The synthesis service owns the actual resume call so
    // there is no second activation surface here.
    const service = getActiveSynthesisService();
    if (service === null) return;
    void service.resumeOnUserActivation();
  };

  return <EngineIndicator state={snapshot()} onResume={onResume} />;
}

const engineIndicatorAdapter = createSolidAdapter({
  containerId: ENGINE_INDICATOR_ROOT_ID,
  ensureRoot: ensureEngineIndicatorRoot,
  Component: () => <WiredEngineIndicator />,
});

/**
 * Mount the synthesis engine indicator.
 *
 * The indicator lives inside the transport toolbar area so it is part
 * of the transport-indicator family (synthesis.md §6.4). It renders
 * nothing when audio capability is absent; the capability diagnostic
 * flows through the regular compiler diagnostic channel.
 */
export function mountEngineIndicator(root?: HTMLElement): void {
  engineIndicatorAdapter.mount(root);
}
