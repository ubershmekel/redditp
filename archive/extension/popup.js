const urlsEl = document.getElementById("urls");
const logEl = document.getElementById("log");
const manualModeEl = document.getElementById("manualMode");
const startBtn = document.getElementById("start");
const nextBtn = document.getElementById("next");
const stopBtn = document.getElementById("stop");
const resetBtn = document.getElementById("reset");
const progressTextEl = document.getElementById("progressText");
const progressBarEl = document.getElementById("progressBar");

function renderLogs(logs) {
  logEl.textContent = (logs || []).join("\n");
  logEl.scrollTop = logEl.scrollHeight;
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
  const { urlPaths, logs, job } = await chrome.storage.local.get([
    "urlPaths",
    "logs",
    "job",
  ]);
  urlsEl.value = (urlPaths && urlPaths.length ? urlPaths : DEFAULT_URL_PATHS).join(
    "\n",
  );
  renderLogs(logs);
  renderJob(job);
}

startBtn.addEventListener("click", async () => {
  const urlPaths = urlsEl.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  await chrome.storage.local.set({ urlPaths });
  chrome.runtime.sendMessage({
    type: "start",
    urlPaths,
    manualMode: manualModeEl.checked,
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
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.logs) renderLogs(changes.logs.newValue);
  if (changes.job) renderJob(changes.job.newValue);
});

loadState();
