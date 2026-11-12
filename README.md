# Cloister

A compartmentalised security workstation for **ethical hacking, SOC analysis and digital forensics**, inspired by Qubes OS, that runs **on top of Windows or macOS** without replacing, repartitioning or modifying the installed operating system.

Everything lives in one folder on your computer. Delete the folder and Cloister is gone.

```
 Windows / macOS (untouched)
 └─ cloister launcher ──► QEMU
     ├─ Core VM (Debian 13, encrypted data disk)
     │   ├─ sys-tor     Tor gateway            ┐ network gateways
     │   ├─ sys-vpn     VPN gateway + kill switch ┘
     │   ├─ vault       no network, ever       (black)
     │   ├─ pentest     offensive toolkit      (red)
     │   ├─ soc         detection & triage     (orange)
     │   ├─ forensics   evidence analysis      (purple, offline by default)
     │   └─ dispo-xxxx  throwaway, self-deleting (grey)
     └─ Disposable VM   opens one suspicious file, no network, discarded on close
```

## What you get

- **Compartments instead of one big toolbox.** A compromised browser in `pentest` cannot read the evidence in `forensics` or the keys in `vault`. Each compartment has its own filesystem, process space, user IDs and network.
- **Coloured window borders.** Every window carries its compartment's colour and name in the title, as in Qubes, so you always know where you are typing.
- **No shared clipboard or drag-and-drop.** Data crosses compartments only when you ask: `cl clip pentest soc` or `cl copy forensics:report.pdf vault`, each with a confirmation.
- **Per-compartment networking:** `direct`, `tor` (everything forced through Tor, nothing else can leave), `vpn` (WireGuard or OpenVPN, kill switch when the tunnel drops) or `none`.
- **Encrypted at rest.** All compartments sit on a LUKS2 (Argon2id) disk unlocked by a passphrase at boot.
- **Throwaway sessions.** `cl dispose` starts a fresh compartment (Firefox over Tor by default) that is destroyed when you close it. `cloister open file.pdf` opens a file in a separate VM with no network card that is discarded afterwards.
- **Tools:** about 120 tools across pentest, SOC and forensics. See [docs/TOOLS.md](docs/TOOLS.md).

## Requirements

| | Minimum | Comfortable |
|---|---|---|
| RAM | 8 GB (core VM gets ~4.5 GB) | 16 GB |
| Disk | 40 GB free | 80 GB |
| CPU | x64 (Intel/AMD) or Apple Silicon, virtualisation enabled | |
| Software | [Node.js](https://nodejs.org) 20+, [QEMU](https://www.qemu.org) 8+ | |

Windows: `winget install --id SoftwareFreedomConservancy.QEMU`, then enable **Windows Hypervisor Platform** (admin PowerShell: `Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All`, restart). Without it Cloister still runs, using slower software emulation.

macOS: `brew install qemu`. Hardware acceleration (HVF) is used automatically on Intel and Apple Silicon.

## Quick start

```sh
git clone https://github.com/akwesi324/cloister && cd cloister
node bin/cloister.js doctor        # checks QEMU, acceleration, RAM and disk
node bin/cloister.js build         # builds the core VM (resumable; first run takes hours)
node bin/cloister.js start         # boot: disk passphrase, then login
node bin/cloister.js build dispo   # optional: the disposable file viewer
node bin/cloister.js open evil.docx
```

The first build downloads Debian (about 450 MB, checksum-verified) and then several GB of tools. Closing the window or losing the connection only pauses it; run `build` again to continue.

On first login a wizard replaces the temporary password (`cloister`) and sets your **disk passphrase**. There is no recovery if you lose the passphrase.

## Inside the core VM

The **Cloister** menu has entries for every compartment. From a terminal:

```sh
cl list                         # compartments, state, network
cl term pentest                 # terminal in pentest
cl run soc wireshark
cl net pentest vpn              # route pentest through the VPN
cl vpn import ~/work.conf && cl vpn up
cl dispose                      # throwaway Firefox over Tor
cl dispose --net none xfce4-terminal
cl copy forensics:/home/analyst/case1/report.pdf vault
cl clip pentest soc
cl reset pentest                # back to the freshly built state
cl missing soc                  # tools unavailable on this CPU/release
```

## How it compares with Qubes OS

Cloister borrows Qubes' ideas (compartments, coloured labels, gateway VMs, disposables, explicit inter-compartment copy) but it is **not as strong**, and it is better to know why. See [docs/DESIGN.md](docs/DESIGN.md#threat-model).

- Qubes runs on bare metal with the Xen hypervisor. Cloister runs on Windows or macOS, so **the host OS can see everything**: a compromised host means a compromised Cloister.
- Compartments inside the core VM are **containers** sharing the core VM's Linux kernel (with isolated user-ID ranges). They are much lighter than Qubes' one-VM-per-qube, which is what makes this usable on 8 GB of RAM, but a kernel exploit inside one compartment could reach the others. The host-level disposable VM (`cloister open`) is a real VM boundary.

Use it for training, CTFs, authorised engagements and investigations where this trade-off is acceptable. Only test systems you have written permission to test.

## Project layout

```
bin/cloister.js        host launcher (Node, no dependencies)
launcher/              QEMU command lines, image download/verification, seed server
guest/cloud-init/      first-boot configuration
guest/cloister/        provisioning steps, gateways, tool lists, `cl` and the first-run wizard
docs/                  design, threat model, tools
test/                  unit tests (npm test) and shell syntax checks (npm run check:sh)
```

## License

MIT. © MaskedOps.
