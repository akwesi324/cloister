#!/usr/bin/env node
// Cloister host launcher. Runs on Windows, macOS and Linux; it only creates files in its own
// data folder and starts QEMU. The installed operating system is never modified.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn, execFileSync } from "node:child_process";
import {
  guestArch, findQemu, qemuVersion, installHint, dataDir, hostResources, defaultSizing,
} from "../launcher/platform.js";
import { coreVmArgs, dispoVmArgs, overlayArgs, blankDiskArgs, shellQuote, SEED_PORT, seedUrl } from "../launcher/qemu.js";
import { ensureBaseImage, imageName } from "../launcher/images.js";
import { startSeedServer } from "../launcher/seed.js";

const HELP = `Cloister - compartmentalised security workstation

Usage: cloister <command> [options]

  doctor                 Check QEMU, acceleration, memory and disk space
  build [core|dispo]     Download Debian, then build the core VM (default) or the
                         disposable file-viewer VM. Safe to re-run: it resumes.
  start                  Start the core VM (unlock the encrypted disk at boot)
  open <file>            Open a file in a throwaway VM with no network. Everything
                         is discarded when the window closes.
  status                 Show what has been built
  remove <core|dispo>    Delete a VM's disks (asks first; --yes to skip)

Options:
  --ram <MB>   --cpus <n>   --dry-run (print the QEMU command)   --headless`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ram" || a === "--cpus") opts[a.slice(2)] = Number(argv[++i]);
    else if (a.startsWith("--")) opts[a.slice(2)] = true;
    else opts._.push(a);
  }
  return opts;
}

const root = dataDir();
const paths = {
  images: path.join(root, "images"),
  vm: (name) => path.join(root, "vms", name),
  state: path.join(root, "state.json"),
};
const readState = () => (fs.existsSync(paths.state) ? JSON.parse(fs.readFileSync(paths.state, "utf8")) : {});
const writeState = (s) => {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(paths.state, JSON.stringify(s, null, 2));
};

function requireQemu(arch, dryRun = false) {
  const q = findQemu({ arch });
  if (!q && dryRun) return { system: `qemu-system-${arch}`, img: "qemu-img", firmware: arch === "aarch64" ? "edk2-aarch64-code.fd" : null };
  if (!q) {
    console.error(`QEMU (qemu-system-${arch}) was not found.\n\n${installHint()}`);
    process.exit(2);
  }
  return q;
}

function runQemu(q, args, { dryRun }) {
  if (dryRun) {
    console.log(shellQuote([q.system, ...args]));
    return Promise.resolve(0);
  }
  return new Promise((resolve) => {
    const child = spawn(q.system, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`Could not start QEMU: ${err.message}`);
      resolve(1);
    });
  });
}

function sizing(opts) {
  const d = defaultSizing();
  return { coreMB: opts.ram || d.coreMB, dispoMB: opts.ram || d.dispoMB, cpus: opts.cpus || d.cpus };
}

function warnMemory(needMB) {
  const { freeMB } = hostResources();
  if (freeMB < needMB) {
    console.warn(`Note: only ${freeMB} MB of RAM is free and the VM wants ${needMB} MB. Close other apps if the host slows down.`);
  }
}

async function doctor() {
  const arch = guestArch();
  const res = hostResources();
  const q = findQemu({ arch: arch.qemu });
  const free = fs.statfsSync ? (() => {
    fs.mkdirSync(root, { recursive: true });
    const s = fs.statfsSync(root);
    return Math.round((s.bavail * s.bsize) / 2 ** 30);
  })() : null;
  const rows = [
    ["Host", `${os.type()} ${os.release()} (${process.arch})`],
    ["Guest images", `Debian 13 ${arch.debian}`],
    ["QEMU", q ? `${qemuVersion(q.system) || "found"} at ${q.dir}` : "NOT FOUND"],
    ["UEFI firmware", arch.qemu === "aarch64" ? (q?.firmware || "NOT FOUND") : "not needed (BIOS boot)"],
    ["RAM", `${res.totalMB} MB total, ${res.freeMB} MB free (core VM default ${defaultSizing(res).coreMB} MB)`],
    ["Disk", free == null ? "unknown" : `${free} GB free in ${root} (about 40 GB recommended)`],
  ];
  for (const [k, v] of rows) console.log(`${k.padEnd(14)} ${v}`);
  if (!q) console.log(`\n${installHint()}`);
  if (process.platform === "win32" && q) {
    console.log("\nAcceleration: QEMU uses Windows Hypervisor Platform when it is enabled and otherwise falls");
    console.log("back to software emulation (works, but much slower).");
    console.log(installHint().split("\n").slice(1).join("\n"));
  }
  if (res.totalMB < 7000) console.log("\nWarning: under 8 GB of RAM. Run one compartment at a time.");
}

