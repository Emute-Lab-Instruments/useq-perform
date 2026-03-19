import { render } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createActor } from "xstate";
import { Effect } from "effect";

import { TransportToolbar } from "./TransportToolbar";
import {
  startLocalClock,
  stopLocalClock,
  resetLocalClock,
} from "../effects/localClock.ts";
import { transportMachine } from "../machines/transport.machine";
import type { TransportState } from "../machines/transport.machine";
import { applyClockPolicy } from "../effects/transportClock";
import {
  sendRuntimeTransportCommand,
  queryRuntimeHardwareTransportState,
  syncRuntimeWasmTransportState,
} from "../runtime/runtimeService";
import {
  SHARED_TRANSPORT_COMMANDS,
} from "../contracts/useqRuntimeContract";
import {
  extractTransportStateFromMeta,
} from "../effects/transportOrchestrator";
import {
  protocolReady as protocolReadyChannel,
  jsonMeta as jsonMetaChannel,
} from "../contracts/runtimeChannels";
import type { JsonMetaEventDetail } from "../contracts/runtimeEvents";

// ── Shared mock runtime-service state ──────────────────────────

const runtimeServiceState = vi.hoisted(() => {
  const listeners = new Set<(snapshot: any) => void>();
  let snapshot = {
    connected: false,
    protocolMode: "legacy",
    session: {
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: false,
      connectionMode: "none",
      transportMode: "none",
    },
  };

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot: typeof snapshot) => {
      snapshot = nextSnapshot;
      listeners.forEach((listener) => listener(snapshot));
    },
    subscribe: (listener: (nextSnapshot: typeof snapshot) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: () => {
      listeners.clear();
      snapshot = {
        connected: false,
        protocolMode: "legacy",
        session: {
          hasHardwareConnection: false,
          noModuleMode: false,
          wasmEnabled: false,
          connectionMode: "none",
          transportMode: "none",
        },
      };
    },
  };
});

// ── Module mocks ───────────────────────────────────────────────

vi.mock("../runtime/runtimeService", () => ({
  getRuntimeServiceSnapshot: vi.fn(() => runtimeServiceState.getSnapshot()),
  subscribeRuntimeService: vi.fn((listener: (nextSnapshot: unknown) => void) =>
    runtimeServiceState.subscribe(listener as (nextSnapshot: any) => void)
  ),
  sendRuntimeTransportCommand: vi.fn((command: string) => Effect.succeed(command)),
  queryRuntimeHardwareTransportState: vi.fn(() => Effect.succeed(null)),
  syncRuntimeWasmTransportState: vi.fn(() => Effect.succeed(undefined)),
}));

vi.mock("../effects/localClock.ts", () => ({
  startLocalClock: vi.fn(),
  stopLocalClock: vi.fn(),
  resumeLocalClock: vi.fn(),
  resetLocalClock: vi.fn(),
}));

// ── Build a fresh orchestrator per test ─────────────────────────

