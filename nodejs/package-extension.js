#!/usr/bin/env node
// Packages chrome-extension/ into a store-ready zip under build/.
// Stages the shipped files first so nothing extra (README, editor cruft) ends
// up in the upload.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "chrome-extension");
const buildDir = path.join(root, "build");

// Everything the extension actually needs at runtime. Keep in sync with manifest.json.
const files = [
  "manifest.json",
  "background.js",
  "content.js",
  "auto-activate.js",
  "presentation.css",
  "favicon.png",
];

const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, "manifest.json"), "utf8"));
const stageDir = path.join(buildDir, "chrome-extension");
const zipPath = path.join(buildDir, `redditp-extension-v${manifest.version}.zip`);

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

for (const file of files) {
  const from = path.join(srcDir, file);
  if (!fs.existsSync(from)) {
    console.error(`Missing extension file: ${file}`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(stageDir, file));
}

fs.rmSync(zipPath, { force: true });

if (process.platform === "win32") {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
        `[System.IO.Compression.ZipFile]::CreateFromDirectory('${stageDir}', '${zipPath}')`,
    ],
    { stdio: "inherit" },
  );
} else {
  // -X strips extra file attributes so the zip is reproducible across machines.
  execFileSync("zip", ["-r", "-X", zipPath, "."], { cwd: stageDir, stdio: "inherit" });
}

const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
console.log(`Packaged v${manifest.version} -> ${path.relative(root, zipPath)} (${kb} KB)`);
