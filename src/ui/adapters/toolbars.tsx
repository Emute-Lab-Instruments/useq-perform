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
import { createSolidAdapter } from "./createSolidAdapter";
import { adjustFontSize, loadCode, saveCode } from "../../effects/editor";
import {
  animateConnect as animateConnectChannel,
  codeEvaluated as codeEvaluatedChannel,
} from "../../contracts/runtimeChannels";
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
