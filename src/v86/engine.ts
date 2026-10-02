import { Terminal } from "@xterm/xterm";
import { V86 } from "v86";
import type { VmEngine } from "../types";
import { NLC_CONFIG } from "../config";

/** Initialisation v86, boot Alpine x86 et accès à l’image disque du moteur. */
export class V86Engine implements VmEngine {
  private emulator?: InstanceType<typeof V86>;
  private diskBuffer?: ArrayBuffer;
  private serialOutput = "";
  private pendingBytes: number[] = [];
  private outputFlushTimer?: number;
  private readonly renderDecoder = new TextDecoder();
  private bootCheck?: () => void;
  private bootOutputTail = "";
  private diskRevision = 0;
  private readonly outputListeners = new Set<(output: string) => void>();

  constructor(private readonly terminal: Terminal) {
    this.terminal.onData((data) => this.emulator?.serial0_send(data));
  }

  getSerialOutput(): string {
    return this.serialOutput;
  }

  getDiskRevision(): number {
    return this.diskRevision;
  }

  onSerialOutput(listener: (output: string) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

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

    this.bootOutputTail = "";
    this.diskRevision = 0;
    const emulator = new V86({
      wasm_path: NLC_CONFIG.assets.wasm,
      memory_size: memoryMb * 1024 * 1024,
      bios: { buffer: bios },
      vga_bios: { buffer: vgaBios },
      bzimage: { buffer: kernel },
      initrd: { buffer: initrd },
      hda: { buffer: disk },
      cmdline:
        "root=/dev/sda rw rootflags=rw rootfstype=ext2 console=ttyS0,115200n8 noapic nolapic acpi=off loglevel=7 ignore_loglevel nosmp",
      autostart: true,
      serial_console: { type: "none" },
    });
    this.emulator = emulator;
    emulator.add_listener("serial0-output-byte", this.handleSerialByte);
    emulator.add_listener("ide-write-end", () => {
      this.diskRevision += 1;
    });
    try {
      await this.waitForBoot(emulator);
      this.flushSerialOutput();
    } catch (error) {
      this.flushSerialOutput();
      await emulator.destroy();
      this.emulator = undefined;
      this.diskBuffer = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const emulator = this.emulator;
    if (!emulator) return;
    this.flushSerialOutput();
    await emulator.destroy();
    this.emulator = undefined;
    this.diskBuffer = undefined;
    this.diskRevision = 0;
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

  private readonly handleSerialByte = (byte: number): void => {
    this.pendingBytes.push(byte);
    if (this.outputFlushTimer === undefined) {
      this.outputFlushTimer = window.setTimeout(() => this.flushSerialOutput(), 16);
    }
  };

  private flushSerialOutput(): void {
    if (this.outputFlushTimer !== undefined) {
      window.clearTimeout(this.outputFlushTimer);
      this.outputFlushTimer = undefined;
    }
    if (this.pendingBytes.length === 0) return;
    const output = this.renderDecoder.decode(Uint8Array.from(this.pendingBytes), { stream: true });
    this.pendingBytes = [];
    if (output) {
      this.serialOutput += output;
      this.bootOutputTail = (this.bootOutputTail + output).slice(-128);
      for (const listener of this.outputListeners) listener(output);
      this.bootCheck?.();
    }
    this.terminal.write(output);
  }

  private waitForBoot(emulator: InstanceType<typeof V86>): Promise<void> {
    return new Promise((resolve, reject) => {
      let emulatorStarted = false;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        this.bootCheck = undefined;
        if (error) reject(error);
        else resolve();
      };
      this.bootCheck = () => {
        if (emulatorStarted && this.bootOutputTail.includes("~ # ")) {
          finish();
        }
      };
      emulator.add_listener("emulator-started", () => {
        emulatorStarted = true;
        this.bootCheck?.();
      });
      emulator.add_listener("download-error", (detail) => {
        finish(new Error(`Erreur de chargement v86 : ${detail.file_name}.`));
      });
      emulator.add_listener("emulator-stopped", () => {
        finish(new Error("v86 s’est arrêté avant l’invite de commande Alpine."));
      });
      this.bootCheck();
    });
  }
}
