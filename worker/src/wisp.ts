import { connect } from "cloudflare:sockets";
import { decodeWispFrame, type ConnectFrame, type WispFrame } from "./wisp-protocol";

const MAX_STREAMS = 50;
const MAX_QUEUED_BYTES = 64 * 1024;
const INITIAL_WINDOW = 64 * 1024;
interface TcpStream {
  socket?: ReturnType<typeof connect>;
  writer?: WritableStreamDefaultWriter<Uint8Array>;
  queued: Uint8Array[];
  queuedBytes: number;
  writeChain: Promise<void>;
  closed: boolean;
}

function windowFrame(streamId: number, size: number): Uint8Array {
  const frame = new Uint8Array(9);
  const view = new DataView(frame.buffer);
  view.setUint8(0, 3);
  view.setUint32(1, streamId, true);
  view.setUint32(5, size, true);
  return frame;
}

function dataFrame(streamId: number, data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + data.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, 2);
  view.setUint32(1, streamId, true);
  frame.set(data, 5);
  return frame;
}

function closeFrame(streamId: number, reason: number): Uint8Array {
  const frame = new Uint8Array(6);
  const view = new DataView(frame.buffer);
  view.setUint8(0, 4);
  view.setUint32(1, streamId, true);
  view.setUint8(5, reason);
  return frame;
}

/** Bridge v86's WISP TCP streams to Cloudflare outbound TCP sockets. */
export function acceptWispSocket(webSocket: WebSocket): void {
  webSocket.accept();
  const streams = new Map<number, TcpStream>();
  let openedStreams = 0;
  let closed = false;
  let messageChain = Promise.resolve();

  const send = (frame: Uint8Array): void => {
    if (webSocket.readyState === WebSocket.OPEN) webSocket.send(frame);
  };

  const closeStream = (streamId: number, reason: number, notify = true): void => {
    const stream = streams.get(streamId);
    if (!stream || stream.closed) return;
    stream.closed = true;
    streams.delete(streamId);
    if (notify) send(closeFrame(streamId, reason));
    void stream.writer?.close().catch(() => undefined);
    stream.socket?.close();
  };

  const pumpTcp = async (streamId: number, stream: TcpStream): Promise<void> => {
    const socket = stream.socket;
    if (!socket) return;
    const reader = socket.readable.getReader();
    try {
      while (!stream.closed) {
        const result = await reader.read();
        if (result.done) break;
        if (result.value.byteLength > 0) send(dataFrame(streamId, result.value));
      }
      closeStream(streamId, 2);
    } catch {
      closeStream(streamId, 1);
    } finally {
      reader.releaseLock();
    }
  };

  const openStream = async (frame: ConnectFrame): Promise<void> => {
    if (
      frame.streamId === 0 ||
      streams.has(frame.streamId) ||
      openedStreams >= MAX_STREAMS
    ) {
      send(closeFrame(frame.streamId, 1));
      return;
    }

    openedStreams += 1;
    const stream: TcpStream = {
      queued: [],
      queuedBytes: 0,
      writeChain: Promise.resolve(),
      closed: false,
    };
    streams.set(frame.streamId, stream);

    try {
      stream.socket = connect({ hostname: frame.host, port: frame.port });
      await stream.socket.opened;
      if (stream.closed) return;

      stream.writer = stream.socket.writable.getWriter();
      send(windowFrame(frame.streamId, INITIAL_WINDOW));
      void pumpTcp(frame.streamId, stream);
      for (const data of stream.queued.splice(0)) {
        stream.queuedBytes -= data.byteLength;
        await stream.writer.write(data);
        send(windowFrame(frame.streamId, data.byteLength));
      }
    } catch {
      closeStream(frame.streamId, 1);
    }
  };

  const writeToTcp = (streamId: number, stream: TcpStream, data: Uint8Array): void => {
    if (stream.closed || data.byteLength === 0) return;
    if (!stream.writer) {
      if (stream.queuedBytes + data.byteLength > MAX_QUEUED_BYTES) {
        closeStream(streamId, 1);
        return;
      }
      stream.queued.push(data.slice());
      stream.queuedBytes += data.byteLength;
      return;
    }
    stream.writeChain = stream.writeChain.then(async () => {
      if (stream.closed || !stream.writer) return;
      await stream.writer.write(data);
      send(windowFrame(streamId, data.byteLength));
    });
    void stream.writeChain.catch(() => closeStream(streamId, 1));
  };

  webSocket.addEventListener("message", (event: MessageEvent) => {
    messageChain = messageChain.then(async () => {
      let buffer: ArrayBuffer;
      if (event.data instanceof ArrayBuffer) {
        buffer = event.data;
      } else if (event.data instanceof Blob) {
        buffer = await event.data.arrayBuffer();
      } else if (ArrayBuffer.isView(event.data)) {
        buffer = event.data.buffer.slice(
          event.data.byteOffset,
          event.data.byteOffset + event.data.byteLength,
        ) as ArrayBuffer;
      } else {
        webSocket.close(1003, "Binary WISP frames required");
        return;
      }

      let frame: WispFrame;
      try {
        frame = decodeWispFrame(new Uint8Array(buffer));
      } catch {
        webSocket.close(1002, "Invalid WISP frame");
        return;
      }

      if (frame.type === "connect") {
        void openStream(frame);
      } else if (frame.type === "data") {
        const stream = streams.get(frame.streamId);
        if (!stream) {
          webSocket.close(1002, "Unknown WISP stream");
          return;
        }
        writeToTcp(frame.streamId, stream, frame.data);
      } else {
        closeStream(frame.streamId, frame.reason, false);
      }
    }).catch(() => webSocket.close(1011, "WISP relay error"));
  });

  const closeAll = (): void => {
    if (closed) return;
    closed = true;
    for (const streamId of streams.keys()) closeStream(streamId, 0, false);
  };
  webSocket.addEventListener("close", closeAll);
  webSocket.addEventListener("error", closeAll);
  send(windowFrame(0, INITIAL_WINDOW));
}
