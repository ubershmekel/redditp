#!/usr/bin/env node
// One command to ship a new extension version to both stores.
//
// Bumps chrome-extension/manifest.json, packages both zips, uploads the Chrome
// zip to the Web Store (auto-published, which means "enters review"), and
// submits the Firefox zip to AMO's listed channel. Then commits and tags.
//
// Usage:
//   node nodejs/release-extension.js [patch|minor|major|<x.y.z>] [--dry-run]
//     [--skip-chrome] [--skip-firefox] [--no-git]
//
// The bump defaults to patch. --dry-run packages for real, prints a full review
// of what would be shipped, and restores the manifest.
//
// Credentials come from .env in the repo root (gitignored) or the environment:
//   CHROME_EXTENSION_ID CHROME_CLIENT_ID                 (Chrome Web Store API)
//   CHROME_CLIENT_SECRET CHROME_REFRESH_TOKEN
//   FIREFOX_JWT_ISSUER FIREFOX_JWT_SECRET                (AMO, from the dev hub)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const pkg = require("./package-extension.js");

const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "chrome-extension", "manifest.json");
const buildDir = path.join(root, "build");
const onWindows = process.platform === "win32";

const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const bumpArg = args.find((a) => !a.startsWith("--")) || "patch";
const dryRun = flags.has("--dry-run");
const doChrome = !flags.has("--skip-chrome");
const doFirefox = !flags.has("--skip-firefox");
const doGit = !flags.has("--no-git");

