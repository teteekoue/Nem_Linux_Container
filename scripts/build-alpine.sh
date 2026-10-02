#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${ROOT}/public/assets"
TMP="$(mktemp -d)"
IMAGE_TAG="nlc-alpine-builder:local"
IMAGE_SIZE_MB="${IMAGE_SIZE_MB:-60}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker est requis pour construire Alpine x86." >&2
  exit 1
fi
mkdir -p "${OUTPUT}"
trap 'rm -rf "${TMP}"' EXIT
docker build --platform linux/386 -f "${ROOT}/scripts/alpine/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}/scripts/alpine"
docker run --rm --platform linux/386 -e IMAGE_SIZE_MB="${IMAGE_SIZE_MB}" -v "${TMP}:/out" "${IMAGE_TAG}" sh -ec '
  cp /build-output/bzImage /build-output/initramfs-lts /out/
  tar --numeric-owner -czf /out/rootfs.tar.gz \
    --exclude=./dev --exclude=./proc --exclude=./sys --exclude=./tmp \
    --exclude=./out -C / .
  apk add --no-cache e2fsprogs
  mkdir /tmp/rootfs
  tar --numeric-owner -xzf /out/rootfs.tar.gz -C /tmp/rootfs
  mkdir -p /tmp/rootfs/dev/pts /tmp/rootfs/dev/shm /tmp/rootfs/proc /tmp/rootfs/sys /tmp/rootfs/run /tmp/rootfs/tmp /tmp/rootfs/var/tmp
  chmod 1777 /tmp/rootfs/tmp /tmp/rootfs/var/tmp /tmp/rootfs/dev/shm
  mknod -m 600 /tmp/rootfs/dev/console c 5 1
  mknod -m 666 /tmp/rootfs/dev/null c 1 3
  mknod -m 666 /tmp/rootfs/dev/zero c 1 5
  mknod -m 666 /tmp/rootfs/dev/tty c 5 0
  mknod -m 666 /tmp/rootfs/dev/ptmx c 5 2
  mknod -m 666 /tmp/rootfs/dev/tty0 c 4 0
  mknod -m 666 /tmp/rootfs/dev/ttyS0 c 4 64
  for n in 1 2 3 4 5 6; do mknod -m 620 "/tmp/rootfs/dev/tty${n}" c 4 "$n"; done
  mknod -m 666 /tmp/rootfs/dev/random c 1 8
  mknod -m 666 /tmp/rootfs/dev/urandom c 1 9
  truncate -s "${IMAGE_SIZE_MB}M" /out/alpine-v1.ext2
  mkfs.ext2 -F -q -m 0 -b 1024 -d /tmp/rootfs /out/alpine-v1.ext2
'

cp "${TMP}/bzImage" "${OUTPUT}/bzImage"
cp "${TMP}/initramfs-lts" "${OUTPUT}/initramfs-lts"
cp "${TMP}/alpine-v1.ext2" "${OUTPUT}/alpine-v1.ext2"

echo "Image générée : ${OUTPUT}/alpine-v1.ext2 ($(du -h "${OUTPUT}/alpine-v1.ext2" | cut -f1))"
echo "Noyau généré : ${OUTPUT}/bzImage"
echo "Initramfs généré : ${OUTPUT}/initramfs-lts ($(du -h "${OUTPUT}/initramfs-lts" | cut -f1))"