function buildTestOrchestrator() {
  const machine = transportMachine.provide({
    actions: {
      emitPlay:      () => { Effect.runPromise(sendRuntimeTransportCommand(SHARED_TRANSPORT_COMMANDS.play)); },
      emitPause:     () => { Effect.runPromise(sendRuntimeTransportCommand(SHARED_TRANSPORT_COMMANDS.pause)); },
      emitStop:      () => { Effect.runPromise(sendRuntimeTransportCommand(SHARED_TRANSPORT_COMMANDS.stop)); },
      emitRewind:    () => { Effect.runPromise(sendRuntimeTransportCommand(SHARED_TRANSPORT_COMMANDS.rewind)); },
      emitClear:     () => { Effect.runPromise(sendRuntimeTransportCommand(SHARED_TRANSPORT_COMMANDS.clear)); },
      syncWasmPlay:  () => { Effect.runPromise(syncRuntimeWasmTransportState("playing")).catch(() => undefined); },
      syncWasmPause: () => { Effect.runPromise(syncRuntimeWasmTransportState("paused")).catch(() => undefined); },
      syncWasmStop:  () => { Effect.runPromise(syncRuntimeWasmTransportState("stopped")).catch(() => undefined); },
    },
  });

  const actor = createActor(machine);

  let prevTransportState: TransportState = "playing";
  const actorSub = actor.subscribe((snapshot) => {
    const current = snapshot.value as TransportState;
    if (current === prevTransportState) return;
    const prev = prevTransportState;
    prevTransportState = current;
    applyClockPolicy(current, prev);
  });

  const rs = runtimeServiceState.getSnapshot();
  actor.send({ type: "UPDATE_MODE", mode: rs.session.transportMode });

  const unsubRuntime = runtimeServiceState.subscribe((nextRs: any) => {
    if (nextRs.connected && nextRs.session.hasHardwareConnection) {
      stopLocalClock();
    }
    actor.send({ type: "UPDATE_MODE", mode: nextRs.session.transportMode });
  });

  const unsubProtocolReady = protocolReadyChannel.subscribe(() => {
    Effect.runPromise(queryRuntimeHardwareTransportState()).then((state: TransportState | null) => {
      if (state) actor.send({ type: "SYNC", state });
    });
  });

  const unsubJsonMeta = jsonMetaChannel.subscribe((detail) => {
    const state = extractTransportStateFromMeta(detail);
    if (state) actor.send({ type: "SYNC", state });
  });

  actor.start();

  const dispose = () => {
    actorSub.unsubscribe();
    unsubRuntime();
    unsubProtocolReady();
    unsubJsonMeta();
    actor.stop();
  };

  return {
    actor,
    send: actor.send.bind(actor),
    getSnapshot: () => actor.getSnapshot(),
    subscribe: (cb: any) => actor.subscribe(cb),
    dispose,
  };
}

let currentOrchestrator: ReturnType<typeof buildTestOrchestrator> | null = null;

vi.mock("../effects/transportOrchestrator", async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    extractTransportStateFromMeta: vi.fn(original.extractTransportStateFromMeta),
    getTransportOrchestrator: vi.fn(() => {
      if (!currentOrchestrator) {
        currentOrchestrator = buildTestOrchestrator();
      }
      return currentOrchestrator;
    }),
    disposeTransportOrchestrator: vi.fn(() => {
      currentOrchestrator?.dispose();
      currentOrchestrator = null;
    }),
  };
});

// ── Helpers ────────────────────────────────────────────────────

