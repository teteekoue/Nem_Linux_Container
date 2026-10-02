import { describe, expect, it, vi } from "vitest";
import type { DiskSnapshot, PersistenceStore, VmEngine } from "../src/types";
import { VmLifecycle } from "../src/lifecycle/controller";

function fixture() {
  const disks = new Map<string, DiskSnapshot>();
  const store: PersistenceStore = {
    getDisk: vi.fn(async (key) => disks.get(key)),
    saveDisk: vi.fn(async (snapshot) => void disks.set(snapshot.key, snapshot)),
    deleteDisk: vi.fn(async (key) => void disks.delete(key)),
    getToken: vi.fn(async () => undefined),
    saveToken: vi.fn(async () => undefined),
    deleteToken: vi.fn(async () => undefined),
  };
  const engine: VmEngine = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    exportDisk: vi.fn(async () => new Uint8Array([7, 8]).buffer),
  };
  return { lifecycle: new VmLifecycle(engine, store, "/alpine.ext2"), engine, store, disks };
}

describe("VmLifecycle", () => {
  it("démarre depuis l’image initiale, puis sauvegarde le disque au flush", async () => {
    const { lifecycle, engine, store, disks } = fixture();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    await lifecycle.start(128, false);
    expect(engine.start).toHaveBeenCalledWith(expect.any(ArrayBuffer), 128);
    await lifecycle.flush();
    expect(store.saveDisk).toHaveBeenCalledOnce();
    expect([...new Uint8Array(disks.get("alpine-rootfs")!.data)]).toEqual([7, 8]);
    await lifecycle.stop();
    vi.unstubAllGlobals();
  });

  it("reprend le disque IndexedDB au lieu de télécharger l’image initiale", async () => {
    const { lifecycle, engine, store } = fixture();
    const data = new Uint8Array([4, 5]).buffer;
    await store.saveDisk({ key: "alpine-rootfs", data, updatedAt: Date.now() });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await lifecycle.start(256, true);
    expect(engine.start).toHaveBeenCalledWith(data, 256);
    expect(fetcher).not.toHaveBeenCalled();
    await lifecycle.stop();
    vi.unstubAllGlobals();
  });

  it("sauvegarde automatiquement le disque après l’intervalle de cinq secondes", async () => {
    vi.useFakeTimers();
    const { lifecycle, store } = fixture();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    try {
      await lifecycle.start(128, false);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.saveDisk).toHaveBeenCalledOnce();
    } finally {
      await lifecycle.stop();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("signale une erreur de démarrage et autorise une nouvelle tentative", async () => {
    const { lifecycle, engine } = fixture();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(lifecycle.start(128, false)).rejects.toThrow("Téléchargement");
    expect(lifecycle.currentStatus).toBe("error");
    vi.unstubAllGlobals();
  });
});
