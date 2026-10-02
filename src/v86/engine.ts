import { Terminal } from "@xterm/xterm";
import { V86 } from "v86";
import type { VmEngine } from "../types";
import { NLC_CONFIG } from "../config";
import { NetworkRelay } from "../network/relay";

/** Initialisation v86, boot Alpine x86 et accès à l’image disque du moteur. */
export class V86Engine implements VmEngine {
  private emulator?: InstanceType<typeof V86>;
  private diskBuffer?: ArrayBuffer;
  private readonly relay = new NetworkRelay(NLC_CONFIG.relayUrl);

  constructor(private readonly terminal: Terminal) {}

  async start(disk: ArrayBuffer, memoryMb: number): Promise<void> {
    if (this.emulator) throw new Error("La machine virtuelle est déjà initialisée.");
    if (![128, 256].includes(memoryMb)) throw new Error("La mémoire doit être de 128 ou 256 Mo.");
    this.diskBuffer = disk;
    const [kernel, initrd, bios, vgaBios] = await Promise.all([
      this.fetchAsset(NLC_CONFIG.assets.kernel),
      this.fetchAsset(NLC_CONFIG.assets.initrd),
      this.fetchAsset(NLC_CONFIG.assets.bios),
      this.fetchAsset(NLC_CONFIG.assets.vgaBios),
    ]);

    const emulator = new V86({
      wasm_path: NLC_CONFIG.assets.wasm,
      memory_size: memoryMb * 1024 * 1024,
      bios: { buffer: bios },
      vga_bios: { buffer: vgaBios },
      bzimage: { buffer: kernel },
      initrd: { buffer: initrd },
      hda: { buffer: disk },
      cmdline:
        "root=/dev/sda rw rootflags=rw rootfstype=ext2 modules=ne2k-pci console=ttyS0,115200n8 noapic nolapic acpi=off",
      autostart: true,
      serial_console: {
        type: "xtermjs",
        container: this.terminal.element?.parentElement ?? document.body,
        xterm_lib: Terminal,
      },
      net_device: {
        type: "ne2k",
        ...(this.relay.enabled ? { relay_url: this.relay.v86Url } : {}),
      },
    });
    this.emulator = emulator;
    try {
      await this.waitFor(emulator, "emulator-started");
    } catch (error) {
      await emulator.destroy();
      this.emulator = undefined;
      this.diskBuffer = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const emulator = this.emulator;
    if (!emulator) return;
    await emulator.destroy();
    this.emulator = undefined;
    this.diskBuffer = undefined;
  }

  async exportDisk(): Promise<ArrayBuffer> {
    if (!this.diskBuffer) throw new Error("Aucune image disque n’est chargée.");
    return this.diskBuffer.slice(0);
  }

  private async fetchAsset(path: string): Promise<ArrayBuffer> {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Téléchargement impossible : ${path} (${response.status}).`);
    return response.arrayBuffer();
  }

  private waitFor(emulator: InstanceType<typeof V86>, event: "emulator-started"): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Délai dépassé pendant le démarrage de v86.")), 60_000);
      emulator.add_listener(event, () => {
        window.clearTimeout(timeout);
        resolve();
      });
      emulator.add_listener("download-error", (detail) => {
        window.clearTimeout(timeout);
        reject(new Error(`Erreur de chargement v86 : ${detail.file_name}.`));
      });
    });
  }
}