function setRuntimeSnapshot(mode: "none" | "wasm" | "both", connected = false) {
  if (mode === "both") {
    runtimeServiceState.setSnapshot({
      connected,
      protocolMode: "json",
      session: {
        hasHardwareConnection: true,
        noModuleMode: false,
        wasmEnabled: true,
        connectionMode: "hardware",
        transportMode: "both",
      },
    });
    return;
  }

  if (mode === "wasm") {
    runtimeServiceState.setSnapshot({
      connected,
      protocolMode: "legacy",
      session: {
        hasHardwareConnection: false,
        noModuleMode: false,
        wasmEnabled: true,
        connectionMode: "browser",
        transportMode: "wasm",
      },
    });
    return;
  }

  runtimeServiceState.setSnapshot({
    connected: false,
    protocolMode: "legacy",
    session: {
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: false,
      connectionMode: "none",
      transportMode: "none",
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe("TransportToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeServiceState.reset();
    currentOrchestrator?.dispose();
    currentOrchestrator = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    );
  });

  afterEach(() => {
    currentOrchestrator?.dispose();
    currentOrchestrator = null;
    vi.unstubAllGlobals();
  });

  it("shows all transport buttons as disabled in none mode with stop as primary", () => {
    const { container } = render(() => <TransportToolbar />);

    const playEl = container.querySelector("[title='Play']");
    const pauseEl = container.querySelector("[title='Pause']");
    const stopEl = container.querySelector("[title='Stop']");
    const rewindEl = container.querySelector("[title='Rewind']");
    const clearEl = container.querySelector("[title='Clear']");

    expect(playEl?.classList.contains("disabled")).toBe(true);
    expect(pauseEl?.classList.contains("disabled")).toBe(true);
    expect(stopEl?.classList.contains("disabled")).toBe(true);
    expect(rewindEl?.classList.contains("disabled")).toBe(true);
    expect(clearEl?.classList.contains("disabled")).toBe(true);
    expect(stopEl?.classList.contains("primary")).toBe(true);
  });

  it("shows correct button CSS in playing state when runtime service reports wasm mode", () => {
    setRuntimeSnapshot("wasm");

    const { container } = render(() => <TransportToolbar />);

    const playBtn = container.querySelector("[title='Play']");
    const pauseBtn = container.querySelector("[title='Pause']");
    const stopBtn = container.querySelector("[title='Stop']");

    expect(playBtn?.classList.contains("primary")).toBe(true);
    expect(playBtn?.classList.contains("disabled")).toBe(true);
    expect(pauseBtn?.classList.contains("disabled")).toBe(false);
    expect(stopBtn?.classList.contains("disabled")).toBe(false);
  });

  it("syncs state from jsonMeta channel", async () => {
    setRuntimeSnapshot("wasm");
    vi.mocked(extractTransportStateFromMeta).mockReturnValue("paused");

    const { container } = render(() => <TransportToolbar />);

    jsonMetaChannel.publish({ response: { meta: { transport: "paused" } } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const playBtn = container.querySelector("[title='Play']");
    const pauseBtn = container.querySelector("[title='Pause']");

    expect(pauseBtn?.classList.contains("primary")).toBe(true);
    expect(pauseBtn?.classList.contains("disabled")).toBe(true);
    expect(playBtn?.classList.contains("disabled")).toBe(false);
  });

  it("updates mode when runtime service snapshot changes", async () => {
    const { container } = render(() => <TransportToolbar />);

    const rewindBtn = container.querySelector("[title='Rewind']");
    expect(rewindBtn?.classList.contains("disabled")).toBe(true);

    setRuntimeSnapshot("wasm");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rewindBtn?.classList.contains("disabled")).toBe(false);
  });

  describe("local clock lifecycle (wasm-only mode)", () => {
    beforeEach(() => {
      setRuntimeSnapshot("wasm");
    });

    it("calls startLocalClock in playing state on STOP->PLAY", async () => {
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("stopped");

      const { container } = render(() => <TransportToolbar />);

      jsonMetaChannel.publish({ response: { meta: { transport: "stopped" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      vi.mocked(startLocalClock).mockClear();
      vi.mocked(stopLocalClock).mockClear();
      vi.mocked(resetLocalClock).mockClear();

      const playBtn = container.querySelector("[title='Play']") as HTMLElement;
      playBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(startLocalClock).toHaveBeenCalled();
    });

    it("calls stopLocalClock on PAUSE transition", async () => {
      const { container } = render(() => <TransportToolbar />);

      const pauseBtn = container.querySelector("[title='Pause']") as HTMLElement;
      pauseBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(stopLocalClock).toHaveBeenCalled();
    });

    it("calls stopLocalClock and resetLocalClock on STOP transition", async () => {
      const { container } = render(() => <TransportToolbar />);

      const stopBtn = container.querySelector("[title='Stop']") as HTMLElement;
      stopBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(stopLocalClock).toHaveBeenCalled();
      expect(resetLocalClock).toHaveBeenCalled();
    });
  });

  it("does not throw when events or runtime updates happen after unmount", () => {
    setRuntimeSnapshot("wasm");

    const { unmount } = render(() => <TransportToolbar />);

    unmount();

    expect(() => {
      runtimeServiceState.setSnapshot({
        connected: true,
        protocolMode: "json",
        session: {
          hasHardwareConnection: true,
          noModuleMode: false,
          wasmEnabled: true,
          connectionMode: "hardware",
          transportMode: "both",
        },
      });
      jsonMetaChannel.publish({});
      protocolReadyChannel.publish({ protocolMode: "json" });
    }).not.toThrow();
  });

  describe("acceptance: buttons send transport commands to all active targets", () => {
    beforeEach(() => {
      setRuntimeSnapshot("wasm");
    });

    it("pause button calls sendRuntimeTransportCommand with pause", async () => {
      const { container } = render(() => <TransportToolbar />);

      const pauseBtn = container.querySelector("[title='Pause']") as HTMLElement;
      pauseBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sendRuntimeTransportCommand).toHaveBeenCalledWith(SHARED_TRANSPORT_COMMANDS.pause);
    });

    it("stop button calls sendRuntimeTransportCommand with stop", async () => {
      const { container } = render(() => <TransportToolbar />);

      const stopBtn = container.querySelector("[title='Stop']") as HTMLElement;
      stopBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sendRuntimeTransportCommand).toHaveBeenCalledWith(SHARED_TRANSPORT_COMMANDS.stop);
    });

    it("play button calls sendRuntimeTransportCommand with play from paused state", async () => {
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("paused");

      const { container } = render(() => <TransportToolbar />);

      jsonMetaChannel.publish({ response: { meta: { transport: "paused" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      vi.mocked(sendRuntimeTransportCommand).mockClear();
      const playBtn = container.querySelector("[title='Play']") as HTMLElement;
      playBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sendRuntimeTransportCommand).toHaveBeenCalledWith(SHARED_TRANSPORT_COMMANDS.play);
    });

    it("rewind button calls sendRuntimeTransportCommand with rewind", async () => {
      const { container } = render(() => <TransportToolbar />);

      const rewindBtn = container.querySelector("[title='Rewind']") as HTMLElement;
      rewindBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sendRuntimeTransportCommand).toHaveBeenCalledWith(SHARED_TRANSPORT_COMMANDS.rewind);
    });

    it("clear button calls sendRuntimeTransportCommand with clear", async () => {
      const { container } = render(() => <TransportToolbar />);

      const clearBtn = container.querySelector("[title='Clear']") as HTMLElement;
      clearBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sendRuntimeTransportCommand).toHaveBeenCalledWith(SHARED_TRANSPORT_COMMANDS.clear);
    });
  });

  describe("acceptance: connect to paused module syncs UI and WASM", () => {
    it("protocol-ready queries hardware state and SYNC sets paused + syncs WASM", async () => {
      setRuntimeSnapshot("both", true);
      vi.mocked(queryRuntimeHardwareTransportState).mockReturnValue(
        Effect.succeed("paused" as const)
      );

      const { container } = render(() => <TransportToolbar />);

      protocolReadyChannel.publish({ protocolMode: "json" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(queryRuntimeHardwareTransportState).toHaveBeenCalled();
      expect(syncRuntimeWasmTransportState).toHaveBeenCalledWith("paused");

      const pauseBtn = container.querySelector("[title='Pause']");
      expect(pauseBtn?.classList.contains("primary")).toBe(true);
      expect(pauseBtn?.classList.contains("disabled")).toBe(true);
    });
  });

  describe("acceptance: runtime settings updates flow through the runtime service store", () => {
    it("disabling WASM with no hardware switches to none mode and disables buttons", async () => {
      setRuntimeSnapshot("wasm");

      const { container } = render(() => <TransportToolbar />);

      const rewindBtn = container.querySelector("[title='Rewind']");
      expect(rewindBtn?.classList.contains("disabled")).toBe(false);

      setRuntimeSnapshot("none");
      await new Promise((resolve) => setTimeout(resolve, 0));

      const clearBtn = container.querySelector("[title='Clear']");
      expect(rewindBtn?.classList.contains("disabled")).toBe(true);
      expect(clearBtn?.classList.contains("disabled")).toBe(true);
    });
  });

  describe("acceptance: meta.transport pushes sync WASM via SYNC event", () => {
    it("useq-json-meta with transport:stopped triggers syncRuntimeWasmTransportState(stopped)", async () => {
      setRuntimeSnapshot("both", true);
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("stopped");

      render(() => <TransportToolbar />);

      jsonMetaChannel.publish({ response: { meta: { transport: "stopped" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(syncRuntimeWasmTransportState).toHaveBeenCalledWith("stopped");
    });

    it("useq-json-meta with transport:playing triggers syncRuntimeWasmTransportState(playing)", async () => {
      setRuntimeSnapshot("both", true);
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("paused");

      render(() => <TransportToolbar />);

      jsonMetaChannel.publish({ response: { meta: { transport: "paused" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      vi.mocked(syncRuntimeWasmTransportState).mockClear();
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("playing");

      jsonMetaChannel.publish({ response: { meta: { transport: "playing" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(syncRuntimeWasmTransportState).toHaveBeenCalledWith("playing");
    });
  });
});
