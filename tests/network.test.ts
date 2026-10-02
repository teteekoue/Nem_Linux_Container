import { describe, expect, it } from "vitest";
import { NetworkRelay } from "../src/network/relay";

describe("NetworkRelay", () => {
  it("convertit les URL WebSocket vers les schémas WISP reconnus par v86", () => {
    expect(new NetworkRelay("wss://relay.example/work").v86Url).toBe(
      "wisps://relay.example/work",
    );
    expect(new NetworkRelay("ws://localhost:8787").v86Url).toBe(
      "wisp://localhost:8787",
    );
  });

  it("désactive le relais quand aucune URL n’est configurée", () => {
    const relay = new NetworkRelay("");
    expect(relay.enabled).toBe(false);
    expect(relay.v86Url).toBe("");
  });

  it("rejette les protocoles autres que ws et wss", () => {
    expect(() => new NetworkRelay("https://relay.example")).toThrow(
      "L’URL du relais doit utiliser ws:// ou wss://.",
    );
  });
});
