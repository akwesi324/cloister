import { test } from "node:test";
import assert from "node:assert/strict";
import { guestArch, accelerators, displayBackend, dataDir, findQemu, defaultSizing } from "../launcher/platform.js";
import { coreVmArgs, dispoVmArgs, escapeOpt, overlayArgs, seedUrl, SEED_PORT } from "../launcher/qemu.js";
import { parseSums, imageName } from "../launcher/images.js";

const opt = (args, flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));

test("architecture mapping", () => {
  assert.deepEqual(guestArch("x64"), { qemu: "x86_64", debian: "amd64" });
  assert.deepEqual(guestArch("arm64"), { qemu: "aarch64", debian: "arm64" });
  assert.throws(() => guestArch("ia32"));
  assert.equal(imageName("arm64"), "debian-13-generic-arm64.qcow2");
});

test("each host gets its native accelerator with a software fallback", () => {
  assert.deepEqual(accelerators("win32"), ["whpx,kernel-irqchip=off", "tcg"]);
  assert.deepEqual(accelerators("darwin"), ["hvf", "tcg"]);
  assert.deepEqual(accelerators("linux"), ["kvm", "tcg"]);
  assert.equal(displayBackend("darwin"), "cocoa");
});

test("data folder per OS, never inside the system", () => {
  assert.equal(dataDir("win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "C:\\Users\\a"), "C:\\Users\\a\\AppData\\Local\\Cloister");
  assert.match(dataDir("darwin", {}, "/Users/a"), /Library[\\/]Application Support[\\/]Cloister$/);
  assert.equal(dataDir("linux", { CLOISTER_HOME: "/x" }, "/home/a"), "/x");
});

test("findQemu needs both qemu-system and qemu-img, and firmware on arm64", () => {
  const files = new Set(["/opt/homebrew/bin/qemu-system-aarch64", "/opt/homebrew/bin/qemu-img", "/opt/homebrew/share/qemu/edk2-aarch64-code.fd"]);
  const exists = (p) => files.has(p.replaceAll("\\", "/").replace("/opt/homebrew/bin/../share", "/opt/homebrew/share"));
  const q = findQemu({ platform: "darwin", env: { PATH: "" }, arch: "aarch64", exists });
  assert.ok(q, "found");
  assert.ok(q.firmware.endsWith("edk2-aarch64-code.fd"));
  assert.equal(findQemu({ platform: "darwin", env: { PATH: "" }, arch: "x86_64", exists }), null);
});

test("VM sizing leaves the host room on an 8 GB machine", () => {
  const s = defaultSizing({ totalMB: 7987, cpus: 8 });
  assert.equal(s.coreMB, 4608);
  assert.ok(s.coreMB <= 7987 - 3072);
  assert.equal(s.cpus, 4);
  assert.equal(defaultSizing({ totalMB: 4096, cpus: 2 }).coreMB, 2048);
});

test("commas in paths are escaped for QEMU", () => {
  assert.equal(escapeOpt("C:\\a,b\\disk.qcow2"), "C:\\a,,b\\disk.qcow2");
});

const base = { platform: "win32", rootDisk: "C:\\vm\\root.qcow2", dataDisk: "C:\\vm\\data.qcow2", serialLog: "C:\\vm\\serial.log", memMB: 4096, cpus: 2 };

test("core VM: two disks, user-mode NAT, data disk has a stable serial", () => {
  const args = coreVmArgs({ ...base, arch: "x86_64" });
  assert.deepEqual(opt(args, "-accel"), ["whpx,kernel-irqchip=off", "tcg"]);
  assert.ok(opt(args, "-device").includes("virtio-blk-pci,drive=data,serial=cloister-data"));
  assert.deepEqual(opt(args, "-netdev"), ["user,id=n0"]);
  assert.equal(opt(args, "-smbios").length, 0, "no seed pointer outside builds");
  assert.ok(!args.includes("-snapshot"));
});

test("core build points cloud-init at the loopback seed server", () => {
  const args = coreVmArgs({ ...base, arch: "x86_64", build: true });
  assert.deepEqual(opt(args, "-smbios"), [`type=1,serial=ds=nocloud;s=http://10.0.2.2:${SEED_PORT}/`]);
  assert.equal(seedUrl(1234), "http://10.0.2.2:1234");
});

test("arm64 uses the virt machine, UEFI firmware and virtio-gpu", () => {
  const args = coreVmArgs({ ...base, platform: "darwin", arch: "aarch64", firmware: "/fw/edk2-aarch64-code.fd" });
  assert.deepEqual(opt(args, "-machine"), ["virt"]);
  assert.deepEqual(opt(args, "-bios"), ["/fw/edk2-aarch64-code.fd"]);
  assert.deepEqual(opt(args, "-accel"), ["hvf", "tcg"]);
  assert.ok(opt(args, "-device").includes("virtio-gpu-pci"));
  assert.throws(() => coreVmArgs({ ...base, platform: "darwin", arch: "aarch64" }), /firmware/);
});

test("disposable VM: no network, changes discarded, file read-only", () => {
  const args = dispoVmArgs({ ...base, arch: "x86_64", fileDir: "C:\\Temp\\cloister-open-x" });
  assert.ok(args.includes("-snapshot"));
  assert.deepEqual(opt(args, "-nic"), ["none"]);
  assert.equal(opt(args, "-netdev").length, 0);
  const file = opt(args, "-drive").find((d) => d.startsWith("file=fat:"));
  assert.match(file, /readonly=on/);
  assert.ok(opt(args, "-device").includes("virtio-blk-pci,drive=file,serial=cloister-file"));
});

test("disposable build has network (to install viewers) and keeps changes", () => {
  const args = dispoVmArgs({ ...base, arch: "x86_64", build: true });
  assert.ok(!args.includes("-snapshot"));
  assert.deepEqual(opt(args, "-netdev"), ["user,id=n0"]);
});

test("overlay disk keeps the Debian image untouched", () => {
  assert.deepEqual(overlayArgs("base.qcow2", "root.qcow2", "24G"), ["create", "-f", "qcow2", "-F", "qcow2", "-b", "base.qcow2", "root.qcow2", "24G"]);
});

test("SHA512SUMS parsing", () => {
  const h = "a".repeat(128);
  const sums = parseSums(`${h}  debian-13-generic-amd64.qcow2\r\n${"b".repeat(128)} *debian-13-generic-arm64.qcow2\nnot a line\n`);
  assert.equal(sums.get("debian-13-generic-amd64.qcow2"), h);
  assert.equal(sums.get("debian-13-generic-arm64.qcow2"), "b".repeat(128));
  assert.equal(sums.size, 2);
});
