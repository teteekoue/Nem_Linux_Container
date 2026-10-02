import { connect } from "cloudflare:sockets";
import { Connection } from "@gvibehacker/browser-socket-cloudflare-worker";
import { acceptWispSocket } from "./wisp";

interface RelaySocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  ack(info: {
    address: string;
    port: number;
    family: string;
    remoteAddress: string;
    remotePort: number;
  }): void;
  destroy(error?: string): void;
}

interface RelayAddress {
  host: string;
  port: number;
}

/** Relais WebSocket vers les sockets TCP sortants via l’API Cloudflare connect(). */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/browser-socket") {
      return handleBrowserSocket(request);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("NemLinux Container WISP network relay", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    acceptWispSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  },
};

function handleBrowserSocket(request: Request): Response {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("NemLinux Container browser-socket relay", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  const connection = new Connection(server);
  connection.addEventListener("connect", async (rawEvent) => {
    const [socket, { host, port }] = (rawEvent as CustomEvent<[RelaySocket, RelayAddress]>).detail;
    try {
      if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
        socket.destroy("invalid destination");
        return;
      }
      const tcp = connect({ hostname: host, port });
      socket.ack({
        address: host,
        port,
        family: "IPv4",
        remoteAddress: "0.0.0.0",
        remotePort: 0,
      });
      void tcp.closed.catch(() => socket.destroy("tcp connection closed"));
      void socket.readable.pipeTo(tcp.writable).catch(() => socket.destroy("tcp write error"));
      void tcp.readable.pipeTo(socket.writable).catch(() => socket.destroy("tcp read error"));
    } catch (error) {
      socket.destroy(error instanceof Error ? error.message : "tcp connection failed");
    }
  });
  return new Response(null, { status: 101, webSocket: client });
}
