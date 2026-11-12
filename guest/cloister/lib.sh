#!/bin/bash
# Shared helpers for the provisioning steps. Sourced, not executed.
set -Eeuo pipefail

CL_DIR=/opt/cloister
CL_STATE=/var/lib/cloister
CL_LOG=/var/log/cloister-provision.log
export DEBIAN_FRONTEND=noninteractive
mkdir -p "$CL_STATE"
SEED_URL=$(cat "$CL_STATE/seed-url" 2>/dev/null || true)

# Compartments and their window colours (Qubes-style labels).
CL_COMPARTMENTS=(vault pentest soc forensics)
declare -A CL_COLOR=([vault]="#1f1f1f" [pentest]="#d32f2f" [soc]="#ef8a00" [forensics]="#7b3fbf" [dispo]="#7f8c8d" [sys-tor]="#c9a400" [sys-vpn]="#c9a400")
# Network each compartment gets after provisioning: direct | tor | vpn | none
declare -A CL_NET=([vault]=none [pentest]=direct [soc]=direct [forensics]=none)

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$CL_LOG" >&2; }

progress() {
  log "[$1] $2"
  if [ -n "$SEED_URL" ]; then
    curl -fsS -m 5 -X POST --data-urlencode "step=$1" --data-urlencode "msg=$2" "$SEED_URL/progress" >/dev/null 2>&1 || true
  fi
}

retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    if [ "$n" -ge 8 ]; then log "giving up after $n tries: $*"; return 1; fi
    log "retry $n in $((n * 15))s: $*"
    sleep $((n * 15))
  done
}

apt_install() { retry apt-get install -y --no-install-recommends "$@"; }

# Run a command inside a compartment as root.
cx() { local c=$1; shift; incus exec "$c" --env DEBIAN_FRONTEND=noninteractive -- "$@"; }

# Wait until a container has an IPv4 default route (DHCP done).
wait_online() {
  local c=$1 i
  for i in $(seq 1 60); do
    if cx "$c" sh -c 'ip -4 route | grep -q ^default'; then return 0; fi
    sleep 2
  done
  log "$c did not get a network address"; return 1
}

# Xpra: use the distribution package when it exists, otherwise the official Xpra repository.
install_xpra_cmds() {
  cat <<'EOF'
set -e
export DEBIAN_FRONTEND=noninteractive
if ! apt-get install -y --no-install-recommends xpra xpra-x11 2>/dev/null && ! apt-get install -y --no-install-recommends xpra; then
  apt-get install -y --no-install-recommends curl ca-certificates gnupg
  codename=$(. /etc/os-release; echo "${VERSION_CODENAME:-trixie}")
  case "$codename" in kali-rolling) codename=sid ;; esac
  curl -fsSL https://xpra.org/xpra.asc -o /usr/share/keyrings/xpra.asc
  echo "deb [signed-by=/usr/share/keyrings/xpra.asc] https://xpra.org/ $codename main" > /etc/apt/sources.list.d/xpra.list
  apt-get update
  apt-get install -y --no-install-recommends xpra
fi
EOF
}
