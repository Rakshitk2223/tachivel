#!/usr/bin/env bash
# One-time, on the Oracle box: give Tachivel its own 30 GB disk inside the existing boot disk.
# It's a file formatted as a filesystem: Tachivel can fill it, never the rest of the box. Costs nothing.
#   Grow later (no downtime):  sudo fallocate -l 40G /srv/images/tachivel.img && sudo resize2fs "$(losetup -j /srv/images/tachivel.img | cut -d: -f1)"
#   Shrink: stop Tachivel, unmount, e2fsck -f, resize2fs to the new size, truncate the file, mount again.
set -euo pipefail
SIZE="${1:-30G}"
IMG=/srv/images/tachivel.img
MNT=/srv/tachivel

sudo mkdir -p /srv/images "$MNT"
[ -f "$IMG" ] || sudo fallocate -l "$SIZE" "$IMG"          # reserves the space up front
sudo blkid "$IMG" >/dev/null 2>&1 || sudo mkfs.ext4 -q -L tachivel -m 0 "$IMG"
grep -q "$IMG" /etc/fstab || echo "$IMG $MNT ext4 loop,defaults,nofail 0 2" | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
mountpoint -q "$MNT" || sudo mount "$MNT"
sudo mkdir -p "$MNT"/{app,suwayomi,auth}
sudo chown 1000:1000 "$MNT"/app "$MNT"/suwayomi "$MNT"/auth   # every container runs as uid 1000
df -h "$MNT"
