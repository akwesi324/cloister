# Cloister design

## Goals

1. Qubes-style compartmentalisation for security work, on a laptop that already runs Windows or macOS.
2. Never modify the host OS: no repartitioning, no boot changes, no drivers, no services. Everything is in one data folder.
3. Usable on 8 GB of RAM and a slow, unreliable connection.
4. One tool set covering offensive testing, SOC analysis and forensic investigation.

## Why not an installable OS or a live USB?

- A real OS install, even dual boot, changes the disk and boot loader, which goal 2 rules out.
- A live USB needs a reboot, and Apple Silicon Macs cannot boot ordinary Linux USB sticks.
- A VM runs alongside the host, on every platform, and can be deleted cleanly.

## Architecture

```
Host (Windows / macOS / Linux)
  cloister launcher (Node)
    ├─ seed server, 127.0.0.1:47815 (build only)
    └─ QEMU (WHPX / HVF / KVM, falling back to TCG)
        ├─ core VM: Debian 13 generic cloud image (copy-on-write overlay)
        │    root disk: OS only
        │    data disk: LUKS2 (Argon2id) → btrfs → Incus storage pool "clpool"
        │    Incus networks: clnet (NAT), cltor (no route), clvpn (no route)
        │    Xpra client per compartment → coloured-border windows on XFCE
        └─ disposable VM: Debian 13 overlay, run with -snapshot and no NIC
```

### Build pipeline

1. The launcher downloads `debian-13-generic-<arch>.qcow2` from cloud.debian.org with HTTP range resume, and verifies it against Debian's `SHA512SUMS`.
2. It creates a qcow2 overlay (the image is never modified) and an 80 GB sparse data disk.
3. QEMU boots with `-smbios type=1,serial=ds=nocloud;s=http://10.0.2.2:47815/`. cloud-init's NoCloud datasource fetches `user-data` from the launcher's loopback-only seed server. No ISO tooling is needed on the host.
4. cloud-init copies `guest/cloister` into `/opt/cloister` and enables `cloister-provision@core.service`.
5. The service runs `steps/core/*.sh` in order. Each step writes a marker when done, and the service restarts on failure, so power loss, reboots and dropped connections only pause the build.
6. The final step powers the VM off, and the launcher records the build as complete.

### Compartments

| Name | Base | Network | Colour | Purpose |
|---|---|---|---|---|
| sys-tor | Debian 13 | uplink + cltor | yellow | Transparent Tor gateway |
| sys-vpn | Debian 13 | uplink + clvpn | yellow | WireGuard/OpenVPN gateway, kill switch |
| vault | Debian 13 | **none, enforced** | black | Passwords, keys, case notes |
| pentest | Kali | direct | red | Offensive testing |
| soc | Kali | direct | orange | Detection, triage, NSM |
| forensics | Kali | none | purple | Evidence analysis |
| dispo-* | Debian 13 | tor (default) | grey | Ephemeral, deleted on stop |

All compartments are unprivileged Incus containers with `security.idmap.isolated=true`, so each maps root to a different, non-overlapping host UID range. Nesting and privileged mode are off. A `clean` snapshot is taken after provisioning; `cl reset` restores it.

### Networking

- **clnet** is a NAT bridge. "direct" compartments reach the internet through the core VM, then through QEMU's user-mode NAT on the host.
- **cltor** has no address on the core VM, so the only device on it with an uplink is sys-tor. sys-tor's nftables redirects client TCP SYNs to Tor's `TransPort` and DNS to `DNSPort`, drops all forwarding, and has `ip_forward=0`. A misconfigured client therefore gets no connectivity, never a clearnet leak. `IsolateClientAddr` gives every compartment separate circuits.
- **clvpn** works the same way with sys-vpn. Its forward chain only allows `eth1 → wg0/tun0`, so if the tunnel is down, client traffic has no permitted path. DNS for clients is answered by dnsmasq, whose only upstream is the provider's resolver (or 9.9.9.9) reached through the tunnel. Plain-DNS leaks on the uplink are dropped.
- NICs use `security.mac_filtering` against spoofing.

### Windows and the clipboard

Each compartment runs its own Xpra server on display `:100`, bound to the container's loopback. The core reaches it through an Incus proxy device: a Unix socket in `/run/cloister`, mode 0600, owned by the core's analyst user. Compartments therefore cannot read each other's windows or keystrokes, unlike a shared X server. The Xpra clipboard, file transfer, printing, audio and webcam are disabled on both ends. `cl clip` and `cl copy` are the only ways data moves, and both ask for confirmation, twice when the source is the vault.

### Disposables

- `cl dispose` makes an `--ephemeral` copy of `dispo-template/clean` with a random name, attaches it to Tor by default, and stops it when the program exits. Incus then deletes it.
- `cloister open <file>` copies the file into a temporary host folder, which QEMU exposes as a read-only virtual FAT disk. The VM starts with `-snapshot` (no writes reach the disk image) and `-nic none`, and is mounted `ro,noexec,nosuid,nodev`. The temporary folder is deleted when QEMU exits.

### Encryption

The data disk is LUKS2 with Argon2id. During the build a random 64-byte key in `/root` unlocks it, so unattended reboots work. The first-run wizard:

1. adds your passphrase;
2. tests it;
3. removes the build key slot;
4. shreds the key file;
5. switches `/etc/crypttab` to prompt at boot.

The root disk holds only the OS and contains no user data.

## Threat model

**Defends against:**

- A compromised tool, browser or document in one compartment reading another compartment's files, windows or clipboard.
- Network identity leaks from Tor-routed compartments: fail-closed gateway.
- Traffic leaving the VPN when the tunnel drops: kill switch.
- The vault ever touching a network: no NIC, enforced by `cl net`.
- Theft of the laptop or its disk image: the LUKS passphrase is required.
- Malicious files opened with `cloister open`: no network, read-only input, discarded VM.

**Does not defend against:**

- **A compromised host OS.** Windows or macOS can read VM memory and keystrokes. Qubes avoids this by being the host; Cloister cannot.
- **Kernel exploits between containers.** Compartments share the core VM's kernel, and a container escape reaches the core VM and the other compartments. For high-risk malware use `cloister open` (a separate VM) or a dedicated analysis machine.
- **Global adversaries against Tor**, or a malicious VPN provider.
- **Hardware attacks**, firmware implants, or cold-boot attacks while running.

## Resource budget (8 GB host)

| Component | RAM |
|---|---|
| Windows/macOS | ~3 GB |
| Core VM: kernel + XFCE + Incus | ~700 MB |
| Each running compartment | 50–300 MB idle; Burp/Ghidra/Firefox 0.5–1.5 GB |
| Disposable VM (when used) | 1.5 GB |

Compartments start on demand and stop with `cl stop`. Run one heavy tool at a time.
