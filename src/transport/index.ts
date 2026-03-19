/**
 * Transport layer barrel re-exports.
 *
 * Consumers should import from here rather than reaching into individual
 * transport modules.
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  CaptureCallback,
  SerialProcessingState,
  PendingRequest,
  JsonResponse,
  WriteJsonRequestOptions,
  SendJsonEvalOptions,
  ProtocolState,
  SerialVars,
  BufferMapFunction,
  TransportContext,
} from "./types.ts";

export {
  SERIAL_READ_MODES,
  MESSAGE_START_MARKER,
  MESSAGE_TYPES,
  EDITOR_VERSION,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
} from "./types.ts";

// ── Connector (port lifecycle) ───────────────────────────────────────
export {
  toggleConnect,
  askForPortAndConnect,
  setConnectedToModule,
  isConnectedToModule,
  announceRuntimeSession,
  setSerialPort,
  getSerialPort,
  connectToSerialPort,
  disconnect,
  checkForSavedPortAndMaybeConnect,
  checkForWebserialSupport,
  enterBootloaderMode,
} from "./connector.ts";

// ── JSON protocol driver ────────────────────────────────────────────
export {
  getProtocolMode,
  isJsonProtocolActive,
  getIoConfig,
  sendStreamConfig,
  sendSerialInputStreamValue,
  handleJsonMessage,
  handleFirmwareInfo,
  resetProtocolState,
  protocolState,
  sendTouSEQ,
} from "./json-protocol.ts";

// ── Stream parser ───────────────────────────────────────────────────
export {
  serialBuffers,
  serialMapFunctions,
  serialReader,
  readingActive,
  serialOutputBufferRouting,
  setSerialOutputBufferRouting,
} from "./stream-parser.ts";
