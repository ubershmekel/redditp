const urlsEl = document.getElementById("urls");
const logEl = document.getElementById("log");
const manualModeEl = document.getElementById("manualMode");
const skipDownloadedEl = document.getElementById("skipDownloaded");
const hostEl = document.getElementById("host");
const variantsEl = document.getElementById("variants");
const expandedCountEl = document.getElementById("expandedCount");
const startBtn = document.getElementById("start");
const nextBtn = document.getElementById("next");
const stopBtn = document.getElementById("stop");
const resetBtn = document.getElementById("reset");
const clearHistoryBtn = document.getElementById("clearHistory");
const progressTextEl = document.getElementById("progressText");
const progressBarEl = document.getElementById("progressBar");
const historyTextEl = document.getElementById("historyText");

const DEFAULT_VARIANT_IDS = ["hot"];

for (const variant of SORT_VARIANTS) {
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.value = variant.id;
  box.dataset.variant = "1";
  label.appendChild(box);
  label.appendChild(document.createTextNode(` ${variant.label}`));
  variantsEl.appendChild(label);
}

function variantBoxes() {
  return [...variantsEl.querySelectorAll("input[data-variant]")];
}

function selectedVariantIds() {
  return variantBoxes()
    .filter((box) => box.checked)
    .map((box) => box.value);
}

function setSelectedVariantIds(ids) {
  for (const box of variantBoxes()) box.checked = ids.includes(box.value);
}

function basePaths() {
  return urlsEl.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderExpandedCount() {
  const count = expandPaths(basePaths(), selectedVariantIds()).length;
  // Rough ETA at the 10s mean of background.js's 5-15s throttle.
  const minutes = Math.round((count * 10) / 60);
  expandedCountEl.textContent = `${count} URLs to fetch (~${minutes} min)`;
}

function renderLogs(logs) {
  logEl.textContent = (logs || []).join("\n");
  logEl.scrollTop = logEl.scrollHeight;
}

function renderManifest(manifest) {
  const count = Object.keys(manifest || {}).length;
  historyTextEl.textContent = count
    ? `manifest history: ${count} paths`
    : "manifest history: empty";
}

function renderJob(job) {
  nextBtn.disabled = !job || job.status !== "waiting-next";

  if (!job || !job.urlPaths || job.urlPaths.length === 0) {
    progressTextEl.textContent = "";
    progressBarEl.value = 0;
    progressBarEl.max = 1;
    return;
  }

  const total = job.urlPaths.length;
  const done = Math.min(job.index, total);
  progressBarEl.max = total;
  progressBarEl.value = done;
  progressTextEl.textContent = `${done}/${total} (ok=${job.okCount} failed=${job.failCount})`;
}

async function loadState() {
  const { urlPaths, variantIds, host, logs, job, manifest } =
    await chrome.storage.local.get([
      "urlPaths",
      "variantIds",
      "host",
      "logs",
      "job",
      "manifest",
    ]);
  if (host) hostEl.value = host;
  urlsEl.value = (
    urlPaths && urlPaths.length ? urlPaths : DEFAULT_URL_PATHS
  ).join("\n");
  setSelectedVariantIds(
    variantIds && variantIds.length ? variantIds : DEFAULT_VARIANT_IDS,
  );
  renderExpandedCount();
  renderLogs(logs);
  renderJob(job);
  renderManifest(manifest);
}

urlsEl.addEventListener("input", renderExpandedCount);
variantsEl.addEventListener("change", renderExpandedCount);

startBtn.addEventListener("click", async () => {
  const paths = basePaths();
  const variantIds = selectedVariantIds();
  if (!variantIds.length) {
    renderLogs(["Pick at least one sort variant."]);
    return;
  }

  const host = hostEl.value;
  await chrome.storage.local.set({ urlPaths: paths, variantIds, host });
  chrome.runtime.sendMessage({
    type: "start",
    urlPaths: expandPaths(paths, variantIds),
    manualMode: manualModeEl.checked,
    skipDownloaded: skipDownloadedEl.checked,
    host,
  });
});

nextBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "next" });
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop" });
});

resetBtn.addEventListener("click", () => {
  urlsEl.value = DEFAULT_URL_PATHS.join("\n");
  setSelectedVariantIds(DEFAULT_VARIANT_IDS);
  renderExpandedCount();
});

clearHistoryBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clear-history" });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.logs) renderLogs(changes.logs.newValue);
  if (changes.job) renderJob(changes.job.newValue);
  if (changes.manifest) renderManifest(changes.manifest.newValue);
});

loadState();
