// Syntax-check every guest shell script with `bash -n` and make sure none has CRLF endings
// or is missing its shebang. Runs wherever bash exists (Linux, macOS, Git Bash on Windows).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { manifest, GUEST_DIR } from "../launcher/seed.js";

const root = path.join(GUEST_DIR, "cloister");
const scripts = manifest(root).filter((f) => {
  const text = fs.readFileSync(path.join(root, f), "utf8");
  return f.endsWith(".sh") || text.startsWith("#!/bin/bash");
});

let failed = 0;
for (const rel of scripts) {
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, "utf8");
  const problems = [];
  if (!text.startsWith("#!/bin/bash")) problems.push("missing #!/bin/bash");
  try {
    execFileSync("bash", ["-n"], { input: text.replace(/\r\n/g, "\n"), stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    problems.push(String(err.stderr).trim());
  }
  if (problems.length) {
    failed++;
    console.log(`FAIL ${rel}\n  ${problems.join("\n  ")}`);
  } else {
    console.log(`ok   ${rel}`);
  }
}
console.log(`\n${scripts.length - failed}/${scripts.length} scripts pass`);
process.exitCode = failed ? 1 : 0;
