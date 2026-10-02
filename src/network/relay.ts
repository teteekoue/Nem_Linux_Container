/** Validation et supervision de la disponibilité du relais réseau Cloudflare. */
export class NetworkRelay {
  constructor(readonly url: string) {
    if (url && !["ws:", "wss:"].includes(new URL(url).protocol)) {
      throw new Error("L’URL du relais doit utiliser ws:// ou wss://.");
    }
  }

  get enabled(): boolean {
    return this.url.length > 0;
  }

  get v86Url(): string {
    return this.url.replace(/^wss:/, "wisps:").replace(/^ws:/, "wisp:");
  }

  /** Vérifie l’endpoint avant le démarrage; le socket de transport est géré par v86. */
  async check(timeoutMs = 4_000): Promise<void> {
    if (!this.enabled) return;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error("Délai dépassé lors de la connexion au relais réseau."));
      }, timeoutMs);
      socket.onopen = () => {
        window.clearTimeout(timeout);
        socket.close();
        resolve();
      };
      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Connexion au relais réseau impossible."));
      };
    });
  }
}
