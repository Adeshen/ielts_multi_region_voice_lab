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
let activeRecording = null;
let openRecordingPanelId = null;

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

function renderRecordings(record) {
  const recordings = record.recordings ?? [];
  if (!recordings.length) {
    return '<p class="recording-empty">No learner recordings yet.</p>';
  }

  return recordings
    .map(
      (recording, index) => `
        <div class="history-audio learner-recording">
          <div class="recording-title-row">
            <div>
              <strong>Your recording ${recordings.length - index}</strong>
              <span>${escapeHtml(formatDate(recording.createdAt))}</span>
            </div>
            <button
              type="button"
              class="danger-button compact-button"
              data-delete-recording="${escapeHtml(recording.id)}"
              data-record-id="${escapeHtml(record.id)}"
            >Delete</button>
          </div>
          <audio controls preload="metadata" src="${escapeHtml(recording.audioUrl)}"></audio>
        </div>
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

function normalizePracticeText(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function practiceScore(originalText, attemptText) {
  const original = normalizePracticeText(originalText);
  const attempt = normalizePracticeText(attemptText);
  if (!attempt) {
    return null;
  }

  const distance = editDistance(original, attempt);
  const accuracy = Math.max(0, Math.round((1 - distance / Math.max(original.length, attempt.length, 1)) * 100));
  const originalWords = original.split(" ").filter(Boolean);
  const attemptWords = new Set(attempt.split(" ").filter(Boolean));
  const matchedWords = originalWords.filter((word) => attemptWords.has(word)).length;

  return {
    accuracy,
    matchedWords,
    totalWords: originalWords.length
  };
}

function historySearchText(record) {
  const itemText = (record.items ?? [])
    .map((item) => [item.label, item.shortLabel, item.region, item.voiceId].filter(Boolean).join(" "))
    .join(" ");
  return `${record.text} ${itemText}`.toLowerCase();
}

function recordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

function preferredRecordingType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read recording.")));
    reader.readAsDataURL(blob);
  });
}

function resetRecordingUi() {
  if (!activeRecording) {
    return;
  }

  activeRecording.stream.getTracks().forEach((track) => track.stop());
  activeRecording.card.classList.remove("is-recording");
  activeRecording.startButton.disabled = false;
  activeRecording.stopButton.disabled = true;
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
      (record) => {
        const isRecordingPanelOpen = record.id === openRecordingPanelId;
        return `
        <article class="history-card" data-id="${escapeHtml(record.id)}">
          <div class="history-title-row">
            <div>
              <p class="eyebrow">${escapeHtml(formatDate(record.createdAt))}</p>
              <p class="history-text" data-original-text>${escapeHtml(record.text)}</p>
              <p class="history-text-placeholder" hidden>Original sentence hidden for rewrite practice.</p>
            </div>
            <div class="history-card-actions">
              <button type="button" class="ghost-button" data-practice="${escapeHtml(record.id)}">Rewrite</button>
              <button type="button" class="ghost-button" data-record-panel="${escapeHtml(record.id)}">
                ${isRecordingPanelOpen ? "Close" : "Record"}
              </button>
              <button type="button" class="danger-button" data-delete="${escapeHtml(record.id)}">Delete</button>
            </div>
          </div>
          <div class="rewrite-panel" hidden>
            <textarea class="rewrite-input" rows="3" placeholder="Type what you hear"></textarea>
            <div class="rewrite-actions">
              <button type="button" class="ghost-button" data-check="${escapeHtml(record.id)}">Check</button>
              <button type="button" class="ghost-button" data-clear-practice="${escapeHtml(record.id)}">Clear</button>
              <span class="rewrite-result"></span>
            </div>
          </div>
          <div class="record-panel" ${isRecordingPanelOpen ? "" : "hidden"}>
            <div class="record-actions">
              <button type="button" class="primary-button" data-start-recording="${escapeHtml(record.id)}">Start recording</button>
              <button type="button" class="ghost-button" data-stop-recording="${escapeHtml(record.id)}" disabled>Stop</button>
              <span class="record-status">Ready to record your reading.</span>
            </div>
            <div class="recordings-list">
              ${renderRecordings(record)}
            </div>
          </div>
          <div class="history-audios">
            ${record.items
              .map(
                (item) => `
                  <div class="history-audio">
                    <div class="recording-title-row">
                      <strong>${escapeHtml(item.shortLabel || item.label)}</strong>
                      <button
                        type="button"
                        class="ghost-button compact-button"
                        data-dictation-from-history="${escapeHtml(record.id)}"
                        data-voice-id="${escapeHtml(item.voiceId)}"
                      >Dictation</button>
                    </div>
                    <audio controls preload="metadata" src="${escapeHtml(item.audioUrl)}"></audio>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      `;
      }
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
  const recordPanelButton = event.target.closest("[data-record-panel]");
  if (recordPanelButton) {
    const card = recordPanelButton.closest(".history-card");
    const panel = card.querySelector(".record-panel");
    const startButton = card.querySelector("[data-start-recording]");
    const status = card.querySelector(".record-status");
    panel.hidden = !panel.hidden;
    openRecordingPanelId = panel.hidden ? null : recordPanelButton.dataset.recordPanel;
    recordPanelButton.textContent = panel.hidden ? "Record" : "Close";
    if (!panel.hidden && !recordingSupported()) {
      startButton.disabled = true;
      status.textContent = "Microphone recording is not supported in this browser.";
    }
    return;
  }

  const startRecordingButton = event.target.closest("[data-start-recording]");
  if (startRecordingButton) {
    if (!recordingSupported()) {
      setStatus("Microphone recording is not supported in this browser.", "error");
      return;
    }
    if (activeRecording) {
      setStatus("Stop the current recording before starting another one.", "error");
      return;
    }

    const card = startRecordingButton.closest(".history-card");
    const recordId = startRecordingButton.dataset.startRecording;
    const stopButton = card.querySelector("[data-stop-recording]");
    const status = card.querySelector(".record-status");
    let stream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredRecordingType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];

      recorder.addEventListener("dataavailable", (dataEvent) => {
        if (dataEvent.data.size > 0) {
          chunks.push(dataEvent.data);
        }
      });

      recorder.addEventListener("stop", async () => {
        try {
          status.textContent = "Saving recording...";
          resetRecordingUi();
          activeRecording = null;
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
          const dataUrl = await blobToDataUrl(blob);
          await apiFetch(`/api/history/${recordId}/recordings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl })
          });
          openRecordingPanelId = recordId;
          await loadHistory();
          setStatus("Recording saved. Play it beside the generated voice.");
        } catch (error) {
          activeRecording = null;
          setStatus(error.message, "error");
        }
      });

      recorder.start();
      activeRecording = {
        card,
        recorder,
        startButton: startRecordingButton,
        stopButton,
        stream
      };
      card.classList.add("is-recording");
      startRecordingButton.disabled = true;
      stopButton.disabled = false;
      status.textContent = "Recording... read the sentence out loud.";
      setStatus("Recording from microphone...");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setStatus(error.message || "Could not start microphone recording.", "error");
    }
    return;
  }

  const stopRecordingButton = event.target.closest("[data-stop-recording]");
  if (stopRecordingButton) {
    if (!activeRecording || activeRecording.recorder.state === "inactive") {
      return;
    }
    stopRecordingButton.disabled = true;
    activeRecording.recorder.stop();
    return;
  }

  const deleteRecordingButton = event.target.closest("[data-delete-recording]");
  if (deleteRecordingButton) {
    await apiFetch(
      `/api/history/${deleteRecordingButton.dataset.recordId}/recordings/${deleteRecordingButton.dataset.deleteRecording}`,
      { method: "DELETE" }
    );
    openRecordingPanelId = deleteRecordingButton.dataset.recordId;
    await loadHistory();
    setStatus("Deleted one learner recording.");
    return;
  }

  const practiceButton = event.target.closest("[data-practice]");
  if (practiceButton) {
    const card = practiceButton.closest(".history-card");
    const panel = card.querySelector(".rewrite-panel");
    const originalText = card.querySelector("[data-original-text]");
    const hiddenText = card.querySelector(".history-text-placeholder");
    panel.hidden = !panel.hidden;
    practiceButton.textContent = panel.hidden ? "Rewrite" : "Hide";
    originalText.hidden = !panel.hidden;
    hiddenText.hidden = panel.hidden;
    if (!panel.hidden) {
      card.querySelector(".rewrite-input").focus();
    }
    return;
  }

  const dictationButton = event.target.closest("[data-dictation-from-history]");
  if (dictationButton) {
    dictationButton.disabled = true;
    dictationButton.textContent = "Adding...";
    try {
      const record = await apiFetch("/api/dictation/from-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          historyId: dictationButton.dataset.dictationFromHistory,
          voiceId: dictationButton.dataset.voiceId
        })
      });
      window.location.href = `/dictation.html?record=${encodeURIComponent(record.id)}`;
    } catch (error) {
      dictationButton.disabled = false;
      dictationButton.textContent = "Dictation";
      setStatus(error.message, "error");
    }
    return;
  }

  const checkButton = event.target.closest("[data-check]");
  if (checkButton) {
    const card = checkButton.closest(".history-card");
    const record = historyRecords.find((item) => item.id === checkButton.dataset.check);
    const input = card.querySelector(".rewrite-input");
    const result = card.querySelector(".rewrite-result");
    const score = practiceScore(record?.text ?? "", input.value);
    result.textContent = score
      ? `Accuracy ${score.accuracy}% · Words ${score.matchedWords}/${score.totalWords}`
      : "Type an answer first.";
    result.classList.toggle("is-strong", Boolean(score && score.accuracy >= 85));
    return;
  }

  const clearPracticeButton = event.target.closest("[data-clear-practice]");
  if (clearPracticeButton) {
    const card = clearPracticeButton.closest(".history-card");
    card.querySelector(".rewrite-input").value = "";
    card.querySelector(".rewrite-result").textContent = "";
    return;
  }

  const button = event.target.closest("[data-delete]");
  if (!button) {
    return;
  }

  await apiFetch(`/api/history/${button.dataset.delete}`, { method: "DELETE" });
  if (openRecordingPanelId === button.dataset.delete) {
    openRecordingPanelId = null;
  }
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
