#!/bin/bash
# Build the compartments. Each one is resumable on its own (marker per compartment).
source /opt/cloister/lib.sh

# Kali's repositories carry the widest set of security tools; Debian is the fallback.
base_image() {
  case "$1" in
    vault|dispo*) echo images:debian/13 ;;
    *) if incus image info images:kali >/dev/null 2>&1; then echo images:kali; else echo images:debian/13; fi ;;
  esac
}

push_helpers() {
  local c=$1
  cx "$c" rm -rf /tmp/cl
  cx "$c" mkdir -p /tmp/cl
  incus file push "$CL_DIR/tools/install-tools.sh" "$CL_DIR/tools/compartment-setup.sh" "$c/tmp/cl/"
  incus file push "$CL_DIR/tools/$2.list" "$c/tmp/cl/tools.list"
  install_xpra_cmds > /tmp/install-xpra.sh
  incus file push /tmp/install-xpra.sh "$c/tmp/cl/install-xpra.sh"
}

build_compartment() { # name list-name
  local c=$1 list=$2 marker="$CL_STATE/done.compartment-$1"
  [ -e "$marker" ] && return 0
  progress "compartment-$c" "creating from $(base_image "$c")"
  if ! incus info "$c" >/dev/null 2>&1; then
    retry incus launch "$(base_image "$c")" "$c" -c boot.autostart=false
  fi
  # Temporary internet for installing tools; the real network is applied afterwards.
  incus config device remove "$c" eth0 >/dev/null 2>&1 || true
  incus config device add "$c" eth0 nic network=clnet name=eth0 security.mac_filtering=true
  incus stop "$c" --force >/dev/null 2>&1 || true
  incus start "$c"
  wait_online "$c"
  push_helpers "$c" "$list"
  retry cx "$c" bash /tmp/cl/compartment-setup.sh
  progress "compartment-$c" "installing tools (this is the long part)"
  cx "$c" bash /tmp/cl/install-tools.sh /tmp/cl/tools.list | tee -a "$CL_LOG"
  cx "$c" rm -rf /tmp/cl
  incus config device remove "$c" eth0
  incus config device add "$c" xpra proxy bind=host \
    listen="unix:/run/cloister/xpra-$c.sock" connect=tcp:127.0.0.1:14650 \
    uid=1000 gid=1000 mode=0600 >/dev/null 2>&1 || true
  incus stop "$c" --force
  /usr/local/bin/cl net "$c" "${CL_NET[$c]:-none}" --quiet
  incus snapshot create "$c" clean --reuse
  touch "$marker"
}

install -m 0755 "$CL_DIR/bin/cl" /usr/local/bin/cl
for c in "${CL_COMPARTMENTS[@]}"; do build_compartment "$c" "$c"; done
# Template for throwaway compartments (`cl dispose`); copies of it delete themselves on stop.
build_compartment dispo-template dispo
