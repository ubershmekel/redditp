#!/usr/bin/env node
// One command to ship a new extension version to both stores.
//
// Bumps chrome-extension/manifest.json, packages both zips, uploads and
// publishes the Chrome zip on the Web Store (publishing means "enters review"),
// and submits the Firefox zip to AMO's listed channel. Then commits and tags.
//
// Usage:
//   node nodejs/release-extension.js [patch|minor|major|<x.y.z>] [--dry-run]
//     [--skip-chrome] [--skip-firefox] [--no-git] [--restart]
//
// The bump defaults to patch. --dry-run packages for real, prints a full review
// of what would be shipped, and restores the manifest.
//
// A store rejecting a step is a normal outcome, not a crash: every step is
// attempted, what succeeded is recorded in build/release-state.json, and the
// run exits non-zero listing what is left. Re-running the same command resumes
// that version and skips the finished steps. --restart discards the state and
// bumps a fresh version instead.
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
const restart = flags.has("--restart");

for (const flag of flags) {
  if (
    ![
      "--dry-run",
      "--skip-chrome",
      "--skip-firefox",
      "--no-git",
      "--restart",
    ].includes(flag)
  ) {
    fail(`Unknown flag: ${flag}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// An interrupted release leaves the manifest already bumped and a state file
// naming the steps that landed. Recognizing that is what makes a re-run a
// resume rather than a second, half-shipped version.
const statePath = path.join(buildDir, "release-state.json");
const state = loadState();
const resuming = Boolean(state) && state.version === manifest.version;
const version = resuming
  ? state.version
  : nextVersion(manifest.version, bumpArg);
const done = new Set(resuming ? state.done : []);
const failures = [];

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
  const dirty = run("git", ["status", "--porcelain"], { capture: true })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // The manifest bump from the interrupted run is the one dirty file a resume
  // expects to find; anything else still means "commit or stash first".
  const onlyBump =
    resuming &&
    dirty.every((line) => line.endsWith("chrome-extension/manifest.json"));
  if (dirty.length && !onlyBump) {
    fail("Working tree is dirty. Commit or stash first.");
  }
}

if (resuming) {
  console.log(
    `Resuming v${version} (done: ${[...done].join(", ") || "nothing"})`,
  );
} else {
  console.log(`Releasing ${manifest.version} -> ${version}`);
}

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
  const chromeEnv = {
    // Same as web-ext below: the CLI only reads these bare names, so translate
    // rather than letting unprefixed secrets sit in .env or in argv.
    EXTENSION_ID: process.env.CHROME_EXTENSION_ID,
    CLIENT_ID: process.env.CHROME_CLIENT_ID,
    CLIENT_SECRET: process.env.CHROME_CLIENT_SECRET,
    REFRESH_TOKEN: process.env.CHROME_REFRESH_TOKEN,
  };
  // Upload and publish are two calls rather than one --auto-publish, because
  // the store gates publishing on dashboard fields the API cannot fill. Split,
  // a rejected publish leaves the uploaded draft alone and is what resumes.
  const uploaded = step(
    "chrome-upload",
    `upload ${path.basename(chromeZip)}`,
    () =>
      run(
        "npx",
        ["chrome-webstore-upload-cli", "upload", "--source", chromeZip],
        { env: chromeEnv },
      ),
  );
  if (uploaded) {
    step("chrome-publish", "publish (enters review)", () =>
      run("npx", ["chrome-webstore-upload-cli", "publish"], {
        env: chromeEnv,
      }),
    );
  }
}

if (doFirefox) {
  console.log("\n== Firefox Add-ons ==");
  step("firefox-sign", "sign and submit to the listed channel", () =>
    run(
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
        // AMO reviews listed submissions by hand; don't sit here waiting for
        // it. web-ext 10 dropped --no-wait-for-approval for this timeout.
        "--approval-timeout",
        "0",
      ],
      {
        // web-ext only reads its credentials from WEB_EXT_*.
        env: {
          WEB_EXT_API_KEY: process.env.FIREFOX_JWT_ISSUER,
          WEB_EXT_API_SECRET: process.env.FIREFOX_JWT_SECRET,
        },
      },
    ),
  );
}

const tag = `extension-v${version}`;

// Only tag what actually shipped: a commit and tag for a version a store
// refused would claim a release that does not exist. The resume run makes them.
if (doGit && !failures.length) {
  console.log("\n== git ==");
  step("git-commit", `commit Extension v${version}`, () => {
    run("git", ["add", manifestPath]);
    run("git", ["commit", "-m", `Extension v${version}`]);
  });
  step("git-tag", `tag ${tag}`, () => {
    if (git(["tag", "--list", tag]) === tag) return;
    run("git", ["tag", tag]);
  });
}

if (failures.length) {
  console.error(`\n== v${version} incomplete ==`);
  for (const id of done) console.error(`  done      ${id}`);
  for (const { label, hint } of failures) {
    console.error(`  FAILED    ${label}`);
    if (hint) console.error(`            ${hint}`);
  }
  if (doGit) {
    console.error(
      "  held back the release commit and tag until the rest lands",
    );
  }
  console.error(
    `\nFix the above and re-run the same command: it resumes v${version} and` +
      " skips what already landed.",
  );
  process.exit(1);
}

clearState();
console.log(
  `\nDone. v${version} submitted to ${
    doChrome && doFirefox ? "both stores" : "the store"
  } (pending review).`,
);
if (doGit) console.log(`Push with: git push && git push origin ${tag}`);

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

// One unit of shipping: skipped when an earlier run landed it, recorded the
// moment it lands, and on failure collected instead of thrown — one store
// rejecting a version should not decide whether the other one hears about it.
function step(id, label, body) {
  if (done.has(id)) {
    console.log(`  skipped   ${label} (done earlier)`);
    return true;
  }
  if (dryRun) {
    console.log(`  [dry-run] ${label}`);
    return true;
  }
  try {
    body();
    done.add(id);
    saveState();
    return true;
  } catch (error) {
    failures.push({ id, label, hint: hintFor(id) });
    saveState();
    console.error(`\n  ${label} failed: ${error.message}`);
    return false;
  }
}

// The one rejection that reads as a bug but is really a dashboard checklist.
function hintFor(id) {
  if (id !== "chrome-publish") return "";
  return (
    "if the store asked for privacy information, fill the Privacy practices" +
    " tab at https://chrome.google.com/webstore/devconsole — the uploaded" +
    " draft is already there, waiting to be published"
  );
}

function loadState() {
  if (dryRun || restart || !fs.existsSync(statePath)) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return Array.isArray(saved.done) ? saved : null;
  } catch (_error) {
    return null;
  }
}

function saveState() {
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify({ version, done: [...done] }, null, 2) + "\n",
  );
}

function clearState() {
  if (!dryRun && fs.existsSync(statePath)) fs.rmSync(statePath);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
