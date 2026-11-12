#!/bin/bash
# Runs every step of a profile in order. Finished steps leave a marker in /var/lib/cloister,
# so after a reboot, power cut or dropped connection the service simply resumes.
# Everything is inside main(), which bash reads completely before running: that makes it
# safe for the refresh below to replace this very file while it runs.
source /opt/cloister/lib.sh

# Pull the launcher's current scripts (when it is reachable), so fixes made on the host
# apply on the next retry without rebuilding. Downloads go to a temporary folder first.
refresh_scripts() {
  [ -n "$SEED_URL" ] || return 1
  local tmp rel
  tmp=$(mktemp -d)
  curl -fsS -m 20 "$SEED_URL/manifest" -o "$tmp/.manifest" || { rm -rf "$tmp"; return 1; }
  while read -r rel; do
    [ -n "$rel" ] || continue
    mkdir -p "$tmp/$(dirname "$rel")"
    curl -fsS -m 60 --retry 5 --retry-all-errors -o "$tmp/$rel" "$SEED_URL/files/$rel" || { rm -rf "$tmp"; return 1; }
  done < "$tmp/.manifest"
  rm -f "$tmp/.manifest"
  if diff -rq "$tmp" "$CL_DIR" >/dev/null 2>&1; then rm -rf "$tmp"; return 1; fi
  cp -r "$tmp"/. "$CL_DIR"/
  find "$CL_DIR" -name '*.sh' -exec chmod 0755 {} +
  chmod 0755 "$CL_DIR"/bin/*
  rm -rf "$tmp"
  log "provisioning scripts updated from the launcher"
}

main() {
  local profile=${1:?usage: provision.sh core|dispo} script name

  if [ -z "${CL_REFRESHED:-}" ] && refresh_scripts; then
    CL_REFRESHED=1 exec "$CL_DIR/provision.sh" "$@"
  fi

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
  exit 0
}

main "$@"
exit
