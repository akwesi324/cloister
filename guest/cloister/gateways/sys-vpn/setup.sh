#!/bin/bash
# Runs inside the sys-vpn container.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends wireguard-tools openvpn nftables dnsmasq iproute2

install -m 0755 /tmp/gw/nftables.conf /etc/nftables.conf
install -m 0644 /tmp/gw/dnsmasq.conf /etc/dnsmasq.d/cloister.conf
install -m 0755 /tmp/gw/cloister-vpn /usr/local/sbin/cloister-vpn
: > /etc/dnsmasq.d/vpn-upstream.servers
echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/90-cloister.conf
sysctl -p /etc/sysctl.d/90-cloister.conf || true

mkdir -p /etc/systemd/network
cat > /etc/systemd/network/20-eth1.network <<'EOF'
[Match]
Name=eth1
[Network]
Address=10.153.153.1/24
LinkLocalAddressing=no
IPv6AcceptRA=no
EOF

systemctl daemon-reload
systemctl enable nftables dnsmasq systemd-networkd
systemctl restart systemd-networkd nftables dnsmasq
