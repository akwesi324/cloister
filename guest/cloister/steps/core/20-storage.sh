#!/bin/bash
# Encrypt the data disk (LUKS2). Every compartment, the vault and all evidence live on it.
# During the build a random key unlocks it; the first-run wizard replaces that key with
# your passphrase and destroys the random one.
source /opt/cloister/lib.sh

dev=/dev/disk/by-id/virtio-cloister-data
key=/root/.cloister-provision.key
[ -e "$dev" ] || { log "data disk $dev is missing"; exit 1; }

if ! cryptsetup isLuks "$dev"; then
  install -m 0400 /dev/null "$key"
  head -c 64 /dev/urandom > "$key"
  cryptsetup luksFormat --type luks2 --batch-mode --pbkdf argon2id --key-file "$key" "$dev"
fi
[ -e /dev/mapper/cloister-data ] || cryptsetup open --key-file "$key" "$dev" cloister-data

if ! grep -q '^cloister-data ' /etc/crypttab 2>/dev/null; then
  echo "cloister-data $dev $key luks,discard" >> /etc/crypttab
fi

# Incus must wait for the unlock.
mkdir -p /etc/systemd/system/incus.service.d
cat > /etc/systemd/system/incus.service.d/cloister.conf <<'EOF'
[Unit]
After=cryptsetup.target
Requires=dev-mapper-cloister\x2ddata.device
After=dev-mapper-cloister\x2ddata.device
EOF
systemctl daemon-reload
