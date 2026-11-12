#!/bin/bash
# Runs inside a compartment: install a tool list, never failing the whole build because a
# single package is missing for this CPU or release. Skipped names go to /var/lib/cloister/missing.
# usage: install-tools.sh <list-file>
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
list=${1:?list file}
missing=/var/lib/cloister/missing
mkdir -p /var/lib/cloister
: > "$missing"

mapfile -t entries < <(sed -E 's/#.*//; s/^[[:space:]]+//; s/[[:space:]]+$//' "$list" | grep -v '^$')
apt_pkgs=(); pipx_pkgs=()
for e in "${entries[@]}"; do
  case "$e" in
    pipx:*) pipx_pkgs+=("${e#pipx:}") ;;
    *) apt_pkgs+=("$e") ;;
  esac
done

apt_get() { for i in 1 2 3 4 5; do apt-get "$@" && return 0; sleep $((i * 20)); done; return 1; }
apt_get update

# Only ask apt for packages this repository actually has, then install them in one go.
available=()
for p in "${apt_pkgs[@]}"; do
  if apt-cache show "$p" >/dev/null 2>&1; then available+=("$p"); else echo "$p (not in repository)" >> "$missing"; fi
done
if [ ${#available[@]} -gt 0 ] && ! apt_get install -y --no-install-recommends "${available[@]}"; then
  # A conflict in one package should not cost the rest: fall back to one at a time.
  for p in "${available[@]}"; do
    apt_get install -y --no-install-recommends "$p" || echo "$p (install failed)" >> "$missing"
  done
fi

if [ ${#pipx_pkgs[@]} -gt 0 ]; then
  apt_get install -y --no-install-recommends pipx python3-venv
  export PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin
  for p in "${pipx_pkgs[@]}"; do
    pipx install "$p" >/dev/null 2>&1 || echo "pipx:$p (install failed)" >> "$missing"
  done
fi

apt-get clean
echo "installed $(( ${#entries[@]} - $(wc -l < "$missing") )) of ${#entries[@]} tools; missing: $(wc -l < "$missing")"
