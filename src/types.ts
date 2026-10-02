/** Interfaces partagées par le moteur, les stockages et le cycle de vie. */
export interface DiskSnapshot {
  key: string;
  data: ArrayBuffer;
  updatedAt: number;
}

export interface AccessToken {
  value: string;
  expiresAt: number;
}

export interface PersistenceStore {
  getDisk(key: string): Promise<DiskSnapshot | undefined>;
  saveDisk(snapshot: DiskSnapshot): Promise<void>;
  deleteDisk(key: string): Promise<void>;
  getToken(key: string): Promise<AccessToken | undefined>;
  saveToken(key: string, token: AccessToken): Promise<void>;
  deleteToken(key: string): Promise<void>;
}

export type VmStatus = "idle" | "starting" | "running" | "stopping" | "error";

export interface VmEngine {
  start(disk: ArrayBuffer, memoryMb: number): Promise<void>;
  stop(): Promise<void>;
  exportDisk(): Promise<ArrayBuffer>;
  getDiskRevision(): number;
}
