#!/bin/bash
# Core desktop: a "Cloister" menu with an entry per compartment, and the first-run wizard.
source /opt/cloister/lib.sh

install -m 0755 "$CL_DIR/bin/cl" /usr/local/bin/cl
install -m 0755 "$CL_DIR/bin/cloister-firstrun" /usr/local/sbin/cloister-firstrun

apps=/usr/share/applications
entry() { # file name exec icon
  cat > "$apps/cloister-$1.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$2
Exec=$3
Icon=$4
Terminal=false
Categories=X-Cloister;
EOF
}
for c in "${CL_COMPARTMENTS[@]}"; do
  entry "$c-term" "$c: Terminal" "cl term $c" utilities-terminal
  entry "$c-files" "$c: Files" "cl files $c" system-file-manager
done
entry pentest-burp "pentest: Burp Suite" "cl run pentest burpsuite" applications-internet
entry pentest-firefox "pentest: Firefox" "cl run pentest firefox-esr" web-browser
entry soc-wireshark "soc: Wireshark" "cl run soc wireshark" network-wired
entry soc-firefox "soc: Firefox (CyberChef)" "cl run soc firefox-esr /usr/share/cyberchef/index.html" web-browser
entry forensics-autopsy "forensics: Ghidra" "cl run forensics ghidra" applications-science
entry vault-keepass "vault: KeePassXC" "cl run vault keepassxc" dialog-password
entry dispo-tor "Disposable: Tor browser session" "cl dispose --net tor firefox-esr" security-high
entry dispo-term "Disposable: terminal (no network)" "cl dispose --net none xfce4-terminal" utilities-terminal
entry list "Cloister: status" "xfce4-terminal --hold -e 'bash -c \"cl list; echo; cl tor status\"'" dialog-information

mkdir -p /etc/xdg/menus/applications-merged /usr/share/desktop-directories
cat > /usr/share/desktop-directories/cloister.directory <<'EOF'
[Desktop Entry]
Type=Directory
Name=Cloister
Icon=security-high
EOF
cat > /etc/xdg/menus/applications-merged/cloister.menu <<'EOF'
<!DOCTYPE Menu PUBLIC "-//freedesktop//DTD Menu 1.0//EN" "http://www.freedesktop.org/standards/menu-spec/1.0/menu.dtd">
<Menu>
  <Name>Applications</Name>
  <Menu>
    <Name>Cloister</Name>
    <Directory>cloister.directory</Directory>
    <Include><Category>X-Cloister</Category></Include>
  </Menu>
</Menu>
EOF

# Log straight in until the wizard has set a real password and disk passphrase.
mkdir -p /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/50-cloister-firstrun.conf <<'EOF'
[Seat:*]
autologin-user=analyst
autologin-user-timeout=0
EOF

echo 'analyst ALL=(root) NOPASSWD: /usr/local/sbin/cloister-firstrun' > /etc/sudoers.d/cloister-firstrun
chmod 0440 /etc/sudoers.d/cloister-firstrun

mkdir -p /etc/xdg/autostart
cat > /etc/xdg/autostart/cloister-firstrun.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Cloister first-run setup
Exec=xfce4-terminal --title "Cloister setup" -e "sudo /usr/local/sbin/cloister-firstrun"
X-XFCE-Autostart-Override=true
EOF

systemctl set-default graphical.target
systemctl enable lightdm