for (const flag of flags) {
  if (
    !["--dry-run", "--skip-chrome", "--skip-firefox", "--no-git"].includes(flag)
  ) {
    fail(`Unknown flag: ${flag}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = nextVersion(manifest.version, bumpArg);

// Fail before touching anything if a credential is missing — a half-shipped
// release (Chrome updated, Firefox not) is the annoying outcome to avoid.
const missing = [];
if (doChrome && !dryRun) {
  missing.push(
    ...[
      "CHROME_EXTENSION_ID",
      "CHROME_CLIENT_ID",
      "CHROME_CLIENT_SECRET",
      "CHROME_REFRESH_TOKEN",
    ].filter((k) => !process.env[k]),
  );
}
if (doFirefox && !dryRun) {
  missing.push(
    ...["FIREFOX_JWT_ISSUER", "FIREFOX_JWT_SECRET"].filter(
      (k) => !process.env[k],
    ),
  );
}
if (missing.length) {
  fail(`Missing credentials: ${missing.join(", ")}. See .env.example.`);
}

if (doGit && !dryRun) {
  const dirty = run("git", ["status", "--porcelain"], { capture: true }).trim();
  if (dirty) fail("Working tree is dirty. Commit or stash first.");
}

console.log(`Releasing ${manifest.version} -> ${version}`);

const originalManifest = fs.readFileSync(manifestPath, "utf8");
manifest.version = version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// A dry run should rehearse the real packaging, then leave no trace.
if (dryRun) {
  process.on("exit", () => fs.writeFileSync(manifestPath, originalManifest));
}

run(process.execPath, [path.join(__dirname, "package-extension.js"), "all"]);

if (dryRun) review(version);

const chromeZip = path.join(buildDir, `redditp-extension-v${version}.zip`);
const firefoxDir = path.join(buildDir, "firefox-extension");

if (doChrome) {
  console.log("\n== Chrome Web Store ==");
  runMaybe(
    "npx",
    [
      "chrome-webstore-upload-cli",
      "upload",
      "--source",
      chromeZip,
      "--auto-publish",
    ],
    {
      // Same as web-ext below: the CLI only reads these bare names, so translate
      // rather than letting unprefixed secrets sit in .env or in argv.
      env: {
        EXTENSION_ID: process.env.CHROME_EXTENSION_ID,
        CLIENT_ID: process.env.CHROME_CLIENT_ID,
        CLIENT_SECRET: process.env.CHROME_CLIENT_SECRET,
        REFRESH_TOKEN: process.env.CHROME_REFRESH_TOKEN,
      },
    },
  );
}

if (doFirefox) {
  console.log("\n== Firefox Add-ons ==");
  runMaybe(
    "npx",
    [
      "web-ext",
      "sign",
      "--source-dir",
      firefoxDir,
      "--channel",
      "listed",
      "--artifacts-dir",
      buildDir,
      // AMO reviews listed submissions by hand; don't sit here waiting for it.
      "--no-wait-for-approval",
    ],
    {
      // web-ext only reads its credentials from WEB_EXT_*.
      env: {
        WEB_EXT_API_KEY: process.env.FIREFOX_JWT_ISSUER,
        WEB_EXT_API_SECRET: process.env.FIREFOX_JWT_SECRET,
      },
    },
  );
}

if (doGit) {
  console.log("\n== git ==");
  runMaybe("git", ["add", manifestPath]);
  runMaybe("git", ["commit", "-m", `Extension v${version}`]);
  runMaybe("git", ["tag", `extension-v${version}`]);
  console.log(`Push with: git push && git push origin extension-v${version}`);
}

console.log(`\nDone. v${version} submitted to both stores (pending review).`);

// Everything worth eyeballing before a real release: exact payloads, which
// listings they land on, and the git state you would be shipping from.
function review(version) {
  const line = (label, value) => console.log(`  ${label.padEnd(13)}${value}`);

  console.log("\n== Review ==");
  line("Version:", `${JSON.parse(originalManifest).version} -> ${version}`);

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(["log", "-1", "--format=%h %s"]);
  // The dry run skips the clean-tree gate, so say what the real run would hit.
  const dirty = git(["status", "--porcelain"])
    .split("\n")
    .filter(Boolean).length;
  line("Branch:", branch);
  line("HEAD:", head);
  line(
    "Tree:",
    dirty ? `${dirty} uncommitted file(s) — a real run would refuse` : "clean",
  );

  const tag = `extension-v${version}`;
  const tagExists = git(["tag", "--list", tag]).trim() === tag;
  line("Tag:", tagExists ? `${tag} — ALREADY EXISTS` : tag);

  for (const name of ["chrome", "firefox"]) {
    const skipped =
      (name === "chrome" && !doChrome) || (name === "firefox" && !doFirefox);
    const target = pkg.targets[name];
    const stageDir = path.join(pkg.buildDir, target.stageName);
    const staged = JSON.parse(
      fs.readFileSync(path.join(stageDir, "manifest.json"), "utf8"),
    );

    console.log(`\n  ${name.toUpperCase()}${skipped ? " (skipped)" : ""}`);
    if (name === "chrome") {
      line("Listing:", process.env.CHROME_EXTENSION_ID || "(unset)");
      line("Publish:", "auto-publish once review passes");
    } else {
      line("Listing:", staged.browser_specific_settings.gecko.id);
      line("Publish:", "channel listed (AMO review queue)");
    }

    const zip = path.join(pkg.buildDir, target.zipName(version));
    line("Zip:", `${path.basename(zip)} (${kb(fs.statSync(zip).size)})`);

    let total = 0;
    console.log(`  Contents:`);
    for (const file of pkg.files) {
      const size = fs.statSync(path.join(stageDir, file)).size;
      total += size;
      console.log(`    ${file.padEnd(20)} ${kb(size).padStart(9)}`);
    }
    console.log(`    ${"total".padEnd(20)} ${kb(total).padStart(9)} unpacked`);

    line("Permissions:", (staged.permissions || []).join(", ") || "(none)");
    line("Hosts:", (staged.host_permissions || []).join(", ") || "(none)");
  }
}

function git(gitArgs) {
  return run("git", gitArgs, { capture: true }).trim();
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const parts = current.split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    fail(`Cannot bump non-semver manifest version: ${current}`);
  }
  const [major, minor, patch] = parts;
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  fail(`Unknown bump: ${bump}. Use patch, minor, major, or x.y.z.`);
}

function quote(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function run(cmd, cmdArgs, { capture = false, env } = {}) {
  const needsShell = onWindows && cmd === "npx";
  const opts = {
    cwd: root,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    // npx is a .cmd shim on Windows, which execFileSync won't run without a
    // shell — so quote the args ourselves, since shell mode only concatenates
    // them. git and node are real exes and need no shell.
    shell: needsShell,
  };
  const out = execFileSync(
    cmd,
    needsShell ? cmdArgs.map(quote) : cmdArgs,
    opts,
  );
  return capture ? out.toString() : "";
}

function runMaybe(cmd, cmdArgs, opts) {
  if (dryRun) {
    console.log(`[dry-run] ${cmd} ${cmdArgs.join(" ")}`);
    return;
  }
  run(cmd, cmdArgs, opts);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
