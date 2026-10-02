const ALLOWED_PORTS = new Set([80, 443]);

export interface ConnectFrame {
  type: "connect";
  streamId: number;
  host: string;
  port: number;
}

interface DataFrame {
  type: "data";
  streamId: number;
  data: Uint8Array;
}

interface CloseFrame {
  type: "close";
  streamId: number;
  reason: number;
}

export type WispFrame = ConnectFrame | DataFrame | CloseFrame;

/** Decode one complete WISP frame received in a WebSocket message. */
export function decodeWispFrame(buffer: Uint8Array): WispFrame {
  if (buffer.byteLength < 5) throw new Error("Trame WISP trop courte.");
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const type = view.getUint8(0);
  const streamId = view.getUint32(1, true);

  if (type === 1) {
    if (buffer.byteLength < 9 || view.getUint8(5) !== 1) {
      throw new Error("Requête WISP CONNECT invalide.");
    }
    const port = view.getUint16(6, true);
    const host = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(8));
    if (
      !host ||
      host.length > 253 ||
      /[\u0000-\u0020\u007f/\\]/.test(host) ||
      !ALLOWED_PORTS.has(port)
    ) {
      throw new Error("Destination WISP non autorisée.");
    }
    return { type: "connect", streamId, host, port };
  }

  if (type === 2) return { type: "data", streamId, data: buffer.subarray(5) };

  if (type === 4) {
    if (buffer.byteLength < 6) throw new Error("Trame WISP CLOSE invalide.");
    return { type: "close", streamId, reason: view.getUint8(5) };
  }

  throw new Error(`Type de trame WISP non pris en charge : ${type}.`);
}
