#!/bin/bash
# Incus: encrypted btrfs storage pool and the three isolated networks.
#   clnet  - NAT to the internet ("direct")
#   cltor  - no route out; the only thing on it that can reach the internet is sys-tor
#   clvpn  - no route out; only sys-vpn, which drops everything if the tunnel is down
source /opt/cloister/lib.sh

# Enough subordinate IDs that every compartment gets its own, non-overlapping UID range
# (security.idmap.isolated): root inside one compartment is nobody in another.
for f in /etc/subuid /etc/subgid; do
  grep -q '^root:' "$f" 2>/dev/null || echo 'root:1000000:1000000000' >> "$f"
done
systemctl restart incus

if ! incus storage show clpool >/dev/null 2>&1; then
  incus admin init --preseed <<'EOF'
storage_pools:
  - name: clpool
    driver: btrfs
    config:
      source: /dev/mapper/cloister-data
networks:
  - name: clnet
    type: bridge
    config:
      ipv4.address: 10.150.150.1/24
      ipv4.nat: "true"
      ipv6.address: none
  - name: cltor
    type: bridge
    config:
      ipv4.address: none
      ipv6.address: none
  - name: clvpn
    type: bridge
    config:
      ipv4.address: none
      ipv6.address: none
profiles:
  - name: default
    description: Cloister base (no network unless a compartment asks for one)
    config:
      security.idmap.isolated: "true"
      security.nesting: "false"
      security.privileged: "false"
    devices:
      root:
        type: disk
        path: /
        pool: clpool
EOF
fi

usermod -aG incus-admin analyst
install -d -m 0755 /etc/tmpfiles.d
echo 'd /run/cloister 0755 analyst analyst -' > /etc/tmpfiles.d/cloister.conf
systemd-tmpfiles --create /etc/tmpfiles.d/cloister.conf
