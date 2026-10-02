FROM i386/alpine:3.20

RUN apk add --no-cache alpine-base kmod linux-lts \
    && kernel_version="$(ls /lib/modules | head -n 1)" \
    && mkdir -p /build-output /etc/mkinitfs/features.d \
    && cp /boot/vmlinuz-lts /build-output/bzImage \
    && printf 'kernel/drivers/net/ethernet/8390/8390.ko*\nkernel/drivers/net/ethernet/8390/ne2k-pci.ko*\nkernel/fs/ext2/ext2.ko*\nkernel/fs/mbcache.ko*\nkernel/lib/crc16.ko*\n' \
      > /etc/mkinitfs/features.d/nlc.modules \
    && mkinitfs -F "ata base ext2 scsi nlc" -o /build-output/initramfs-lts "$kernel_version" \
    && chmod 644 /build-output/initramfs-lts \
    && apk del --purge kmod linux-lts \
    && rm -rf /lib/firmware /lib/modules /boot/* /var/cache/apk/*

RUN mkdir -p /etc/network /etc/runlevels/boot /etc/runlevels/default \
    && printf 'auto lo\niface lo inet loopback\n\nauto eth0\niface eth0 inet dhcp\n' > /etc/network/interfaces \
    && printf '\nttyS0::respawn:/sbin/getty -L -n -l /bin/sh 115200 ttyS0 vt100\n' >> /etc/inittab \
    && rc-update add networking boot

ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
CMD ["/sbin/init"]
