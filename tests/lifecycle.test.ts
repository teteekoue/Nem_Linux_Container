import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import type { DiskSnapshot, PersistenceStore, VmEngine } from "../src/types";
import { VmLifecycle } from "../src/lifecycle/controller";

function fixture() {
  const disks = new Map<string, DiskSnapshot>();
  let diskRevision = 0;
  const store: PersistenceStore = {
    getDisk: vi.fn(async (key) => disks.get(key)),
    saveDisk: vi.fn(async (snapshot) => void disks.set(snapshot.key, snapshot)),
    deleteDisk: vi.fn(async (key) => void disks.delete(key)),
    getToken: vi.fn(async () => undefined),
    saveToken: vi.fn(async () => undefined),
    deleteToken: vi.fn(async () => undefined),
  };
  const engine: VmEngine = {
    start: vi.fn(async () => {
      diskRevision += 1;
    }),
    stop: vi.fn(async () => {
      diskRevision = 0;
    }),
    exportDisk: vi.fn(async () => new Uint8Array([7, 8]).buffer),
    getDiskRevision: () => diskRevision,
  };
  return {
    lifecycle: new VmLifecycle(engine, store, "/alpine.ext2"),
    engine,
    store,
    disks,
    markDiskChanged: () => {
      diskRevision += 1;
    },
  };
}

function rootfsResponse(): Response {
  return new Response(gzipSync(Buffer.from([1, 2, 3])));
}

describe("VmLifecycle", () => {
  it("démarre depuis l’image initiale, puis sauvegarde le disque au flush", async () => {
    const { lifecycle, engine, store, disks, markDiskChanged } = fixture();
    vi.stubGlobal("fetch", vi.fn(async () => rootfsResponse()));
    await lifecycle.start(128, false);
    expect(engine.start).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]).buffer, 128);
    markDiskChanged();
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
    const { lifecycle, store, markDiskChanged } = fixture();
    vi.stubGlobal("fetch", vi.fn(async () => rootfsResponse()));
    try {
      await lifecycle.start(128, false);
      markDiskChanged();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.saveDisk).toHaveBeenCalledOnce();
    } finally {
      await lifecycle.stop();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("ignore les flushs répétés si le disque invité n’a pas changé", async () => {
    const { lifecycle, engine, store } = fixture();
    vi.stubGlobal("fetch", vi.fn(async () => rootfsResponse()));
    try {
      await lifecycle.start(128, false);
      await lifecycle.flush();
      await lifecycle.flush();
      expect(engine.exportDisk).toHaveBeenCalledOnce();
      expect(store.saveDisk).toHaveBeenCalledOnce();
    } finally {
      await lifecycle.stop();
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
