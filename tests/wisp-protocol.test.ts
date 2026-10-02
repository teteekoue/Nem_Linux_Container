import { describe, expect, it } from "vitest";
import { decodeWispFrame } from "../worker/src/wisp-protocol";

function connectFrame(host: string, port: number): Uint8Array {
  const hostname = new TextEncoder().encode(host);
  const frame = new Uint8Array(8 + hostname.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, 1);
  view.setUint32(1, 7, true);
  view.setUint8(5, 1);
  view.setUint16(6, port, true);
  frame.set(hostname, 8);
  return frame;
}

describe("WISP protocol", () => {
  it("décode une demande TCP HTTP/HTTPS", () => {
    expect(decodeWispFrame(connectFrame("dl-cdn.alpinelinux.org", 443))).toEqual({
      type: "connect",
      streamId: 7,
      host: "dl-cdn.alpinelinux.org",
      port: 443,
    });
  });

  it("rejette les destinations autres que les ports HTTP et HTTPS", () => {
    expect(() => decodeWispFrame(connectFrame("example.org", 22))).toThrow(
      "Destination WISP non autorisée",
    );
  });

  it("décode les données et la fermeture de flux", () => {
    const data = new Uint8Array([2, 7, 0, 0, 0, 65, 66]);
    expect(decodeWispFrame(data)).toMatchObject({
      type: "data",
      streamId: 7,
      data: new Uint8Array([65, 66]),
    });
    expect(decodeWispFrame(new Uint8Array([4, 7, 0, 0, 0, 2]))).toEqual({
      type: "close",
      streamId: 7,
      reason: 2,
    });
  });

  it("rejette les trames incomplètes et les types inconnus", () => {
    expect(() => decodeWispFrame(new Uint8Array([1, 0, 0]))).toThrow(
      "Trame WISP trop courte",
    );
    expect(() => decodeWispFrame(new Uint8Array([9, 0, 0, 0, 0]))).toThrow(
      "Type de trame WISP non pris en charge",
    );
  });
});
