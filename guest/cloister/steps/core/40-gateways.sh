#!/bin/bash
# The two network gateways. They start automatically, before any compartment.
source /opt/cloister/lib.sh

gateway() { # name client-network
  local name=$1 net=$2
  if ! incus info "$name" >/dev/null 2>&1; then
    retry incus launch images:debian/13 "$name" \
      -c boot.autostart=true -c boot.autostart.priority=100
    incus config device add "$name" eth0 nic network=clnet name=eth0 security.mac_filtering=true
    incus config device add "$name" eth1 nic network="$net" name=eth1
    incus restart "$name"
  fi
  wait_online "$name"
  cx "$name" rm -rf /tmp/gw
  cx "$name" mkdir -p /tmp/gw
  for f in "$CL_DIR/gateways/$name"/*; do incus file push "$f" "$name/tmp/gw/"; done
  retry cx "$name" bash /tmp/gw/setup.sh
}

gateway sys-tor cltor
gateway sys-vpn clvpn
