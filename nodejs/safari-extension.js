#!/usr/bin/env node
// Builds the Xcode project that ships the extension to Safari on iPhone, iPad,
// and Mac. Safari only installs web extensions packaged inside an app, so this
// stages browser-extension/ for Safari and runs Apple's converter on it.
//
// Usage: node nodejs/safari-extension.js
//
// Needs macOS with Xcode installed. The generated project references the
// staged files in build/safari-extension instead of copying them, so after
// editing browser-extension/ run `npm run ext:package:safari` and rebuild in
// Xcode; re-running this script regenerates the project from scratch.

const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const stageDir = path.join(root, "build", "safari-extension");
const projectDir = path.join(root, "build", "safari-xcode");

if (process.platform !== "darwin") {
  console.error(
    "Building the Safari extension needs macOS with Xcode. Run" +
      " `npm run ext:package:safari` here to stage build/safari-extension," +
      " then run this script on a Mac.",
  );
  process.exit(1);
}

execFileSync(
  process.execPath,
  [path.join(__dirname, "package-extension.js"), "safari"],
  { stdio: "inherit" },
);

execFileSync(
  "xcrun",
  [
    "safari-web-extension-converter",
    stageDir,
    "--project-location",
    projectDir,
    "--app-name",
    "Presentation Mode for Reddit",
    "--bundle-identifier",
    "com.redditp.presentation-mode",
    "--swift",
    "--force",
    "--no-open",
    "--no-prompt",
  ],
  { stdio: "inherit" },
);

console.log(
  `\nXcode project written to ${path.relative(root, projectDir)}.` +
    " Open it, pick the iOS or macOS scheme, set your signing team, and run.",
);
