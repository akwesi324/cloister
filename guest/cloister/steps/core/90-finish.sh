#!/bin/bash
# Tidy up: stop compartments (they start on demand), drop caches, record versions.
source /opt/cloister/lib.sh

for c in "${CL_COMPARTMENTS[@]}" dispo-template; do incus stop "$c" --force >/dev/null 2>&1 || true; done
apt-get clean
{
  echo "built: $(date -u +%FT%TZ)"
  echo "arch: $(dpkg --print-architecture)"
  incus list -c n -f csv | sed 's/^/compartment: /'
} > "$CL_STATE/build-info"
# The launcher's seed server is gone after the build, and the VM never needs cloud-init again.
touch /etc/cloud/cloud-init.disabled
rm -f "$CL_STATE/seed-url"
