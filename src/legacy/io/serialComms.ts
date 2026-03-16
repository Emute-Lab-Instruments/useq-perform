/**
 * Serial Communication Module — compatibility shim.
 *
 * All transport logic now lives under src/transport/.
 * This file re-exports the public API so existing importers continue to work.
 */

export type { CaptureCallback } from "../../transport/types.ts";

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
} from "../../transport/connector.ts";

export {
  getProtocolMode,
  isJsonProtocolActive,
  getIoConfig,
  sendStreamConfig,
  sendSerialInputStreamValue,
  handleFirmwareInfo,
} from "../../transport/json-protocol.ts";

export { sendTouSEQ } from "../../transport/legacy-text-protocol.ts";

export {
  serialBuffers,
  serialMapFunctions,
  serialReader,
  readingActive,
} from "../../transport/stream-parser.ts";
