/** Configuration centrale du moteur NemLinux Container. */
export const NLC_CONFIG = {
  assets: {
    rootfs: "/assets/alpine-v1.ext2",
    kernel: "/assets/bzImage",
    initrd: "/assets/initramfs-lts",
    bios: "/assets/seabios.bin",
    vgaBios: "/assets/vgabios.bin",
    wasm: "/assets/v86.wasm",
  },
  memoryMb: [128, 256] as const,
  saveDebounceMs: 5_000,
  diskKey: "alpine-rootfs",
  driveFileName: "nemlinux-container-alpine-v1.ext2",
  relayUrl: import.meta.env.VITE_NETWORK_RELAY_URL || "",
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
} as const;

export type MemoryMb = (typeof NLC_CONFIG.memoryMb)[number];
