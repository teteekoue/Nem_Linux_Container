import type { AccessToken, PersistenceStore } from "../types";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_STORE_KEY = "google-drive";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(options: {
        client_id: string;
        scope: string;
        callback: (response: GoogleTokenResponse) => void;
        error_callback: (error: { message?: string }) => void;
      }): { requestAccessToken(): void };
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

/** Authentification GIS et synchronisation resumable de l’image dans Drive. */
export class GoogleDriveSync {
  private fileId?: string;
  private identityServices?: Promise<void>;

  constructor(
    private readonly store: PersistenceStore,
    private readonly clientId: string,
    private readonly fileName: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async connect(): Promise<AccessToken> {
    if (!this.clientId) throw new Error("VITE_GOOGLE_CLIENT_ID n’est pas configuré.");
    await this.loadIdentityServices();
    const identity = window.google;
    if (!identity) throw new Error("Google Identity Services n’est pas disponible.");
    const response = await new Promise<GoogleTokenResponse>((resolve, reject) => {
      const client = identity.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_SCOPE,
        callback: resolve,
        error_callback: (error) => reject(new Error(error.message || "Connexion Google interrompue.")),
      });
      client.requestAccessToken();
    });
    if (response.error) throw new Error(response.error_description || response.error);
    const token = { value: response.access_token, expiresAt: Date.now() + response.expires_in * 1000 };
    await this.store.saveToken(TOKEN_STORE_KEY, token);
    return token;
  }

  /** Précharge GIS avant le clic de connexion pour préserver le geste utilisateur OAuth. */
  async prepare(): Promise<void> {
    await this.loadIdentityServices();
  }

  async getUsableToken(): Promise<AccessToken> {
    const token = await this.store.getToken(TOKEN_STORE_KEY);
    if (!token || token.expiresAt <= Date.now() + 30_000) {
      throw new Error("Le jeton Google Drive a expiré. Reconnectez votre compte.");
    }
    return token;
  }

  async upload(data: ArrayBuffer): Promise<void> {
    const token = await this.getUsableToken();
    const fileId = await this.findOrCreateFile(token.value);
    const session = await this.fetcher(`${DRIVE_UPLOAD_URL}/${fileId}?uploadType=resumable`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token.value}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/octet-stream",
        "X-Upload-Content-Length": String(data.byteLength),
      },
      body: JSON.stringify({ name: this.fileName }),
    });
    if (!session.ok) throw await this.driveError(session, "Initialisation de l’upload Drive impossible.");
    const uploadUrl = session.headers.get("Location");
    if (!uploadUrl) throw new Error("Drive n’a pas fourni l’URL de reprise de l’upload.");

    let offset = 0;
    while (offset < data.byteLength) {
      const end = Math.min(offset + UPLOAD_CHUNK_SIZE, data.byteLength) - 1;
      let result: Response;
      try {
        result = await this.fetcher(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Range": `bytes ${offset}-${end}/${data.byteLength}`,
            "Content-Type": "application/octet-stream",
          },
          body: data.slice(offset, end + 1),
        });
      } catch (error) {
        const confirmedOffset = await this.getUploadOffset(uploadUrl, data.byteLength);
        if (confirmedOffset <= offset) throw error;
        offset = confirmedOffset;
        continue;
      }

      if (result.status === 308) {
        const nextOffset = this.uploadedBytes(result.headers.get("Range"));
        if (nextOffset <= offset) throw new Error("L’upload Drive n’a pas progressé.");
        if (nextOffset >= data.byteLength) {
          throw new Error("Drive signale un upload incomplet après réception de toute l’image.");
        }
        offset = nextOffset;
        continue;
      }
      if (!result.ok) throw await this.driveError(result, "Envoi de l’image vers Drive impossible.");
      if (end + 1 < data.byteLength) {
        throw new Error("Drive a terminé l’upload avant la fin de l’image disque.");
      }
      offset = data.byteLength;
    }
  }

  async download(): Promise<ArrayBuffer | undefined> {
    const token = await this.getUsableToken();
    const fileId = await this.findFile(token.value);
    if (!fileId) return undefined;
    const response = await this.fetcher(`${DRIVE_FILES_URL}/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token.value}` },
    });
    if (!response.ok) throw await this.driveError(response, "Téléchargement de l’image Drive impossible.");
    return response.arrayBuffer();
  }

  async disconnect(): Promise<void> {
    await this.store.deleteToken(TOKEN_STORE_KEY);
    this.fileId = undefined;
  }

  private async findOrCreateFile(token: string): Promise<string> {
    const found = await this.findFile(token);
    if (found) return found;
    const response = await this.fetcher(`${DRIVE_FILES_URL}?fields=id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: this.fileName,
        mimeType: "application/octet-stream",
        appProperties: { application: "nemlinux-container" },
      }),
    });
    if (!response.ok) throw await this.driveError(response, "Création du fichier Drive impossible.");
    const file = (await response.json()) as { id?: string };
    if (!file.id) throw new Error("Drive n’a pas retourné d’identifiant de fichier.");
    this.fileId = file.id;
    return file.id;
  }

  private async findFile(token: string): Promise<string | undefined> {
    if (this.fileId) return this.fileId;
    const query = encodeURIComponent(`name = '${this.fileName}' and trashed = false`);
    const response = await this.fetcher(
      `${DRIVE_FILES_URL}?q=${query}&spaces=drive&fields=files(id)&pageSize=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw await this.driveError(response, "Recherche du fichier Drive impossible.");
    const result = (await response.json()) as { files?: Array<{ id: string }> };
    this.fileId = result.files?.[0]?.id;
    return this.fileId;
  }

  private async getUploadOffset(uploadUrl: string, totalBytes: number): Promise<number> {
    const response = await this.fetcher(uploadUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes */${totalBytes}` },
      body: new Uint8Array(),
    });
    if (response.status === 200 || response.status === 201) return totalBytes;
    if (response.status !== 308) {
      throw await this.driveError(response, "Reprise de l’upload Drive impossible.");
    }
    return this.uploadedBytes(response.headers.get("Range"));
  }

  private uploadedBytes(range: string | null): number {
    if (!range) return 0;
    const match = /^bytes=0-(\d+)$/.exec(range);
    if (!match) throw new Error(`En-tête de reprise Drive invalide : ${range}`);
    return Number(match[1]) + 1;
  }

  private async driveError(response: Response, message: string): Promise<Error> {
    if (response.status === 401) {
      return new Error("Le jeton Google Drive a expiré. Reconnectez votre compte.");
    }
    const detail = await response.text();
    return new Error(`${message} (${response.status})${detail ? ` : ${detail}` : ""}`);
  }

  private async loadIdentityServices(): Promise<void> {
    if (window.google?.accounts?.oauth2) return;
    this.identityServices ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        this.identityServices = undefined;
        reject(new Error("Chargement de Google Identity Services impossible."));
      };
      document.head.append(script);
    });
    await this.identityServices;
  }
}
