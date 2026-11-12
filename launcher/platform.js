// Host detection: which OS/CPU we are on, where QEMU lives, which accelerator to use
// and where Cloister keeps its disks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Map Node's names onto the names used by QEMU and Debian. */
export function guestArch(nodeArch = process.arch) {
  if (nodeArch === "x64") return { qemu: "x86_64", debian: "amd64" };
  if (nodeArch === "arm64") return { qemu: "aarch64", debian: "arm64" };
  throw new Error(`Unsupported CPU architecture: ${nodeArch} (Cloister supports x64 and arm64)`);
}

/** Hardware accelerators in the order QEMU should try them. QEMU falls back to the next -accel on failure. */
export function accelerators(platform = process.platform) {
  if (platform === "win32") return ["whpx,kernel-irqchip=off", "tcg"];
  if (platform === "darwin") return ["hvf", "tcg"];
  return ["kvm", "tcg"];
}

/** Window backend that ships with the usual QEMU builds on each OS. */
export function displayBackend(platform = process.platform) {
  if (platform === "darwin") return "cocoa";
  if (platform === "win32") return "sdl";
  return "gtk";
}

export function dataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (env.CLOISTER_HOME) return env.CLOISTER_HOME;
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Cloister");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Cloister");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "cloister");
}

function candidateQemuDirs(platform, env) {
  const dirs = [];
  if (env.CLOISTER_QEMU_DIR) dirs.push(env.CLOISTER_QEMU_DIR);
  if (platform === "win32") dirs.push(path.join(env.ProgramFiles || "C:\\Program Files", "qemu"));
  if (platform === "darwin") dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin");
  dirs.push(...(env.PATH || "").split(path.delimiter).filter(Boolean));
  return [...new Set(dirs)];
}

/** Locate qemu-system-<arch>, qemu-img and the UEFI firmware (needed on arm64). */
export function findQemu({ platform = process.platform, env = process.env, arch = guestArch().qemu, exists = fs.existsSync } = {}) {
  const exe = platform === "win32" ? ".exe" : "";
  for (const dir of candidateQemuDirs(platform, env)) {
    const system = path.join(dir, `qemu-system-${arch}${exe}`);
    const img = path.join(dir, `qemu-img${exe}`);
    if (exists(system) && exists(img)) {
      const shareDirs = [path.join(dir, "share"), path.join(dir, "..", "share", "qemu"), dir];
      const firmware = arch === "aarch64"
        ? shareDirs.map((d) => path.join(d, "edk2-aarch64-code.fd")).find((f) => exists(f)) || null
        : null;
      return { dir, system, img, firmware };
    }
  }
  return null;
}

export function qemuVersion(systemPath) {
  try {
    const out = execFileSync(systemPath, ["--version"], { encoding: "utf8", timeout: 15000 });
    return (out.match(/version (\d+\.\d+(\.\d+)?)/) || [])[1] || "unknown";
  } catch {
    return null;
  }
}

export function installHint(platform = process.platform) {
  if (platform === "win32") {
    return [
      "Install QEMU:   winget install --id SoftwareFreedomConservancy.QEMU",
      "Then turn on hardware acceleration (admin PowerShell, then restart):",
      "  Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All",
    ].join("\n");
  }
  if (platform === "darwin") return "Install QEMU:   brew install qemu";
  return "Install QEMU:   sudo apt install qemu-system qemu-utils   (or your distribution's equivalent)";
}

export function hostResources() {
  return { totalMB: Math.round(os.totalmem() / 2 ** 20), freeMB: Math.round(os.freemem() / 2 ** 20), cpus: os.cpus().length };
}

/** Sensible VM sizes: leave the host at least ~3 GB and half its cores. */
export function defaultSizing({ totalMB, cpus } = hostResources()) {
  const coreMB = Math.max(2048, Math.min(6144, Math.floor((totalMB - 3072) / 512) * 512));
  return { coreMB, dispoMB: Math.min(1536, coreMB), cpus: Math.max(2, Math.min(4, Math.floor(cpus / 2))) };
}
