import type { DiskSnapshot, PersistenceStore, VmEngine, VmStatus } from "../types";
import { NLC_CONFIG } from "../config";
import { GoogleDriveSync } from "../persistence/drive";

/** Orchestration du démarrage, de la reprise et des sauvegardes du système invité. */
export class VmLifecycle {
  private status: VmStatus = "idle";
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saveQueue: Promise<void> = Promise.resolve();
  private activeFlush?: Promise<void>;
  private driveSync?: GoogleDriveSync;
  private lastDriveDigest?: string;
  private readonly listeners = new Set<(status: VmStatus) => void>();
  private readonly pageFlush = () => {
    void this.flush().catch((error: unknown) => {
      console.error("Échec de la sauvegarde finale NLC.", error);
    });
  };
  private readonly visibilityFlush = () => {
    if (document.visibilityState === "hidden") this.pageFlush();
  };
  private readonly unloadFlush = () => this.pageFlush();

  constructor(
    private readonly engine: VmEngine,
    private readonly store: PersistenceStore,
    private readonly rootfsUrl: string,
    private readonly diskKey = NLC_CONFIG.diskKey,
  ) {}

  get currentStatus(): VmStatus {
    return this.status;
  }

  onStatus(listener: (status: VmStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  async hasLocalSession(): Promise<boolean> {
    return Boolean(await this.store.getDisk(this.diskKey));
  }

  async start(memoryMb: number, resume: boolean): Promise<void> {
    if (this.status !== "idle" && this.status !== "error") {
      throw new Error(`Démarrage impossible depuis l’état ${this.status}.`);
    }
    try {
      const saved = resume ? await this.store.getDisk(this.diskKey) : undefined;
      const disk = saved?.data ?? (await this.downloadRootfs());
      await this.boot(disk, memoryMb);
    } catch (error) {
      this.setStatus("error");
      throw error;
    }
  }

  async startFromDrive(memoryMb: number, disk: ArrayBuffer): Promise<void> {
    if (this.status !== "idle" && this.status !== "error") {
      throw new Error(`Démarrage impossible depuis l’état ${this.status}.`);
    }
    try {
      await this.boot(disk, memoryMb);
    } catch (error) {
      this.setStatus("error");
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.status !== "running") return;
    this.setStatus("stopping");
    this.clearSaveTimer();
    try {
      await this.flush();
      await this.engine.stop();
      this.setStatus("idle");
    } catch (error) {
      this.setStatus("error");
      throw error;
    }
  }

  async flush(): Promise<void> {
    if (this.status !== "running" && this.status !== "stopping") return;
    if (this.activeFlush) return this.activeFlush;
    const operation = this.performFlush();
    this.activeFlush = operation;
    try {
      await operation;
    } finally {
      if (this.activeFlush === operation) this.activeFlush = undefined;
    }
  }

  private async performFlush(): Promise<void> {
    const snapshot: DiskSnapshot = {
      key: this.diskKey,
      data: await this.engine.exportDisk(),
      updatedAt: Date.now(),
    };
    this.saveQueue = this.saveQueue.catch(() => undefined).then(async () => {
      await this.store.saveDisk(snapshot);
      if (this.driveSync) {
        const digest = await this.digest(snapshot.data);
        if (digest !== this.lastDriveDigest) {
          await this.driveSync.upload(snapshot.data);
          this.lastDriveDigest = digest;
        }
      }
    });
    await this.saveQueue;
  }

  async startDriveSync(sync: GoogleDriveSync): Promise<void> {
    this.driveSync = sync;
    const token = await sync.getUsableToken();
    if (!token.value) throw new Error("Jeton Google Drive vide.");
    if (this.status === "running") await this.flush();
  }

  detachDriveSync(): void {
    this.driveSync = undefined;
    this.lastDriveDigest = undefined;
  }

  async createNewSession(): Promise<void> {
    if (this.status === "running") await this.stop();
    await this.store.deleteDisk(this.diskKey);
    this.setStatus("idle");
  }

  /** Branche les sauvegardes de fin de page, les événements n’attendant pas le flush. */
  attachPageFlush(target: Window = window, documentTarget: Document = document): () => void {
    target.addEventListener("pagehide", this.pageFlush);
    target.addEventListener("beforeunload", this.unloadFlush);
    documentTarget.addEventListener("visibilitychange", this.visibilityFlush);
    return () => {
      target.removeEventListener("pagehide", this.pageFlush);
      target.removeEventListener("beforeunload", this.unloadFlush);
      documentTarget.removeEventListener("visibilitychange", this.visibilityFlush);
    };
  }

  private async boot(disk: ArrayBuffer, memoryMb: number): Promise<void> {
    this.setStatus("starting");
    await this.engine.start(disk, memoryMb);
    this.setStatus("running");
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.clearSaveTimer();
    this.saveTimer = setTimeout(() => {
      void this.flush()
        .catch((error: unknown) => console.error("Échec de la sauvegarde automatique NLC.", error))
        .finally(() => {
          if (this.status === "running") this.scheduleSave();
        });
    }, NLC_CONFIG.saveDebounceMs);
  }

  private clearSaveTimer(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
  }

  private async downloadRootfs(): Promise<ArrayBuffer> {
    const response = await fetch(this.rootfsUrl);
    if (!response.ok) throw new Error(`Téléchargement de l’image Alpine impossible (${response.status}).`);
    return response.arrayBuffer();
  }

  private async digest(data: ArrayBuffer): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  private setStatus(status: VmStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
