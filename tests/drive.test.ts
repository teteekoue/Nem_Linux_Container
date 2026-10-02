import { describe, expect, it, vi } from "vitest";
import type { PersistenceStore } from "../src/types";
import { GoogleDriveSync } from "../src/persistence/drive";

describe("GoogleDriveSync", () => {
  it("envoie l’image disque en chunks resumable et suit le Range confirmé", async () => {
    const store: PersistenceStore = {
      getDisk: vi.fn(),
      saveDisk: vi.fn(),
      deleteDisk: vi.fn(),
      getToken: vi.fn(async () => ({ value: "token", expiresAt: Date.now() + 60_000 })),
      saveToken: vi.fn(),
      deleteToken: vi.fn(),
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ files: [{ id: "disk-id" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: "https://upload.test/session" } }))
      .mockResolvedValueOnce(new Response(null, { status: 308, headers: { Range: "bytes=0-8388607" } }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const drive = new GoogleDriveSync(store, "client-id", "disk.ext2", fetcher);
    const data = new ArrayBuffer(8 * 1024 * 1024 + 1);

    await drive.upload(data);

    const requests = fetcher.mock.calls;
    expect(requests).toHaveLength(4);
    expect(new Headers(requests[2][1]?.headers).get("Content-Range")).toBe(
      `bytes 0-8388607/${data.byteLength}`,
    );
    expect(new Headers(requests[3][1]?.headers).get("Content-Range")).toBe(
      `bytes 8388608-8388608/${data.byteLength}`,
    );
  });
});
