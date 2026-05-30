const form = document.querySelector("#tts-form");
const textInput = document.querySelector("#text");
const charCount = document.querySelector("#char-count");
const sampleButton = document.querySelector("#sample-button");
const speedInput = document.querySelector("#speed");
const volumeInput = document.querySelector("#volume");
const speedValue = document.querySelector("#speed-value");
const volumeValue = document.querySelector("#volume-value");
const generateButton = document.querySelector("#generate-button");
const clearHistoryButton = document.querySelector("#clear-history");
const historyPrevButton = document.querySelector("#history-prev");
const historyNextButton = document.querySelector("#history-next");
const historyPageStatus = document.querySelector("#history-page-status");
const historySearchInput = document.querySelector("#history-search");
const historyStartDateInput = document.querySelector("#history-start-date");
const historyEndDateInput = document.querySelector("#history-end-date");
const historyResetButton = document.querySelector("#history-reset");
const historyFilterStatus = document.querySelector("#history-filter-status");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const historyEl = document.querySelector("#history");
const historyPageSize = 4;
let historyRecords = [];
let filteredHistoryRecords = [];
let historyPage = 1;

const sampleSentences = [
  "Some people believe that public transport should be free in large cities.",
  "I tend to agree that technology can improve education when it is used thoughtfully.",
  "The most memorable journey I have taken was a train trip along the coast."
];

function setStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status ${type === "error" ? "error" : ""}`.trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function dateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function selectedVoices() {
  return [...form.querySelectorAll("input[name='voices']:checked")].map((input) => input.value);
}

function updateCounters() {
  charCount.textContent = `${textInput.value.length} / ${textInput.maxLength}`;
  speedValue.textContent = `${Number(speedInput.value).toFixed(2)}x`;
  volumeValue.textContent = `${Number(volumeInput.value).toFixed(2)}x`;
}

function audioFrameFor(audio) {
  return audio.closest(".audio-card, .history-audio");
}

function clearPlayingFrames(exceptAudio) {
  document.querySelectorAll("audio").forEach((audio) => {
    if (audio !== exceptAudio && !audio.paused) {
      audio.pause();
    }
  });
  document.querySelectorAll(".is-playing").forEach((frame) => frame.classList.remove("is-playing"));
}

function renderResult(record) {
  if (!record?.items?.length) {
    resultsEl.className = "result-grid empty-state";
    resultsEl.textContent = "Generated audio will appear here.";
    return;
  }

  resultsEl.className = "result-grid";
  resultsEl.innerHTML = record.items
    .map(
      (item) => `
        <article class="audio-card">
          <p class="eyebrow">${escapeHtml(item.region)}</p>
          <h3>${escapeHtml(item.shortLabel || item.label)}</h3>
          <p class="muted">${escapeHtml(item.label)}</p>
          <audio controls preload="metadata" src="${escapeHtml(item.audioUrl)}"></audio>
        </article>
      `
    )
    .join("");
}

function formatErrors(errors = []) {
  if (!errors.length) {
    return "";
  }
  return errors.map((item) => `${item.label || item.voiceId}: ${item.error}`).join(" ");
}

function historySearchText(record) {
  const itemText = (record.items ?? [])
    .map((item) => [item.label, item.shortLabel, item.region, item.voiceId].filter(Boolean).join(" "))
    .join(" ");
  return `${record.text} ${itemText}`.toLowerCase();
}

function applyHistoryFilters({ resetPage = true } = {}) {
  const query = historySearchInput.value.trim().toLowerCase();
  const startDate = historyStartDateInput.value;
  const endDate = historyEndDateInput.value;

  filteredHistoryRecords = historyRecords.filter((record) => {
    const recordDate = dateKey(record.createdAt);
    const matchesText = !query || historySearchText(record).includes(query);
    const afterStart = !startDate || recordDate >= startDate;
    const beforeEnd = !endDate || recordDate <= endDate;
    return matchesText && afterStart && beforeEnd;
  });

  if (resetPage) {
    historyPage = 1;
  }
}

function updateHistoryPager(totalPages) {
  const hasRecords = filteredHistoryRecords.length > 0;
  historyPrevButton.disabled = !hasRecords || historyPage <= 1;
  historyNextButton.disabled = !hasRecords || historyPage >= totalPages;
  historyPageStatus.textContent = hasRecords ? `${historyPage} / ${totalPages}` : "";
  historyFilterStatus.textContent = historyRecords.length
    ? `${filteredHistoryRecords.length} of ${historyRecords.length} records`
    : "";
}

function renderHistory() {
  applyHistoryFilters({ resetPage: false });

  if (!historyRecords.length) {
    historyEl.className = "history-list empty-state";
    historyEl.textContent = "No saved generations yet.";
    updateHistoryPager(1);
    return;
  }

  if (!filteredHistoryRecords.length) {
    historyEl.className = "history-list empty-state";
    historyEl.textContent = "No records match these filters.";
    updateHistoryPager(1);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredHistoryRecords.length / historyPageSize));
  historyPage = Math.min(historyPage, totalPages);
  const startIndex = (historyPage - 1) * historyPageSize;
  const records = filteredHistoryRecords.slice(startIndex, startIndex + historyPageSize);

  historyEl.className = "history-list";
  historyEl.innerHTML = records
    .map(
      (record) => `
        <article class="history-card" data-id="${escapeHtml(record.id)}">
          <div class="history-title-row">
            <div>
              <p class="eyebrow">${escapeHtml(formatDate(record.createdAt))}</p>
              <p class="history-text">${escapeHtml(record.text)}</p>
            </div>
            <button type="button" class="danger-button" data-delete="${escapeHtml(record.id)}">Delete</button>
          </div>
          <div class="history-audios">
            ${record.items
              .map(
                (item) => `
                  <div class="history-audio">
                    <strong>${escapeHtml(item.shortLabel || item.label)}</strong>
                    <audio controls preload="metadata" src="${escapeHtml(item.audioUrl)}"></audio>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      `
    )
    .join("");
  updateHistoryPager(totalPages);
}

