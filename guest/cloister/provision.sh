#!/bin/bash
# Runs every step of a profile in order. Finished steps leave a marker in /var/lib/cloister,
# so after a reboot, power cut or dropped connection the service simply resumes.
source /opt/cloister/lib.sh

profile=${1:?usage: provision.sh core|dispo}
[ -d "$CL_DIR/steps/$profile" ] || { log "unknown profile $profile"; exit 2; }

# If the VM was switched off in the middle of a package install, finish or undo it first;
# otherwise apt refuses to do anything until someone runs these by hand.
dpkg --configure -a || true
apt-get -f install -y || true

for script in "$CL_DIR/steps/$profile"/*.sh; do
  name="$profile-$(basename "$script" .sh)"
  if [ -e "$CL_STATE/done.$name" ]; then continue; fi
  progress "$name" "started"
  if ! bash "$script"; then
    progress "$name" "failed (will retry in a minute; see /var/log/cloister-provision.log)"
    exit 1
  fi
  touch "$CL_STATE/done.$name"
  progress "$name" "done"
done

progress provision complete
systemctl disable "cloister-provision@$profile.service" || true
# Hand control back to the launcher: it marks the build finished when the VM powers off.
systemctl --no-block poweroff
