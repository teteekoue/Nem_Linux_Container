import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "public/assets");
const v86Package = resolve(root, "node_modules/v86");
const biosBase =
  "https://raw.githubusercontent.com/copy/v86/2d6f9aaa0d5357595cd7d7dd93065987ec1445b5/bios";

await mkdir(output, { recursive: true });
await copyFile(resolve(v86Package, "build/v86.wasm"), resolve(output, "v86.wasm"));

for (const name of ["seabios.bin", "vgabios.bin"]) {
  const response = await fetch(`${biosBase}/${name}`);
  if (!response.ok) {
    throw new Error(`Téléchargement du BIOS v86 ${name} impossible (${response.status}).`);
  }
  await writeFile(resolve(output, name), new Uint8Array(await response.arrayBuffer()));
}

console.log("Artefacts v86 et BIOS copiés dans public/assets/.");
