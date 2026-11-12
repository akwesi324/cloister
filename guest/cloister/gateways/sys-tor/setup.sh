#!/bin/bash
# Runs inside the sys-tor container.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends tor nftables dnsmasq

install -m 0644 /tmp/gw/torrc /etc/tor/torrc
install -m 0755 /tmp/gw/nftables.conf /etc/nftables.conf
install -m 0644 /tmp/gw/dnsmasq.conf /etc/dnsmasq.d/cloister.conf
echo 'net.ipv4.ip_forward=0' > /etc/sysctl.d/90-cloister.conf

# eth0 gets DHCP from clnet; eth1 is the fixed gateway address for Tor clients.
mkdir -p /etc/systemd/network
cat > /etc/systemd/network/20-eth1.network <<'EOF'
[Match]
Name=eth1
[Network]
Address=10.152.152.1/24
LinkLocalAddressing=no
IPv6AcceptRA=no
EOF

# Tor must start after eth1 has its address, or it cannot bind the ports above.
mkdir -p /etc/systemd/system/tor@default.service.d
cat > /etc/systemd/system/tor@default.service.d/cloister.conf <<'EOF'
[Unit]
After=systemd-networkd-wait-online.service
Wants=systemd-networkd-wait-online.service
[Service]
Restart=always
RestartSec=5
EOF

systemctl daemon-reload
systemctl enable nftables dnsmasq tor systemd-networkd
systemctl restart systemd-networkd nftables dnsmasq tor