async function apiFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 204) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function loadHistory() {
  historyRecords = await apiFetch("/api/history");
  applyHistoryFilters({ resetPage: false });
  renderHistory();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const voices = selectedVoices();
  if (voices.length === 0) {
    setStatus("Choose at least one regional voice.", "error");
    return;
  }

  generateButton.disabled = true;
  generateButton.textContent = "Generating...";
  setStatus("Calling TTS and saving audio locally...");

  try {
    const record = await apiFetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: textInput.value,
        voices,
        speedRatio: Number(speedInput.value),
        volumeRatio: Number(volumeInput.value)
      })
    });

    renderResult(record);
    await loadHistory();
    const partial = record.errors?.length ? ` ${formatErrors(record.errors)}` : "";
    setStatus(`Generated ${record.items.length} audio file${record.items.length === 1 ? "" : "s"}.${partial}`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    generateButton.disabled = false;
    generateButton.textContent = "Generate voices";
  }
});

sampleButton.addEventListener("click", () => {
  const nextIndex = Math.floor(Math.random() * sampleSentences.length);
  textInput.value = sampleSentences[nextIndex];
  updateCounters();
  textInput.focus();
});

historyEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) {
    return;
  }

  await apiFetch(`/api/history/${button.dataset.delete}`, { method: "DELETE" });
  if (historyPage > 1 && filteredHistoryRecords.length % historyPageSize === 1) {
    historyPage -= 1;
  }
  await loadHistory();
  setStatus("Deleted one history item.");
});

document.addEventListener(
  "play",
  (event) => {
    if (event.target.tagName !== "AUDIO") {
      return;
    }

    clearPlayingFrames(event.target);
    audioFrameFor(event.target)?.classList.add("is-playing");
  },
  true
);

document.addEventListener(
  "pause",
  (event) => {
    if (event.target.tagName !== "AUDIO") {
      return;
    }

    audioFrameFor(event.target)?.classList.remove("is-playing");
  },
  true
);

document.addEventListener(
  "ended",
  (event) => {
    if (event.target.tagName !== "AUDIO") {
      return;
    }

    audioFrameFor(event.target)?.classList.remove("is-playing");
  },
  true
);

clearHistoryButton.addEventListener("click", async () => {
  await apiFetch("/api/history", { method: "DELETE" });
  historyPage = 1;
  await loadHistory();
  renderResult(null);
  setStatus("History cleared.");
});

historyPrevButton.addEventListener("click", () => {
  historyPage = Math.max(1, historyPage - 1);
  renderHistory();
});

historyNextButton.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(filteredHistoryRecords.length / historyPageSize));
  historyPage = Math.min(totalPages, historyPage + 1);
  renderHistory();
});

for (const filterInput of [historySearchInput, historyStartDateInput, historyEndDateInput]) {
  filterInput.addEventListener("input", () => {
    applyHistoryFilters();
    renderHistory();
  });
}

historyResetButton.addEventListener("click", () => {
  historySearchInput.value = "";
  historyStartDateInput.value = "";
  historyEndDateInput.value = "";
  applyHistoryFilters();
  renderHistory();
});

textInput.addEventListener("input", updateCounters);
speedInput.addEventListener("input", updateCounters);
volumeInput.addEventListener("input", updateCounters);

updateCounters();
loadHistory().catch((error) => setStatus(error.message, "error"));
