// Builds QEMU command lines. Pure functions so every platform can be unit-tested anywhere.
import { accelerators, displayBackend } from "./platform.js";

export const SEED_PORT = 47815;
export const seedUrl = (port = SEED_PORT) => `http://10.0.2.2:${port}`;

/** QEMU's option parser treats "," as a separator; a literal comma is written ",,". */
export const escapeOpt = (value) => String(value).replaceAll(",", ",,");

function machineArgs({ arch, platform, firmware }) {
  const args = [];
  if (arch === "aarch64") {
    if (!firmware) throw new Error("UEFI firmware edk2-aarch64-code.fd was not found next to QEMU");
    args.push("-machine", "virt", "-cpu", platform === "win32" ? "max" : "host", "-bios", firmware);
  } else {
    args.push("-machine", "q35");
  }
  for (const accel of accelerators(platform)) args.push("-accel", accel);
  return args;
}

function displayArgs({ arch, platform, headless }) {
  if (headless) return ["-display", "none"];
  const gpu = arch === "aarch64" ? "virtio-gpu-pci" : "virtio-vga";
  return ["-device", gpu, "-display", displayBackend(platform), "-device", "qemu-xhci", "-device", "usb-tablet", "-device", "usb-kbd"];
}

/**
 * The core VM: OS disk + encrypted data disk, user-mode NAT (the host only ever sees
 * outbound connections), and during a build an SMBIOS pointer to the local seed server.
 */
export function coreVmArgs({ arch, platform, firmware, rootDisk, dataDisk, serialLog, memMB, cpus, build = false, seedPort = SEED_PORT, headless = false }) {
  const args = [
    "-name", "Cloister",
    ...machineArgs({ arch, platform, firmware }),
    "-m", String(memMB), "-smp", String(cpus),
    "-drive", `file=${escapeOpt(rootDisk)},if=none,id=root,format=qcow2,discard=unmap`,
    "-device", "virtio-blk-pci,drive=root,bootindex=0",
    "-drive", `file=${escapeOpt(dataDisk)},if=none,id=data,format=qcow2,discard=unmap`,
    "-device", "virtio-blk-pci,drive=data,serial=cloister-data",
    "-netdev", "user,id=n0", "-device", "virtio-net-pci,netdev=n0",
    "-device", "virtio-rng-pci",
    "-serial", `file:${serialLog}`,
    ...displayArgs({ arch, platform, headless }),
  ];
  if (build) args.push("-smbios", `type=1,serial=ds=nocloud;s=${seedUrl(seedPort)}/`);
  return args;
}

/**
 * The disposable VM. Changes are thrown away (-snapshot), there is no network card at all,
 * and the file arrives on a read-only virtual FAT disk built from a temporary folder.
 */
export function dispoVmArgs({ arch, platform, firmware, rootDisk, fileDir, serialLog, memMB, cpus, build = false, seedPort = SEED_PORT }) {
  const args = [
    "-name", "Cloister disposable",
    ...machineArgs({ arch, platform, firmware }),
    "-m", String(memMB), "-smp", String(cpus),
    "-drive", `file=${escapeOpt(rootDisk)},if=none,id=root,format=qcow2`,
    "-device", "virtio-blk-pci,drive=root,bootindex=0",
    "-device", "virtio-rng-pci",
    "-serial", `file:${serialLog}`,
    ...displayArgs({ arch, platform, headless: false }),
  ];
  if (build) {
    args.push("-netdev", "user,id=n0", "-device", "virtio-net-pci,netdev=n0");
    args.push("-smbios", `type=1,serial=ds=nocloud;s=${seedUrl(seedPort)}/`);
  } else {
    args.push("-snapshot", "-nic", "none");
    if (fileDir) {
      args.push("-drive", `file=fat:32:${escapeOpt(fileDir)},if=none,id=file,format=raw,readonly=on`);
      args.push("-device", "virtio-blk-pci,drive=file,serial=cloister-file");
    }
  }
  return args;
}

/** Copy-on-write OS disk on top of the downloaded Debian image, so the image stays pristine. */
export const overlayArgs = (base, target, size) => ["create", "-f", "qcow2", "-F", "qcow2", "-b", base, target, size];
export const blankDiskArgs = (target, size) => ["create", "-f", "qcow2", target, size];

/** Render a command line for display (dry runs, docs). */
export const shellQuote = (args) => args.map((a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replaceAll('"', '\\"')}"`)).join(" ");
