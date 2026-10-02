import type { AccessToken, DiskSnapshot, PersistenceStore } from "../types";

const DATABASE_NAME = "nemlinux-container";
const DATABASE_VERSION = 1;
const DISKS_STORE = "disks";
const TOKENS_STORE = "tokens";

/** Stockage IndexedDB des images disque et des jetons OAuth locaux. */
export class IndexedDbStore implements PersistenceStore {
  private database?: Promise<IDBDatabase>;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  getDisk(key: string): Promise<DiskSnapshot | undefined> {
    return this.read<DiskSnapshot>(DISKS_STORE, key);
  }

  saveDisk(snapshot: DiskSnapshot): Promise<void> {
    return this.write(DISKS_STORE, snapshot);
  }

  deleteDisk(key: string): Promise<void> {
    return this.remove(DISKS_STORE, key);
  }

  getToken(key: string): Promise<AccessToken | undefined> {
    return this.read<AccessToken>(TOKENS_STORE, key);
  }

  saveToken(key: string, token: AccessToken): Promise<void> {
    return this.write(TOKENS_STORE, { key, ...token });
  }

  deleteToken(key: string): Promise<void> {
    return this.remove(TOKENS_STORE, key);
  }

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DISKS_STORE)) {
          db.createObjectStore(DISKS_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(TOKENS_STORE)) {
          db.createObjectStore(TOKENS_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.database = undefined;
        reject(request.error ?? new Error("Ouverture d’IndexedDB impossible."));
      };
      request.onblocked = () => {
        this.database = undefined;
        reject(new Error("La mise à niveau d’IndexedDB est bloquée."));
      };
    });
    return this.database;
  }

  private async read<T>(storeName: string, key: string): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error("Lecture IndexedDB impossible."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Lecture IndexedDB annulée."));
    });
  }

  private async write(storeName: string, value: object): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(value);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Écriture IndexedDB impossible."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Écriture IndexedDB annulée."));
    });
  }

  private async remove(storeName: string, key: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Suppression IndexedDB impossible."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Suppression IndexedDB annulée."));
    });
  }
}
