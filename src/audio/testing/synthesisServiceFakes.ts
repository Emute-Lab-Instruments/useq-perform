import {
  detectAudioCapabilities,
  type AudioCapabilityProbe,
  type AudioCapabilitySnapshot,
} from "../../contracts/audioCapabilities.ts";
import { createFakeNodeDefModule } from "../nodeDefAdapter.ts";
import type {
  AudioContextContract,
  NodeDefModuleLoader,
  WorkletNodeContract,
} from "../synthesisService.ts";

export function audioCapabilitySnapshot(
  overrides: Partial<AudioCapabilityProbe> = {},
): AudioCapabilitySnapshot {
  return detectAudioCapabilities({
    crossOriginIsolated: true,
    sharedArrayBufferAvailable: true,
    audioWorkletAvailable: true,
    workerAvailable: true,
    sharedWebAssemblyMemoryAvailable: true,
    ...overrides,
  });
}

export interface FakeAudioContext extends AudioContextContract {
  simulateRunning(): void;
  forceClose(): void;
  failNextResume(): void;
  readonly addModuleCalls: readonly string[];
  readonly resumeCallCount: number;
}

export function createFakeAudioContext(options: {
  initialState?: AudioContextContract["state"];
  addModuleResult?: "ok" | "throw";
  sampleRate?: number;
  currentTime?: number;
} = {}): FakeAudioContext {
  let state = options.initialState ?? "suspended";
  let failResume = false;
  let resumeCallCount = 0;
  const addModuleCalls: string[] = [];

  return {
    get state() {
      return state;
    },
    sampleRate: options.sampleRate ?? 48_000,
    currentTime: options.currentTime ?? 0,
    audioWorklet: {
      async addModule(url: string) {
        addModuleCalls.push(url);
        if (options.addModuleResult === "throw") {
          throw new Error("worklet addModule failed");
        }
      },
    },
    destination: { name: "fake-destination" },
    async resume() {
      resumeCallCount += 1;
      if (failResume) {
        failResume = false;
        throw new Error("resume rejected");
      }
      state = "running";
    },
    async suspend() {
      state = "suspended";
    },
    async close() {
      state = "closed";
    },
    simulateRunning() {
      state = "running";
    },
    forceClose() {
      state = "closed";
    },
    failNextResume() {
      failResume = true;
    },
    get addModuleCalls() {
      return addModuleCalls;
    },
    get resumeCallCount() {
      return resumeCallCount;
    },
  };
}

export interface FakeWorkletNode extends WorkletNodeContract {
  readonly postedMessages: readonly unknown[];
  readonly connectCallCount: number;
  readonly disconnectCallCount: number;
  readonly closeCallCount: number;
  onmessageInstallerCount(): number;
  deliverFromWorklet(message: unknown): void;
  messagesOfType<T>(type: string): readonly T[];
}

export function createFakeWorkletNode(options: {
  autoAcknowledgeGraphTransactions?: boolean;
  flattenPreparedDeltas?: boolean;
  onPostMessage?: (message: unknown) => void;
} = {}): FakeWorkletNode {
  const postedMessages: unknown[] = [];
  let connectCallCount = 0;
  let disconnectCallCount = 0;
  let closeCallCount = 0;
  let installerCount = 0;
  let onmessage: ((event: { data: unknown }) => void) | null = null;

  const port: WorkletNodeContract["port"] = {
    postMessage(message: unknown) {
      postedMessages.push(message);
      options.onPostMessage?.(message);

      const transaction = message as {
        type?: string;
        transactionId?: number;
        deltas?: readonly unknown[];
      };
      if (
        options.flattenPreparedDeltas &&
        transaction.type === "prepare-graph" &&
        transaction.deltas
      ) {
        postedMessages.push(...transaction.deltas);
      }

      if (!options.autoAcknowledgeGraphTransactions) return;
      const phase =
        transaction.type === "prepare-graph" ? "prepare" :
        transaction.type === "commit-graph" ? "commit" :
        transaction.type === "activate-graph" ? "activate" : null;
      if (phase && typeof transaction.transactionId === "number") {
        queueMicrotask(() => onmessage?.({
          data: {
            type: "graph-transaction-ack",
            transactionId: transaction.transactionId,
            phase,
            ok: true,
          },
        }));
      }
    },
    get onmessage() {
      return onmessage;
    },
    set onmessage(handler) {
      installerCount += 1;
      onmessage = handler;
    },
    close() {
      closeCallCount += 1;
      onmessage = null;
    },
  };

  return {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    port,
    connect(destination: unknown) {
      connectCallCount += 1;
      return destination;
    },
    disconnect() {
      disconnectCallCount += 1;
    },
    deliverFromWorklet(message: unknown) {
      onmessage?.({ data: message });
    },
    messagesOfType<T>(type: string) {
      return postedMessages.filter(
        (message): message is T =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === type,
      );
    },
    get postedMessages() {
      return postedMessages;
    },
    get connectCallCount() {
      return connectCallCount;
    },
    get disconnectCallCount() {
      return disconnectCallCount;
    },
    get closeCallCount() {
      return closeCallCount;
    },
    onmessageInstallerCount() {
      return installerCount;
    },
  };
}

export interface FakeNodeDefModuleLoader extends NodeDefModuleLoader {
  loadCount(): number;
  loadedNames(): readonly string[];
}

export function createFakeNodeDefModuleLoader(): FakeNodeDefModuleLoader {
  const loadedNames: string[] = [];
  const loader: NodeDefModuleLoader = async (descriptor) => {
    loadedNames.push(descriptor.name);
    return {
      module: createFakeNodeDefModule(descriptor),
      compiledWasm: null,
    };
  };
  return Object.assign(loader, {
    loadCount: () => loadedNames.length,
    loadedNames: () => loadedNames,
  });
}

export interface FakeTelemetryInstaller {
  (snapshot: unknown): void;
  readonly snapshots: readonly unknown[];
  callCount(): number;
  latest(): unknown;
}

export function createFakeTelemetryInstaller(): FakeTelemetryInstaller {
  const snapshots: unknown[] = [];
  const installer = (snapshot: unknown) => {
    snapshots.push(snapshot);
  };
  return Object.assign(installer, {
    snapshots,
    callCount: () => snapshots.length,
    latest: () => snapshots[snapshots.length - 1],
  });
}
