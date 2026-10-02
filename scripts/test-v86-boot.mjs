import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { V86 } from "v86";

const asset = (name) => {
  const bytes = fs.readFileSync(new URL(`../public/assets/${name}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const compressedDisk = asset("alpine-v1.ext2.gz.bin");
const uncompressedDisk = gunzipSync(new Uint8Array(compressedDisk));
const disk = uncompressedDisk.buffer.slice(
  uncompressedDisk.byteOffset,
  uncompressedDisk.byteOffset + uncompressedDisk.byteLength,
);
const bootStartedAt = performance.now();
const emulator = new V86({
  wasm_path: "public/assets/v86.wasm",
  memory_size: 128 * 1024 * 1024,
  bios: { buffer: asset("seabios.bin") },
  vga_bios: { buffer: asset("vgabios.bin") },
  bzimage: { buffer: asset("bzImage") },
  initrd: { buffer: asset("initramfs-lts") },
  hda: { buffer: disk },
  cmdline:
    "root=/dev/sda rw rootflags=rw rootfstype=ext2 console=ttyS0,115200n8 noapic nolapic acpi=off loglevel=7 ignore_loglevel nosmp",
  autostart: true,
});

let serial = "";
let diskWrites = 0;
emulator.add_listener("serial0-output-byte", (byte) => {
  serial += String.fromCharCode(byte);
});
emulator.add_listener("ide-write-end", () => {
  diskWrites += 1;
});

async function waitFor(predicate, description, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!predicate()) {
    throw new Error(`Délai dépassé (${description}). Sortie série :\n${serial.slice(-3_000)}`);
  }
}

try {
  await waitFor(() => serial.includes("~ # "), "shell root Alpine");
  console.log(`Invite Alpine prête après ${((performance.now() - bootStartedAt) / 1000).toFixed(1)} s.`);
  const start = serial.length;
  emulator.serial0_send(
    "command -v bash >/dev/null && command -v git >/dev/null && command -v nano >/dev/null && command -v python3 >/dev/null && command -v pip3 >/dev/null && python3 -c 'print(\"NLC_PYTHON_OK\")' && echo NLC_DEV_TOOLS_OK; echo NLC_DISK_SAVE_PROBE > /root/nlc-save-test; sync; cat /root/nlc-save-test; echo NLC_BOOT_TEST_DONE\n",
  );
  await waitFor(
    () => {
      const output = serial.slice(start);
      const diskMarker = output.lastIndexOf("NLC_DISK_SAVE_PROBE");
      const doneMarker = output.lastIndexOf("NLC_BOOT_TEST_DONE");
      return (
        diskMarker >= 0 &&
        doneMarker > diskMarker &&
        output.lastIndexOf("~ #") > doneMarker
      );
    },
    "écriture du fichier invité",
    20_000,
  );

  const output = serial.slice(start);
  if (!output.includes("NLC_PYTHON_OK") || !output.includes("NLC_DEV_TOOLS_OK")) {
    throw new Error(`Les outils de développement ne sont pas tous installés :\n${output.slice(-3_000)}`);
  }
  if (diskWrites === 0) throw new Error("v86 n’a signalé aucune écriture IDE.");
  const marker = new TextEncoder().encode("NLC_DISK_SAVE_PROBE");
  const found = Buffer.from(disk).includes(Buffer.from(marker));
  if (!found) throw new Error("L’écriture invitée n’a pas été reflétée dans l’image ext2.");
  console.log("Boot Alpine, shell root série et sauvegarde ext2 vérifiés.");
} finally {
  await emulator.destroy();
}
