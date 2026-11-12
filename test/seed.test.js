import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { manifest, renderUserData, safeJoin, startSeedServer } from "../launcher/seed.js";

test("manifest lists the provisioning files with forward slashes", () => {
  const m = manifest();
  for (const f of ["lib.sh", "provision.sh", "bin/cl", "steps/core/10-base.sh", "steps/dispo/10-base.sh", "gateways/sys-tor/torrc", "tools/install-tools.sh"]) {
    assert.ok(m.includes(f), `${f} in manifest`);
  }
  assert.ok(m.every((f) => !f.includes("\\")));
});

test("user-data rendering fills every placeholder", () => {
  const out = renderUserData("@SEED@ @PROFILE@ @HOSTNAME@", { seed: "http://s", profile: "core", hostname: "cloister" });
  assert.equal(out, "http://s core cloister");
  assert.throws(() => renderUserData("", { seed: "", profile: "evil", hostname: "" }));
});

test("safeJoin refuses to leave the guest folder", () => {
  const root = path.resolve("guest");
  assert.ok(safeJoin(root, "bin/cl"));
  assert.equal(safeJoin(root, "../package.json"), null);
  assert.equal(safeJoin(root, "..\\..\\x"), process.platform === "win32" ? null : safeJoin(root, "..\\..\\x"));
});

test("seed server: cloud-init endpoints, LF-only files, progress, no traversal", async () => {
  const events = [];
  const server = await startSeedServer({ port: 0, seed: "http://10.0.2.2:1", profile: "core", onProgress: (e) => events.push(e) });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const ud = await (await fetch(`${base}/user-data`)).text();
    assert.ok(ud.startsWith("#cloud-config"));
    assert.ok(ud.includes("cloister-provision@core.service"));
    assert.ok(!ud.includes("@SEED@") && !ud.includes("@PROFILE@"));
    assert.match(await (await fetch(`${base}/meta-data`)).text(), /instance-id: cloister-core-[0-9a-f]{12}\n/);
    const cl = await (await fetch(`${base}/files/bin/cl`)).text();
    assert.ok(cl.startsWith("#!/bin/bash") && !cl.includes("\r"));
    assert.equal((await fetch(`${base}/files/..%2F..%2Fpackage.json`)).status, 404);
    const r = await fetch(`${base}/progress`, { method: "POST", body: "step=core-10-base&msg=done" });
    assert.equal(r.status, 204);
    assert.deepEqual(events, [{ step: "core-10-base", msg: "done" }]);
    // Only reachable on loopback.
    assert.equal(server.address().address, "127.0.0.1");
  } finally {
    server.close();
  }
});
