import fs from "node:fs";
import { V86 } from "v86";

const asset = (name) => {
  const bytes = fs.readFileSync(new URL(`../public/assets/${name}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const disk = asset("alpine-v1.ext2");
const emulator = new V86({
  wasm_path: "public/assets/v86.wasm",
  memory_size: 128 * 1024 * 1024,
  bios: { buffer: asset("seabios.bin") },
  vga_bios: { buffer: asset("vgabios.bin") },
  bzimage: { buffer: asset("bzImage") },
  initrd: { buffer: asset("initramfs-lts") },
  hda: { buffer: disk },
  cmdline:
    "root=/dev/sda rw rootflags=rw rootfstype=ext2 modules=ne2k-pci console=ttyS0,115200n8 noapic nolapic acpi=off",
  autostart: true,
});

let serial = "";
emulator.add_listener("serial0-output-byte", (byte) => {
  serial += String.fromCharCode(byte);
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
  const start = serial.length;
  emulator.serial0_send(
    "echo NLC_DISK_SAVE_PROBE > /root/nlc-save-test; sync; echo NLC_BOOT_TEST_DONE\n",
  );
  await waitFor(
    () => serial.slice(start).includes("~ # "),
    "écriture du fichier invité",
    20_000,
  );

  const marker = new TextEncoder().encode("NLC_DISK_SAVE_PROBE");
  const found = Buffer.from(disk).includes(Buffer.from(marker));
  if (!found) throw new Error("L’écriture invitée n’a pas été reflétée dans l’image ext2.");
  console.log("Boot Alpine, shell root série et sauvegarde ext2 vérifiés.");
} finally {
  await emulator.destroy();
}
