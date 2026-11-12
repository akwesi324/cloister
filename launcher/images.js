// Downloads the official Debian 13 cloud image with resume support (slow or flaky links
// keep their progress) and verifies it against Debian's published SHA-512 list.
import fs from "node:fs";
import https from "node:https";
import crypto from "node:crypto";
import path from "node:path";

export const DEBIAN_BASE = "https://cloud.debian.org/images/cloud/trixie/latest";
export const imageName = (debianArch) => `debian-13-generic-${debianArch}.qcow2`;

/** Parse a SHA512SUMS file ("<hex>  <name>" per line). */
export function parseSums(text) {
  const sums = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{128})\s+\*?(.+)$/i);
    if (m) sums.set(m[2].trim(), m[1].toLowerCase());
  }
  return sums;
}

function get(url, headers = {}, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "cloister-launcher", ...headers } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), headers, redirects - 1));
        return;
      }
      resolve(res);
    });
    req.setTimeout(60000, () => req.destroy(new Error("connection timed out")));
    req.on("error", reject);
  });
}

export async function fetchText(url) {
  const res = await get(url);
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`GET ${url} -> HTTP ${res.statusCode}`);
  }
  let body = "";
  res.setEncoding("utf8");
  for await (const chunk of res) body += chunk;
  return body;
}

/** Download url -> dest, resuming from dest.part. Retries on dropped connections. */
export async function download(url, dest, { onProgress = () => {}, attempts = 30 } = {}) {
  const part = `${dest}.part`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    try {
      const res = await get(url, have ? { Range: `bytes=${have}-` } : {});
      if (res.statusCode === 416) {
        res.resume();
        break; // already complete
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        throw new Error(`HTTP ${res.statusCode}`);
      }
      const resumed = res.statusCode === 206;
      const total = resumed
        ? Number((res.headers["content-range"] || "").split("/")[1]) || 0
        : Number(res.headers["content-length"]) || 0;
      let done = resumed ? have : 0;
      const out = fs.createWriteStream(part, { flags: resumed ? "a" : "w" });
      await new Promise((resolve, reject) => {
        res.on("data", (chunk) => {
          done += chunk.length;
          onProgress(done, total);
        });
        res.on("error", reject);
        res.on("aborted", () => reject(new Error("download interrupted")));
        out.on("error", reject);
        out.on("finish", resolve);
        res.pipe(out);
      });
      if (total && done < total) throw new Error("download ended early");
      break;
    } catch (err) {
      if (attempt === attempts) throw err;
      const wait = Math.min(60, attempt * 5);
      process.stderr.write(`\n  ${err.message}; resuming in ${wait}s (attempt ${attempt + 1}/${attempts})\n`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  fs.renameSync(part, dest);
}

export function sha512File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    fs.createReadStream(file).on("data", (d) => hash.update(d)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

/** Make sure the verified base image is in imagesDir; returns its path. */
export async function ensureBaseImage(imagesDir, debianArch, log = console.log) {
  fs.mkdirSync(imagesDir, { recursive: true });
  const name = imageName(debianArch);
  const dest = path.join(imagesDir, name);
  const okMarker = `${dest}.verified`;
  if (fs.existsSync(dest) && fs.existsSync(okMarker)) return dest;

  log(`Fetching Debian's checksum list...`);
  const expected = parseSums(await fetchText(`${DEBIAN_BASE}/SHA512SUMS`)).get(name);
  if (!expected) throw new Error(`${name} is not listed in Debian's SHA512SUMS`);

  if (!fs.existsSync(dest)) {
    log(`Downloading ${name} (about 450 MB; resumes if the connection drops)`);
    let last = 0;
    await download(`${DEBIAN_BASE}/${name}`, dest, {
      onProgress(done, total) {
        const now = Date.now();
        if (now - last < 1000) return;
        last = now;
        const pct = total ? ` ${((done / total) * 100).toFixed(1)}%` : "";
        process.stdout.write(`\r  ${(done / 2 ** 20).toFixed(0)} MB${pct}   `);
      },
    });
    process.stdout.write("\n");
  }
  log("Verifying SHA-512...");
  const actual = await sha512File(dest);
  if (actual !== expected) {
    fs.rmSync(dest);
    throw new Error(`Checksum mismatch for ${name}; the file was deleted. Run the build again.`);
  }
  fs.writeFileSync(okMarker, `${expected}\n`);
  return dest;
}