async function build(profile, opts) {
  if (!["core", "dispo"].includes(profile)) throw new Error("build takes core or dispo");
  const arch = guestArch();
  const q = requireQemu(arch.qemu, opts["dry-run"]);
  const vmDir = paths.vm(profile);
  if (!opts["dry-run"]) fs.mkdirSync(vmDir, { recursive: true });
  const base = opts["dry-run"] ? path.join(paths.images, imageName(arch.debian)) : await ensureBaseImage(paths.images, arch.debian);
  const rootDisk = path.join(vmDir, "root.qcow2");
  const dataDisk = path.join(vmDir, "data.qcow2");
  if (!opts["dry-run"]) {
    if (!fs.existsSync(rootDisk)) execFileSync(q.img, overlayArgs(base, rootDisk, profile === "core" ? "24G" : "12G"), { stdio: "inherit" });
    if (profile === "core" && !fs.existsSync(dataDisk)) execFileSync(q.img, blankDiskArgs(dataDisk, "80G"), { stdio: "inherit" });
  }
  const size = sizing(opts);
  const common = { arch: arch.qemu, platform: process.platform, firmware: q.firmware, rootDisk, serialLog: path.join(vmDir, "serial.log"), cpus: size.cpus, build: true, seedPort: SEED_PORT };
  const args = profile === "core"
    ? coreVmArgs({ ...common, dataDisk, memMB: size.coreMB, headless: opts.headless })
    : dispoVmArgs({ ...common, memMB: size.dispoMB });

  const state = readState();
  let complete = false;
  const server = opts["dry-run"] ? null : await startSeedServer({
    port: SEED_PORT, seed: seedUrl(SEED_PORT), profile,
    onProgress({ step, msg }) {
      console.log(`  [${new Date().toLocaleTimeString()}] ${step}: ${msg}`);
      if (step === "provision" && msg === "complete") complete = true;
    },
  });
  console.log(`Building the ${profile} VM. The first build downloads several GB of tools and can take hours;`);
  console.log("closing the window pauses it, and `cloister build` picks up where it stopped.\n");
  if (!opts["dry-run"]) warnMemory(profile === "core" ? size.coreMB : size.dispoMB);
  const code = await runQemu(q, args, { dryRun: opts["dry-run"] });
  server?.close();
  if (opts["dry-run"]) return;
  if (complete) {
    state[profile] = { builtAt: new Date().toISOString(), arch: arch.debian };
    writeState(state);
    console.log(`\nThe ${profile} VM is ready.` + (profile === "core" ? " Start it with: cloister start" : " Use: cloister open <file>"));
  } else {
    console.log(`\nThe VM stopped before provisioning finished (exit ${code}). Run \`cloister build ${profile}\` to continue.`);
    console.log(`Log: ${path.join(vmDir, "serial.log")}`);
    process.exitCode = 1;
  }
}

async function start(opts) {
  const state = readState();
  if (!state.core && !opts["dry-run"]) throw new Error("The core VM has not been built yet. Run: cloister build");
  const arch = guestArch();
  const q = requireQemu(arch.qemu, opts["dry-run"]);
  const vmDir = paths.vm("core");
  const size = sizing(opts);
  warnMemory(size.coreMB);
  const args = coreVmArgs({
    arch: arch.qemu, platform: process.platform, firmware: q.firmware,
    rootDisk: path.join(vmDir, "root.qcow2"), dataDisk: path.join(vmDir, "data.qcow2"),
    serialLog: path.join(vmDir, "serial.log"), memMB: size.coreMB, cpus: size.cpus, headless: opts.headless,
  });
  process.exitCode = await runQemu(q, args, { dryRun: opts["dry-run"] });
}

async function openFile(file, opts) {
  if (!file) throw new Error("Usage: cloister open <file>");
  const src = path.resolve(file);
  if (!fs.statSync(src).isFile()) throw new Error(`${src} is not a file`);
  if (fs.statSync(src).size > 2 * 2 ** 30) throw new Error("Files over 2 GB are not supported by the disposable viewer");
  const state = readState();
  if (!state.dispo && !opts["dry-run"]) throw new Error("The disposable VM has not been built yet. Run: cloister build dispo");
  const arch = guestArch();
  const q = requireQemu(arch.qemu, opts["dry-run"]);
  const vmDir = paths.vm("dispo");
  // Hand over a copy, so nothing in the VM can ever write back to the original.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cloister-open-"));
  fs.copyFileSync(src, path.join(tmp, path.basename(src)));
  const size = sizing(opts);
  const args = dispoVmArgs({
    arch: arch.qemu, platform: process.platform, firmware: q.firmware, rootDisk: path.join(vmDir, "root.qcow2"),
    fileDir: tmp, serialLog: path.join(tmp, "serial.log"), memMB: size.dispoMB, cpus: size.cpus,
  });
  try {
    console.log(`Opening ${path.basename(src)} in a throwaway VM with no network. Close the window to discard it.`);
    process.exitCode = await runQemu(q, args, { dryRun: opts["dry-run"] });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function status() {
  const state = readState();
  console.log(`Data folder: ${root}`);
  for (const name of ["core", "dispo"]) {
    const s = state[name];
    console.log(`${name.padEnd(6)} ${s ? `built ${s.builtAt} (${s.arch})` : fs.existsSync(paths.vm(name)) ? "build in progress / unfinished" : "not built"}`);
  }
}

async function remove(name, opts) {
  if (!["core", "dispo"].includes(name)) throw new Error("remove takes core or dispo");
  const dir = paths.vm(name);
  if (!fs.existsSync(dir)) return console.log(`${name} has no disks.`);
  if (!opts.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Delete ${dir}? ${name === "core" ? "ALL compartments and the encrypted vault go with it. " : ""}Type "delete" to confirm: `);
    rl.close();
    if (answer.trim() !== "delete") return console.log("Cancelled.");
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const state = readState();
  delete state[name];
  writeState(state);
  console.log(`Removed ${name}.`);
}

const opts = parseArgs(process.argv.slice(2));
const [cmd, arg] = opts._;
try {
  if (!cmd || opts.help || cmd === "help") console.log(HELP);
  else if (cmd === "doctor") await doctor();
  else if (cmd === "build") await build(arg || "core", opts);
  else if (cmd === "start") await start(opts);
  else if (cmd === "open") await openFile(arg, opts);
  else if (cmd === "status") status();
  else if (cmd === "remove") await remove(arg, opts);
  else {
    console.error(`Unknown command: ${cmd}\n\n${HELP}`);
    process.exitCode = 2;
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
