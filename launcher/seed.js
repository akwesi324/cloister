// A tiny HTTP server that only listens on the host's loopback. During a build the VM reaches
// it as 10.0.2.2 (QEMU user networking) to fetch its cloud-init seed and the provisioning
// scripts, and reports progress back. Nothing is exposed to the network.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GUEST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "guest");
export const PROFILES = ["core", "dispo"];

/** Every file under guest/cloister, as forward-slash relative paths. */
export function manifest(root = path.join(GUEST_DIR, "cloister")) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out;
}

/**
 * A short fingerprint of the provisioning files. It becomes part of cloud-init's instance-id,
 * so when the scripts change between runs, the next boot fetches the new copies before the
 * build resumes. Unchanged scripts keep the same id and cloud-init does nothing new.
 */
export function guestFingerprint(root = path.join(GUEST_DIR, "cloister")) {
  const hash = crypto.createHash("sha256");
  for (const rel of manifest(root)) {
    hash.update(rel + "\0");
    hash.update(fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n"));
  }
  hash.update(fs.readFileSync(path.join(GUEST_DIR, "cloud-init", "user-data"), "utf8").replace(/\r\n/g, "\n"));
  return hash.digest("hex").slice(0, 12);
}

export function renderUserData(template, { seed, profile, hostname }) {
  if (!PROFILES.includes(profile)) throw new Error(`unknown profile ${profile}`);
  return template.replaceAll("@SEED@", seed).replaceAll("@PROFILE@", profile).replaceAll("@HOSTNAME@", hostname);
}

/** Resolve a requested file safely inside root (no ../ escapes). */
export function safeJoin(root, rel) {
  const target = path.resolve(root, rel);
  const base = path.resolve(root) + path.sep;
  return target.startsWith(base) ? target : null;
}

export function startSeedServer({ port, seed, profile, onProgress = () => {} }) {
  const root = path.join(GUEST_DIR, "cloister");
  const template = fs.readFileSync(path.join(GUEST_DIR, "cloud-init", "user-data"), "utf8");
  const hostname = profile === "core" ? "cloister" : "cloister-dispo";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://seed");
    const send = (code, body, type = "text/plain") => {
      res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(body);
    };
    if (req.method === "POST" && url.pathname === "/progress") {
      let body = "";
      req.on("data", (d) => (body += d.length < 4096 ? d : ""));
      req.on("end", () => {
        const p = new URLSearchParams(body);
        onProgress({ step: p.get("step") || "?", msg: p.get("msg") || "" });
        send(204, "");
      });
      return;
    }
    if (req.method !== "GET") return send(405, "method not allowed");
    switch (url.pathname) {
      case "/meta-data":
        return send(200, `instance-id: cloister-${profile}-${guestFingerprint(root)}\nlocal-hostname: ${hostname}\n`);
      case "/user-data":
        return send(200, renderUserData(template, { seed, profile, hostname }));
      case "/vendor-data":
        return send(200, "");
      case "/manifest":
        return send(200, manifest(root).join("\n") + "\n");
    }
    if (url.pathname.startsWith("/files/")) {
      const file = safeJoin(root, decodeURIComponent(url.pathname.slice("/files/".length)));
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, "not found");
      // Normalise line endings: a Windows checkout may have CRLF, which breaks bash.
      return send(200, fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), "application/octet-stream");
    }
    return send(404, "not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
