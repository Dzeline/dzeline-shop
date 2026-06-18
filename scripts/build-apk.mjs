#!/usr/bin/env node
/**
 * Dzeline Shop — Android APK Builder Wizard
 *
 * Guides any user through generating, signing, and distributing the APK
 * without needing to know Android tooling.
 *
 * Usage (from repo root):
 *   npm run build-apk
 *   node scripts/build-apk.mjs
 */

import { execSync, spawnSync, spawn } from "child_process";
import { createInterface }            from "readline";
import { existsSync, readFileSync,
         writeFileSync, statSync }    from "fs";
import { join, dirname }              from "path";
import { fileURLToPath }              from "url";
import https                          from "https";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "..");

// ── ANSI colour helpers ───────────────────────────────────────────────────────

const R    = "\x1b[0m";
const bold = (s) => `\x1b[1m${s}${R}`;
const dim  = (s) => `\x1b[2m${s}${R}`;
const grn  = (s) => `\x1b[32m${s}${R}`;
const blu  = (s) => `\x1b[34m${s}${R}`;
const yel  = (s) => `\x1b[33m${s}${R}`;
const red  = (s) => `\x1b[31m${s}${R}`;
const cyn  = (s) => `\x1b[36m${s}${R}`;

const tick   = (s) => `  ${grn("✓")}  ${s}`;
const cross  = (s) => `  ${red("✗")}  ${s}`;
const arrow  = (s) => `  ${blu("→")}  ${s}`;
const caution = (s) => `  ${yel("!")}  ${s}`;

// ── Spinner ───────────────────────────────────────────────────────────────────

class Spin {
  #f = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  #i = 0; #t = null; #m = "";

