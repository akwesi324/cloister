#!/bin/bash
# Core VM base system: lightweight desktop, Incus, Xpra client, disk encryption tools.
source /opt/cloister/lib.sh

cat > /etc/apt/apt.conf.d/80cloister <<'EOF'
Acquire::Retries "10";
Acquire::http::Timeout "60";
Acquire::https::Timeout "60";
APT::Install-Recommends "false";
EOF

retry apt-get update
retry apt-get -y full-upgrade
apt_install \
  xfce4 xfce4-terminal xfce4-whiskermenu-plugin thunar mousepad lightdm lightdm-gtk-greeter \
  xserver-xorg-video-all xserver-xorg-input-all dbus-x11 fonts-dejavu adwaita-icon-theme \
  incus btrfs-progs cryptsetup nftables dnsmasq-base \
  xclip zenity curl ca-certificates gnupg qemu-guest-agent spice-vdagent \
  locales sudo less nano htop jq
bash -c "$(install_xpra_cmds)"
# Only the Xpra client is needed here; switch off the system-wide server the package enables.
systemctl disable --now xpra-server.socket xpra-server.service >/dev/null 2>&1 || true

# Show boot messages and the disk passphrase prompt in the VM window (tty0), not on the
# serial port: the last console= on the kernel line is the one that receives prompts.
for f in /etc/default/grub /etc/default/grub.d/*.cfg; do
  [ -f "$f" ] || continue
  sed -i -E 's/console=tty0 ?//g; s/console=ttyS0(,[0-9]+)?/console=ttyS0,115200 console=tty0/g' "$f"
done
update-grub

systemctl enable qemu-guest-agent || true
