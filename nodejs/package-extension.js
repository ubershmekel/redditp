#!/usr/bin/env node
// Packages browser-extension/ into store-ready zips under build/.
// Stages the shipped files first so nothing extra (README, editor cruft) ends
// up in the upload.
//
// Usage: node nodejs/package-extension.js [chrome|firefox|all]

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "browser-extension");
const buildDir = path.join(root, "build");

// Everything the extension actually needs at runtime: the files manifest.json
// loads, plus the pages the extension opens itself (archive.html and what it
// loads), which the manifest does not list. Keep in sync with both.
const files = [
  "manifest.json",
  "background.js",
  "content.js",
  "auto-activate.js",
  "launcher.css",
  "presentation.css",
  "archive.html",
  "archive.js",
  "archive.css",
  "favicon.png",
  "icon-128.png",
];

// One source manifest, patched per store. Firefox MV3 has no service worker and
// AMO requires a stable add-on id.
const targets = {
  chrome: {
    stageName: "chrome-extension",
    zipName: (version) => `redditp-extension-v${version}.zip`,
    patchManifest: (manifest) => manifest,
  },
  firefox: {
    stageName: "firefox-extension",
    zipName: (version) => `redditp-extension-firefox-v${version}.zip`,
    patchManifest: (manifest) => {
      const patched = { ...manifest };
      patched.background = { scripts: ["background.js"] };
      // "Save to gallery" talks to a native helper that is installed for the
      // Chrome build only. Without the permission, the relay in background.js
      // answers that saving is not available.
      patched.permissions = (manifest.permissions || []).filter(
        (name) => name !== "nativeMessaging",
      );
      patched.browser_specific_settings = {
        gecko: {
          id: "presentation-mode@redditp.com",
          // 140 ESR is the first release that accepts data_collection_permissions.
          strict_min_version: "140.0",
          // The add-on keeps its settings and archives in the browser and
          // collects no personal data. Only the archive page, when the user
          // opens it, sends anything: the subreddit's name and dates, to the
          // public Arctic Shift archive, without cookies.
          data_collection_permissions: { required: ["none"] },
        },
        // Android needed one release longer for the data-collection key.
        gecko_android: { strict_min_version: "142.0" },
      };
      return patched;
    },
  },
};

// release-extension.js reads targets/files to describe a build without redoing
// this file's layout knowledge.
module.exports = { targets, files, srcDir, buildDir, readManifest };

if (require.main === module) {
  main();
}

function main() {
  const arg = (process.argv[2] || "chrome").toLowerCase();
  const names = arg === "all" ? Object.keys(targets) : [arg];

  for (const name of names) {
    if (!targets[name]) {
      console.error(`Unknown target: ${name}. Use chrome, firefox, or all.`);
      process.exit(1);
    }
  }

  const manifest = readManifest();
  for (const name of names) {
    packageTarget(name, manifest);
  }
}

function readManifest() {
  return JSON.parse(
    fs.readFileSync(path.join(srcDir, "manifest.json"), "utf8"),
  );
}

function packageTarget(name, manifest) {
  const target = targets[name];
  const stageDir = path.join(buildDir, target.stageName);
  const zipPath = path.join(buildDir, target.zipName(manifest.version));

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  for (const file of files) {
    const from = path.join(srcDir, file);
    if (!fs.existsSync(from)) {
      console.error(`Missing extension file: ${file}`);
      process.exit(1);
    }
    if (file === "manifest.json") continue;
    fs.copyFileSync(from, path.join(stageDir, file));
  }

  fs.writeFileSync(
    path.join(stageDir, "manifest.json"),
    JSON.stringify(target.patchManifest(manifest), null, 2) + "\n",
  );

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
    execFileSync("zip", ["-r", "-X", zipPath, "."], {
      cwd: stageDir,
      stdio: "inherit",
    });
  }

  const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(
    `Packaged ${name} v${manifest.version} -> ${path.relative(root, zipPath)} (${kb} KB)`,
  );
}
