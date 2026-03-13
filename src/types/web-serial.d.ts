/**
 * Minimal Web Serial API type declarations.
 *
 * The Web Serial API is a browser-only API not included in the standard
 * TypeScript DOM lib. These declarations cover the surface used by
 * src/legacy/io/serialComms.ts so the file can be type-checked without
 * @ts-nocheck.
 */

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

interface SerialPortRequestOptions {
  filters?: SerialPortInfo[];
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
  addEventListener(type: "connect" | "disconnect", listener: EventListenerOrEventListenerObject): void;
}

interface Navigator {
  readonly serial: Serial;
}