  start(msg) {
    this.#m = msg;
    this.#t = setInterval(() =>
      process.stdout.write(`\r  ${cyn(this.#f[this.#i++ % 10])}  ${this.#m}    `), 80);
    return this;
  }
  ok(msg)   { clearInterval(this.#t); process.stdout.write(`\r${tick(msg ?? this.#m)}          \n`); }
  fail(msg) { clearInterval(this.#t); process.stdout.write(`\r${cross(msg ?? this.#m)}          \n`); }
  set(msg)  { this.#m = msg; return this; }
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

const ask = (q) =>
  new Promise((res) => rl.question(`  ${cyn("?")}  ${q}: `, res));

function askSecret(q) {
  return new Promise((res) => {
    process.stdout.write(`  ${cyn("?")}  ${q}: `);
    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let buf = "";
    const handler = (ch) => {
      if (ch === "\r" || ch === "\n") {
        if (isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", handler);
        process.stdout.write("\n");
        res(buf);
      } else if (ch === "") {
        process.exit(0);
      } else if (ch === "") {
        if (buf.length) { buf = buf.slice(0, -1); process.stdout.write("\b \b"); }
      } else {
        buf += ch;
        process.stdout.write("*");
      }
    };
    process.stdin.on("data", handler);
  });
}

const waitEnter = (msg) =>
  new Promise((res) => rl.question(`\n  ${yel("→")}  ${msg}\n     Press Enter when ready: `, res));

// ── Shell helpers ─────────────────────────────────────────────────────────────

function run(cmd, cwd = ROOT) {
  return execSync(cmd, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
}

function runArgs(bin, args, cwd = ROOT, opts = {}) {
  return spawnSync(bin, args, { cwd, stdio: "pipe", encoding: "utf8", shell: process.platform === "win32", ...opts });
}

function runInteractive(bin, args) {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, {
      cwd: ROOT, stdio: "inherit",
      shell: process.platform === "win32",
    });
    p.on("close", (code) => (code === 0 ? res() : rej(new Error(`${bin} exited with code ${code}`))));
  });
}

function fetchText(url) {
  return new Promise((res, rej) => {
    https.get(url, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res(d));
    }).on("error", rej);
  });
}

function fetchHead(url) {
  return new Promise((res, rej) => {
    const req = https.request(url, { method: "HEAD" }, (r) => res(r.statusCode));
    req.on("error", rej);
    req.end();
  });
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function box(lines, color = blu) {
  const raw  = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const w    = Math.max(...lines.map((l) => raw(l).length)) + 4;
  const rule = "─".repeat(w);
  const C    = (s) => `\x1b[34m${s}${R}`;
  console.log(C(`┌${rule}┐`));
  for (const l of lines) {
    const pad = w - raw(l).length - 2;
    console.log(`${C("│")}  ${l}${" ".repeat(Math.max(0, pad))}${C("│")}`);
  }
  console.log(C(`└${rule}┘`));
}

function section(n, total, title) {
  console.log(`\n${dim(`Step ${n}/${total}`)}  ${bold(title)}\n`);
}

function bail(msg) {
  console.log(`\n${caution(msg)}\n`);
  rl.close();
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Prerequisites
// ─────────────────────────────────────────────────────────────────────────────

async function checkPrereqs() {
  section(1, 5, "Checking prerequisites");

  // Node.js
  console.log(tick(`Node.js ${process.version}`));

  // Java / keytool
  const whichCmd = process.platform === "win32" ? "where keytool" : "which keytool";
  try {
    run(whichCmd);
    console.log(tick("Java / keytool found"));
  } catch {
    console.log(cross("Java not found"));
    bail(
      "Java JDK 17+ is required.\n" +
      "  Download from: https://adoptium.net\n" +
      "  Install it, then re-run: npm run build-apk"
    );
  }

  // bubblewrap
  const bw = runArgs("bubblewrap", ["--version"]);
  const bwFound = bw.status === 0 || /\d+\.\d+/.test(bw.stdout + bw.stderr);
  if (bwFound) {
    const ver = (bw.stdout || bw.stderr || "").match(/\d+\.\d+\.\d+/)?.[0] ?? "";
    console.log(tick(`bubblewrap CLI${ver ? " v" + ver : ""} found`));
  } else {
    const s = new Spin().start("Installing @bubblewrap/cli (one-time)...");
    try {
      run("npm install -g @bubblewrap/cli");
      s.ok("@bubblewrap/cli installed");
    } catch (e) {
      s.fail("Could not install bubblewrap");
      bail("Run manually: npm install -g @bubblewrap/cli\nThen re-run: npm run build-apk");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — App icons
// ─────────────────────────────────────────────────────────────────────────────

async function generateIcons() {
  section(2, 5, "Generating app icons");

  const icon512 = join(ROOT, "frontend/public/icons/icon-512.png");
  if (existsSync(icon512)) {
    console.log(tick("Icons already exist — skipping"));
    return;
  }

  const srcSvg = join(ROOT, "frontend/public/favicon.svg");
  if (!existsSync(srcSvg)) {
    bail(
      "frontend/public/favicon.svg not found.\n" +
      "  Place your app icon there and re-run the wizard."
    );
  }

  const s = new Spin().start("Generating PNG icons from favicon.svg...");

  // Ensure sharp is installed in frontend/node_modules
  const sharpDir = join(ROOT, "frontend/node_modules/sharp");
  if (!existsSync(sharpDir)) {
    s.set("Installing icon generation dependency (sharp)...");
    try {
      run("npm install", join(ROOT, "frontend"));
    } catch (e) {
      s.fail("npm install failed in frontend/");
      bail(`Error: ${e.message}`);
    }
  }

  try {
    run("node scripts/gen-icons.mjs", join(ROOT, "frontend"));
    s.ok("8 PNG icons written to frontend/public/icons/");
  } catch (e) {
    s.fail("Icon generation failed");
    bail(`Error: ${e.message}\n  Try manually: cd frontend && npm run generate-icons`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Signing keystore + assetlinks.json
// ─────────────────────────────────────────────────────────────────────────────

async function setupKeystore() {
  section(3, 5, "Setting up signing certificate");

  const ksPath = join(ROOT, "android.keystore");
  const alPath = join(ROOT, "frontend/public/.well-known/assetlinks.json");
  let pass = "";

  // ── Create keystore if it doesn't exist ──────────────────────────────────

  if (!existsSync(ksPath)) {
    console.log(arrow("No keystore found — creating one now."));
    console.log(dim("  You will need this password for every future release.\n"));

    pass = await askSecret("Set a keystore password (min 6 chars)");
    if (pass.length < 6) bail("Password must be at least 6 characters.");

    const pass2 = await askSecret("Confirm password");
    if (pass !== pass2) bail("Passwords do not match. Re-run the wizard.");

    const owner = await ask("Your name or organisation  (e.g. Dzeline Ltd)");

    const s = new Spin().start("Generating signing keystore...");
    // Password passed via env var so it never appears in process args (/proc/pid/cmdline)
    const r = runArgs("keytool", [
      "-genkey", "-v",
      "-keystore", ksPath,
      "-alias",   "dzeline",
      "-keyalg",  "RSA", "-keysize", "2048", "-validity", "10000",
      "-storepass:env", "DZELINE_KS_PASS",
      "-keypass:env",   "DZELINE_KS_PASS",
      "-dname",   `CN=${owner}, OU=App, O=${owner}, L=Nairobi, ST=Nairobi, C=KE`,
    ], ROOT, { env: { ...process.env, DZELINE_KS_PASS: pass } });

    if (r.status !== 0) {
      s.fail("keytool failed");
      bail(r.stderr || "Unknown keytool error");
    }
    s.ok("Keystore saved  →  android.keystore  (keep this file safe)");

  } else {
    console.log(tick("Keystore already exists"));
    console.log(dim("  Asking for password to read the certificate fingerprint.\n"));
    pass = await askSecret("Enter keystore password");
  }

  // ── Extract SHA-256 fingerprint ───────────────────────────────────────────

  const s2 = new Spin().start("Reading certificate fingerprint...");
  const out = runArgs("keytool", [
    "-list", "-v",
    "-keystore", ksPath,
    "-alias",    "dzeline",
    "-storepass:env", "DZELINE_KS_PASS",
  ], ROOT, { env: { ...process.env, DZELINE_KS_PASS: pass } });

  if (out.status !== 0) {
    s2.fail("Could not read keystore");
    bail("Wrong password, or the keystore is corrupt.");
  }

  const m = (out.stdout + out.stderr).match(
    /SHA256:\s*((?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2})/
  );
  if (!m) {
    s2.fail("SHA-256 fingerprint not found in keytool output");
    bail("Unexpected keytool output. Please file an issue.");
  }

  const fp = m[1].toUpperCase();
  s2.ok(`Fingerprint: ${dim(fp.slice(0, 23) + "…")}`);

  // ── Patch assetlinks.json ─────────────────────────────────────────────────

  const al = JSON.parse(readFileSync(alPath, "utf8"));
  al[0].target.sha256_cert_fingerprints = [fp];
  writeFileSync(alPath, JSON.stringify(al, null, 2) + "\n");
  console.log(tick("assetlinks.json updated with real fingerprint"));
  console.log(caution("You must deploy the frontend before the next step."));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Deploy frontend & verify assetlinks
// ─────────────────────────────────────────────────────────────────────────────

async function verifyAssetLinks() {
  section(4, 5, "Deploy frontend & verify Digital Asset Link");

  console.log(arrow("The updated assetlinks.json must be reachable at:"));
  console.log(`     ${cyn("https://dzeline.online/.well-known/assetlinks.json")}`);
  console.log(dim("\n  Push your frontend to Vercel (git push), then come back here.\n"));

  await waitEnter("Once the deploy is complete");

  const url = "https://dzeline.online/.well-known/assetlinks.json";
  const s = new Spin().start("Verifying assetlinks.json is live...");

  try {
    const body = await fetchText(url);
    const data = JSON.parse(body);
    const liveFp = data?.[0]?.target?.sha256_cert_fingerprints?.[0] ?? "";

    if (!liveFp || liveFp === "REPLACE_WITH_YOUR_SHA256_FINGERPRINT") {
      s.fail("Live assetlinks.json still has the placeholder fingerprint");
      bail("The old version is cached. Wait a minute and re-run, or check your Vercel deploy.");
    }
    s.ok("assetlinks.json is live and contains the real fingerprint ✓");

    // Verify icon is reachable — bubblewrap init fetches it from the manifest URL.
    // A missing icon causes a silent failure with no useful error message.
    const iconUrl = "https://dzeline.online/icons/icon-512.png";
    const si = new Spin().start(`Checking icon is reachable…`);
    try {
      const status = await fetchHead(iconUrl);
      if (status >= 200 && status < 400) {
        si.ok("App icon reachable ✓");
      } else {
        si.fail(`Icon returned HTTP ${status}`);
        bail(
          `${iconUrl} is not accessible (HTTP ${status}).\n` +
          "  Run  cd frontend && npm run generate-icons  then push the frontend, and re-run the wizard."
        );
      }
    } catch (iconErr) {
      si.fail("Could not reach app icon");
      bail(
        `${iconUrl} is unreachable: ${iconErr.message}\n` +
        "  Run  cd frontend && npm run generate-icons  then push the frontend, and re-run the wizard."
      );
    }
  } catch (e) {
    s.fail(`Could not reach ${url}`);
    console.log(caution(`Network error: ${e.message}`));
    const cont = await ask(
      "Continue anyway? The APK will still work, but will show browser chrome until assetlinks is live. (y/N)"
    );
    if (cont.toLowerCase() !== "y") {
      console.log("\nRe-run the wizard once the deploy is complete.\n");
      rl.close();
      process.exit(0);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — Build APK
// ─────────────────────────────────────────────────────────────────────────────

async function buildApk() {
  section(5, 5, "Building the APK");

  const appDir = join(ROOT, "app");
  const isFirst = !existsSync(appDir);

  if (isFirst) {
    console.log(arrow("First build — initialising Android project."));
    console.log(caution(
      "bubblewrap may download the Android SDK (~1 GB) if not already installed.\n" +
      "  This only happens once. Please be patient.\n"
    ));
    try {
      await runInteractive("bubblewrap", [
        "init", "--manifest", "https://dzeline.online/manifest.webmanifest",
      ]);
    } catch (e) {
      bail(`bubblewrap init failed: ${e.message}`);
    }
    console.log("");
  }

  console.log(arrow("Running Gradle build — output below:\n"));

  try {
    await runInteractive("bubblewrap", ["build"]);
  } catch (e) {
    bail(`bubblewrap build failed: ${e.message}`);
  }

  // Locate the output APK
  const candidates = [
    join(ROOT, "app-release-signed.apk"),
    join(ROOT, "app/build/outputs/apk/release/app-release-signed.apk"),
    join(ROOT, "app/build/outputs/apk/release/app-release.apk"),
  ];
  const apkPath = candidates.find(existsSync);
  const apkSize = apkPath
    ? `${(statSync(apkPath).size / 1_048_576).toFixed(1)} MB`
    : "see output above";

  // ── Success screen ────────────────────────────────────────────────────────

  const lines = [
    bold("  APK built successfully!"),
    "",
    apkPath
      ? `  File: ${dim(apkPath.replace(ROOT + "/", ""))}  ${dim("(" + apkSize + ")")}`
      : "  APK generated (see bubblewrap output above for path)",
    "",
    `  ${bold("Distribute:")}`,
    "  1. Upload the APK to GitHub Releases, Google Drive, or any URL",
    "  2. Share the download link with users via WhatsApp or SMS",
    "  3. User taps link → taps Install → app is on their phone",
    "",
    `  ${bold("Next release:")}`,
    "  Bump appVersionCode in twa-manifest.json, then run:",
    `  ${cyn("npm run build-apk")}`,
  ];

  console.log("");
  box(lines);
  console.log("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  box([
    bold("  Dzeline Shop  —  Android APK Builder"),
    dim("  Packages your PWA into a native Android app"),
    "",
    dim("  Estimated time: 5–10 min (first run may take longer)"),
    dim("  You will need: Java JDK 17+ and an internet connection"),
  ]);

  try {
    await checkPrereqs();
    await generateIcons();
    await setupKeystore();
    await verifyAssetLinks();
    await buildApk();
  } catch (e) {
    console.log(`\n${cross("Unexpected error: " + e.message)}\n`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
