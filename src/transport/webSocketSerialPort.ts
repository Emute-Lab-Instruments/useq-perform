/**
 * WebSocketSerialPort — a duck-typed Web Serial `SerialPort` whose byte
 * streams are carried over a loopback WebSocket instead of a USB CDC device.
 *
 * Purpose: let the editor connect to a uSEQ engine running in a *separate
 * native process on the same machine* (e.g. the native VCV Rack plugin's
 * embedded WebSocket bridge) while every downstream module — connector.ts,
 * json-protocol.ts, stream-parser.ts, the visualisation pipeline — keeps
 * treating it as ordinary hardware. The whole stack only touches the
 * `{ open, close, getInfo, readable, writable }` surface (see
 * `src/types/web-serial.d.ts`), so satisfying that surface is sufficient for
 * full transparency.
 *
 * Why a WebSocket and not a virtual serial port: Chromium's serial enumerator
 * only lists real udev tty devices, so userspace PTYs never appear in
 * `navigator.serial`. A loopback WebSocket is the only same-machine channel a
 * plain hosted page can open without an extension, and Chrome exempts
 * `127.0.0.1` from mixed-content blocking, so `ws://127.0.0.1:<port>` works
 * even when the editor is served over HTTPS.
 *
 * Wire format is symmetric with the real device (see docs/specs/wire-protocol.md):
 * bare JSON objects terminated by `\n`, and 11-byte binary STREAM frames
 * beginning with 0x1F. We send each logical message as one WS frame (text for
 * JSON, binary for STREAM frames), but the editor's stream-parser re-buffers
 * across reads, so WS message boundaries need not align with logical frames.
 */

const encoder = new TextEncoder();

/**
 * Synthetic USB identifiers reported by {@link WebSocketSerialPort.getInfo}.
 *
 * `getInfo()` must not return `undefined` ids: connector.ts persists them via
 * `setSerialPort` and matches on them. These are deliberately *not* the real
 * uSEQ RP2040 ids (vendor 0x2e8a) so a user with both real hardware and the
 * virtual bridge can be disambiguated. 0x1209 is the community "pid.codes"
 * open vendor id; 0x5551 is an arbitrary uSEQ-virtual product id.
 */
export const USEQ_VIRTUAL_USB_VENDOR_ID = 0x1209;
export const USEQ_VIRTUAL_USB_PRODUCT_ID = 0x5551;

export interface WebSocketSerialPortOptions {
  /** Full WebSocket URL, e.g. `ws://127.0.0.1:17890`. */
  url: string;
  /** Synthetic vendor id reported by getInfo(). */
  usbVendorId?: number;
  /** Synthetic product id reported by getInfo(). */
  usbProductId?: number;
  /**
   * Invoked when the underlying socket closes (cleanly or on error). The
   * editor never receives a `navigator.serial` "disconnect" event for a
   * WS-backed port, so callers wire this to drive connection-state teardown
   * (see bead useq-perform-0lzs).
   */
  onClose?: (info: { code: number; reason: string; wasClean: boolean }) => void;
}

export class WebSocketSerialPort implements SerialPort {
  private readonly url: string;
  private readonly info: SerialPortInfo;
  private readonly onClose?: WebSocketSerialPortOptions["onClose"];

  private ws: WebSocket | null = null;
  private readableController: ReadableStreamDefaultController<Uint8Array> | null =
    null;
  private streamClosed = false;

  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;

  constructor(options: WebSocketSerialPortOptions) {
    this.url = options.url;
    this.onClose = options.onClose;
    this.info = {
      usbVendorId: options.usbVendorId ?? USEQ_VIRTUAL_USB_VENDOR_ID,
      usbProductId: options.usbProductId ?? USEQ_VIRTUAL_USB_PRODUCT_ID,
    };

    // Eagerly construct the readable so the controller exists before open()
    // connects and inbound frames start arriving.
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.readableController = controller;
      },
      cancel: () => {
        void this.close();
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => this.sendChunk(chunk),
      close: () => {
        void this.close();
      },
      abort: () => {
        void this.close();
      },
    });
  }

  /**
   * Open the connection. `baudRate` is part of the Web Serial contract but is
   * meaningless over a WebSocket and is ignored (the 1200-baud bootloader
   * reopen used for real hardware is a no-op here).
   */
  open(_options: { baudRate: number }): Promise<void> {
    if (this.ws) {
      return Promise.reject(new Error("WebSocketSerialPort already open"));
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        reject(err);
        return;
      }
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onopen = () => {
        settled = true;
        resolve();
      };
      ws.onerror = (event) => {
        if (!settled) {
          settled = true;
          reject(
            new Error(`WebSocketSerialPort failed to connect to ${this.url}`),
          );
        }
        // Post-open errors are reported via the subsequent close event.
        void event;
      };
      ws.onmessage = (event) => this.handleMessage(event.data);
      ws.onclose = (event) => {
        this.closeReadable();
        this.onClose?.({
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
      };
    });
  }

  close(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    this.closeReadable();
    if (ws && ws.readyState <= 1 /* CONNECTING | OPEN */) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    return Promise.resolve();
  }

  getInfo(): SerialPortInfo {
    return { ...this.info };
  }

  // ── internals ────────────────────────────────────────────────────

  private handleMessage(data: unknown): void {
    // Enqueue exactly the received bytes as a fresh, tight, zero-offset
    // Uint8Array. stream-parser.ts wraps `value.buffer` directly (ignoring
    // byteOffset/byteLength), so a view into a larger receive buffer would
    // feed garbage — always copy.
    if (typeof data === "string") {
      this.enqueue(encoder.encode(data));
    } else if (data instanceof ArrayBuffer) {
      this.enqueue(new Uint8Array(data.slice(0)));
    } else if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      this.enqueue(
        new Uint8Array(
          view.buffer.slice(
            view.byteOffset,
            view.byteOffset + view.byteLength,
          ),
        ),
      );
    } else if (typeof Blob !== "undefined" && data instanceof Blob) {
      // Browsers may deliver binary frames as Blob despite binaryType.
      void data.arrayBuffer().then((buf) => this.enqueue(new Uint8Array(buf)));
    }
  }

  private enqueue(bytes: Uint8Array): void {
    if (this.streamClosed || !this.readableController) return;
    if (bytes.byteLength === 0) return;
    try {
      this.readableController.enqueue(bytes);
    } catch {
      // Controller already closed (reader cancelled); ignore.
    }
  }

  private closeReadable(): void {
    if (this.streamClosed) return;
    this.streamClosed = true;
    try {
      this.readableController?.close();
    } catch {
      /* already closed */
    }
  }

  private sendChunk(chunk: Uint8Array): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 /* OPEN */) {
      throw new Error("WebSocketSerialPort is not open");
    }
    ws.send(chunk);
  }
}
