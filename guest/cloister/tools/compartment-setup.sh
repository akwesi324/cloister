#!/bin/bash
# Runs inside every compartment: an unprivileged "analyst" user and a private Xpra display
# whose windows the core desktop shows with the compartment's coloured border.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  sudo xfce4-terminal thunar xclip dbus-x11 fonts-dejavu adwaita-icon-theme ca-certificates curl locales
bash /tmp/cl/install-xpra.sh

id analyst >/dev/null 2>&1 || useradd -m -u 1000 -s /bin/bash analyst
# Inside a compartment the analyst may administer it (install tools, capture packets).
echo 'analyst ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/analyst
chmod 0440 /etc/sudoers.d/analyst

cat > /etc/systemd/system/cloister-display.service <<'EOF'
[Unit]
Description=Cloister display (Xpra :100)
After=network.target

[Service]
User=analyst
Environment=XDG_RUNTIME_DIR=/tmp/xpra-run
ExecStartPre=/bin/mkdir -p /tmp/xpra-run
# Loopback only. The core VM reaches it through an Incus proxy socket that only the core's
# analyst user can open. Clipboard, file transfer, printing, audio and webcam are all off:
# data crosses compartments only through `cl clip` and `cl copy`.
ExecStart=/usr/bin/xpra start :100 --daemon=no --bind-tcp=127.0.0.1:14500 \
  --mdns=no --pulseaudio=no --notifications=no --webcam=no --printing=no \
  --file-transfer=no --open-files=no --clipboard=no --systemd-run=no
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable cloister-display.service
systemctl restart cloister-display.service
