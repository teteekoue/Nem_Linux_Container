import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbStore } from "../src/persistence/indexeddb";

describe("IndexedDbStore", () => {
  let store: IndexedDbStore;

  beforeEach(() => {
    store = new IndexedDbStore(indexedDB);
  });

  it("conserve et relit une image disque complète", async () => {
    const snapshot = {
      key: "rootfs",
      data: new Uint8Array([1, 2, 3]).buffer,
      updatedAt: 123,
    };
    await store.saveDisk(snapshot);
    const loaded = await store.getDisk("rootfs");
    expect(loaded?.updatedAt).toBe(123);
    expect([...new Uint8Array(loaded!.data)]).toEqual([1, 2, 3]);
  });

  it("stocke les jetons avec leur date d’expiration et les supprime", async () => {
    await store.saveToken("drive", { value: "access-token", expiresAt: 456 });
    expect(await store.getToken("drive")).toEqual({
      key: "drive",
      value: "access-token",
      expiresAt: 456,
    });
    await store.deleteToken("drive");
    expect(await store.getToken("drive")).toBeUndefined();
  });
});
