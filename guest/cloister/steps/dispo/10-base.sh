#!/bin/bash
# Host-level disposable VM: a minimal desktop with viewers. At run time the launcher starts
# it with no network card and discards every change, so it never needs updating mid-use.
source /opt/cloister/lib.sh

cat > /etc/apt/apt.conf.d/80cloister <<'EOF'
Acquire::Retries "10";
APT::Install-Recommends "false";
EOF
retry apt-get update
retry apt-get -y full-upgrade
apt_install xfce4 xfce4-terminal thunar lightdm lightdm-gtk-greeter xserver-xorg-video-all \
  xserver-xorg-input-all dbus-x11 fonts-dejavu adwaita-icon-theme spice-vdagent zenity sudo
grep -vE '^\s*(#|$)' "$CL_DIR/tools/dispo.list" | sed -E 's/[[:space:]]+#.*//' | while read -r p; do
  apt-get install -y --no-install-recommends "$p" || log "dispo: $p unavailable"
done

for f in /etc/default/grub /etc/default/grub.d/*.cfg; do
  [ -f "$f" ] || continue
  sed -i -E 's/console=tty0 ?//g; s/console=ttyS0(,[0-9]+)?/console=ttyS0,115200 console=tty0/g' "$f"
done
update-grub

# No login: the whole VM is thrown away when the window closes.
mkdir -p /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/50-cloister.conf <<'EOF'
[Seat:*]
autologin-user=analyst
autologin-user-timeout=0
EOF

# The file arrives on a read-only virtual disk labelled cloister-file.
cat > /usr/local/bin/cloister-show-file <<'EOF'
#!/bin/bash
dev=/dev/disk/by-id/virtio-cloister-file
mnt=/media/cloister-file
for _ in $(seq 1 20); do [ -e "$dev" ] && break; sleep 0.5; done
if [ ! -e "$dev" ]; then zenity --info --text="No file was attached." 2>/dev/null || true; exit 0; fi
part=$dev; [ -e "$dev-part1" ] && part=$dev-part1
sudo /usr/bin/mount -o ro,noexec,nosuid,nodev "$part" "$mnt"
exec thunar "$mnt"
EOF
chmod 0755 /usr/local/bin/cloister-show-file
mkdir -p /media/cloister-file
echo 'analyst ALL=(root) NOPASSWD: /usr/bin/mount -o ro\,noexec\,nosuid\,nodev /dev/disk/by-id/virtio-cloister-file* /media/cloister-file' > /etc/sudoers.d/cloister-mount
chmod 0440 /etc/sudoers.d/cloister-mount
mkdir -p /etc/xdg/autostart
cat > /etc/xdg/autostart/cloister-show-file.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Show the file under inspection
Exec=/usr/local/bin/cloister-show-file
EOF

systemctl set-default graphical.target
systemctl enable lightdm
# No network at run time, so cloud-init has nothing to do after the build.
touch /etc/cloud/cloud-init.disabled
rm -f "$CL_STATE/seed-url"
