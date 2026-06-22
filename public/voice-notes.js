const titleInput = document.querySelector("#voice-note-title-input");
const limitSelect = document.querySelector("#voice-note-limit");
const autoTranscribeInput = document.querySelector("#auto-transcribe");
const startButton = document.querySelector("#start-voice-note");
const stopButton = document.querySelector("#stop-voice-note");
const clearButton = document.querySelector("#clear-voice-notes");
const searchInput = document.querySelector("#voice-note-search");
const resetButton = document.querySelector("#voice-note-reset");
const prevButton = document.querySelector("#voice-note-prev");
const nextButton = document.querySelector("#voice-note-next");
const pageStatus = document.querySelector("#voice-note-page-status");
const filterStatus = document.querySelector("#voice-note-filter-status");
const statusEl = document.querySelector("#voice-note-status");
const currentEl = document.querySelector("#voice-note-current");
const listEl = document.querySelector("#voice-note-list");

let records = [];
let filteredRecords = [];
let activeRecord = null;
let activeRecording = null;
let recordPage = 1;
const expandedNoteRecords = new Set();
const historyPageSize = 4;

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

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function selectedLimitSeconds() {
  const value = Number(limitSelect.value);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 180) : 120;
}

function recordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
}

function voiceNoteSearchText(record) {
  return [
    record.title,
    record.transcript,
    record.expressionAnalysis?.summary,
    record.expressionAnalysis?.upgradedExpression,
    record.expressionAnalysis?.organizationSuggestion,
    record.expressionAnalysis?.fluencyTip,
    record.expressionAnalysis?.practiceDrill,
    ...(record.expressionAnalysis?.usefulChunks ?? []),
    ...(record.expressionAnalysis?.advancedVocabulary ?? []).flatMap((item) => [
      item.word,
      item.meaning,
      item.naturalPhrase,
      item.exampleSentence
    ])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function applyFilters({ resetPage = true } = {}) {
  const query = searchInput.value.trim().toLowerCase();
  filteredRecords = records.filter((record) => !query || voiceNoteSearchText(record).includes(query));
  if (resetPage) {
    recordPage = 1;
  }
}

function updatePager(totalPages) {
  const hasRecords = filteredRecords.length > 0;
  prevButton.disabled = !hasRecords || recordPage <= 1;
  nextButton.disabled = !hasRecords || recordPage >= totalPages;
  pageStatus.textContent = hasRecords ? `${recordPage} / ${totalPages}` : "";
  filterStatus.textContent = records.length ? `${filteredRecords.length} of ${records.length} notes` : "";
}

function mergeAudioBuffers(chunks) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  samples.forEach((sample) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  });

  return new Blob([view], { type: "audio/wav" });
}

function createWavRecorder(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const chunks = [];

  processor.onaudioprocess = (audioEvent) => {
    chunks.push(new Float32Array(audioEvent.inputBuffer.getChannelData(0)));
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  return {
    stop() {
      processor.disconnect();
      source.disconnect();
      const sampleRate = audioContext.sampleRate;
      const samples = mergeAudioBuffers(chunks);
      audioContext.close();
      return encodeWav(samples, sampleRate);
    }
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read recording.")));
    reader.readAsDataURL(blob);
  });
}

async function apiFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 204) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function updateRecordingTimer() {
  if (!activeRecording) {
    return;
  }

  const elapsedSeconds = Math.floor((Date.now() - activeRecording.startedAt) / 1000);
  activeRecording.status.textContent = `Recording... ${formatDuration(elapsedSeconds)} / ${formatDuration(activeRecording.limitSeconds)}`;
  if (elapsedSeconds >= activeRecording.limitSeconds) {
    stopRecording({ automatic: true });
  }
}

function resetRecordingUi() {
  if (!activeRecording) {
    return;
  }

  clearInterval(activeRecording.timerId);
  activeRecording.stream.getTracks().forEach((track) => track.stop());
  startButton.disabled = false;
  stopButton.disabled = true;
}

async function transcribeRecord(recordId) {
  setStatus("Submitting voice note to ASR. This can take up to about 60 seconds.");
  const payload = await apiFetch(`/api/voice-notes/${recordId}/transcribe`, { method: "POST" });
  activeRecord = payload.record;
  expandedNoteRecords.add(payload.record.id);
  await loadRecords();
  setStatus("Transcript ready.");
}

async function stopRecording({ automatic = false } = {}) {
  if (!activeRecording || activeRecording.isStopping) {
    return;
  }

  activeRecording.isStopping = true;
  stopButton.disabled = true;
  try {
    const recording = activeRecording;
    const blob = recording.recorder.stop();
    recording.status.textContent = automatic ? "Time limit reached. Saving..." : "Saving recording...";
    resetRecordingUi();
    activeRecording = null;
    const dataUrl = await blobToDataUrl(blob);
    const record = await apiFetch("/api/voice-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: titleInput.value,
        dataUrl
      })
    });
    activeRecord = record;
    expandedNoteRecords.add(record.id);
    await loadRecords();
    setStatus(automatic ? "Voice note saved after reaching the time limit." : "Voice note saved.");
    if (autoTranscribeInput.checked) {
      await transcribeRecord(record.id);
    }
  } catch (error) {
    resetRecordingUi();
    activeRecording = null;
    setStatus(error.message, "error");
  }
}

function renderTranscript(record) {
  if (!record.transcript) {
    return "";
  }

  const timing = record.transcription?.timing;
  const timingText = timing?.estimatedWordsPerMinute
    ? `Estimated ${timing.estimatedWordsPerMinute} WPM · longest pause ${timing.longestPauseSeconds ?? "-"}s`
    : "";
  return `
    <div class="transcript-panel">
      <label>
        <span>Transcript</span>
        <textarea class="transcript-input" rows="5" readonly>${escapeHtml(record.transcript)}</textarea>
      </label>
      ${timingText ? `<p class="muted">${escapeHtml(timingText)}</p>` : ""}
    </div>
  `;
}

function renderChipList(items, emptyText) {
  const values = (items ?? []).filter(Boolean);
  if (!values.length) {
    return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  }

  return `
    <div class="analysis-chip-list">
      ${values.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function renderExpressionAnalysis(analysis) {
  if (!analysis) {
    return "";
  }

  const vocabularyCards = (analysis.advancedVocabulary ?? [])
    .map(
      (item) => `
        <div class="vocab-card">
          <strong>${escapeHtml(item.word ?? "")}</strong>
          <p>${escapeHtml(item.meaning ?? "")}</p>
          <p class="muted">${escapeHtml(item.naturalPhrase ?? "")}</p>
          <p>${escapeHtml(item.exampleSentence ?? "")}</p>
        </div>
      `
    )
    .join("");

  const upgrades = (analysis.sentenceUpgrades ?? [])
    .map(
      (item) => `
        <div class="analysis-correction">
          <p><strong>Original:</strong> ${escapeHtml(item.original ?? "")}</p>
          <p><strong>Better:</strong> ${escapeHtml(item.improved ?? "")}</p>
          <p class="muted">${escapeHtml(item.reason ?? "")}</p>
        </div>
      `
    )
    .join("");

  return `
    <div class="analysis-panel voice-note-analysis">
      <div class="analysis-header">
        <div>
          <p class="eyebrow">DeepSeek coach</p>
          <h4>Expression upgrade</h4>
        </div>
        <div class="recording-compact-meta"><span>Ready</span></div>
      </div>
      <div class="analysis-body">
        <p class="analysis-summary">${escapeHtml(analysis.summary ?? "")}</p>
        <div class="analysis-section">
          <h4>Better spoken version</h4>
          <p class="model-answer">${escapeHtml(analysis.upgradedExpression ?? "")}</p>
        </div>
        ${analysis.organizationSuggestion ? `<p class="muted">${escapeHtml(analysis.organizationSuggestion)}</p>` : ""}
        ${
          vocabularyCards
            ? `<div class="analysis-section lexical-section"><h4>Advanced useful vocabulary</h4><div class="vocab-card-grid">${vocabularyCards}</div></div>`
            : ""
        }
        <div class="analysis-section">
          <h4>Reusable speaking chunks</h4>
          ${renderChipList(analysis.usefulChunks, "No reusable chunks reported.")}
        </div>
        ${upgrades ? `<div class="analysis-section"><h4>Sentence upgrades</h4>${upgrades}</div>` : ""}
        ${analysis.fluencyTip ? `<p class="muted">${escapeHtml(analysis.fluencyTip)}</p>` : ""}
        ${analysis.practiceDrill ? `<p class="muted">${escapeHtml(analysis.practiceDrill)}</p>` : ""}
      </div>
    </div>
  `;
}

function renderCard(record, { current = false } = {}) {
  const isExpanded = current || expandedNoteRecords.has(record.id);
  const hasTranscript = Boolean(record.transcript);
  const hasAnalysis = Boolean(record.expressionAnalysis);
  return `
    <article class="history-card voice-note-card ${isExpanded ? "is-expanded" : "is-collapsed"}" data-id="${escapeHtml(record.id)}">
      <div class="history-title-row">
        <div>
          <p class="eyebrow">${escapeHtml(formatDate(record.createdAt))}</p>
          <h3>${escapeHtml(record.title || "Voice note")}</h3>
          <div class="recording-compact-meta">
            ${hasTranscript ? "<span>Transcript ready</span>" : "<span>No transcript</span>"}
            ${hasAnalysis ? "<span>Expression ready</span>" : ""}
          </div>
        </div>
        <div class="history-card-actions">
          ${current ? "" : `<button type="button" class="ghost-button compact-button" data-toggle-note="${escapeHtml(record.id)}">${isExpanded ? "Compact" : "Expand"}</button>`}
          ${
            current
              ? ""
              : `<button type="button" class="ghost-button compact-button" data-open-note="${escapeHtml(record.id)}">Open</button>`
          }
          ${isExpanded ? `<button type="button" class="ghost-button compact-button" data-transcribe-note="${escapeHtml(record.id)}">Transcribe</button>` : ""}
          ${isExpanded ? `<button type="button" class="ghost-button compact-button" data-analyze-note="${escapeHtml(record.id)}">Improve</button>` : ""}
          <button type="button" class="danger-button compact-button" data-delete-note="${escapeHtml(record.id)}">Delete</button>
        </div>
      </div>
      ${
        isExpanded
          ? `
            <audio controls preload="metadata" src="${escapeHtml(record.audioUrl)}"></audio>
            ${renderTranscript(record)}
            ${renderExpressionAnalysis(record.expressionAnalysis)}
          `
          : ""
      }
    </article>
  `;
}

function renderCurrent() {
  if (activeRecording) {
    currentEl.className = "dictation-current";
    currentEl.innerHTML = `<div class="history-card"><p class="record-status">Recording...</p></div>`;
    activeRecording.status = currentEl.querySelector(".record-status");
    updateRecordingTimer();
    return;
  }

  if (!activeRecord) {
    currentEl.className = "dictation-current empty-state";
    currentEl.textContent = "Record a voice note to transcribe it.";
    return;
  }

  currentEl.className = "dictation-current";
  currentEl.innerHTML = renderCard(activeRecord, { current: true });
}

function renderList() {
  applyFilters({ resetPage: false });

  if (!records.length) {
    listEl.className = "history-list empty-state";
    listEl.textContent = "No voice notes yet.";
    updatePager(1);
    return;
  }

  if (!filteredRecords.length) {
    listEl.className = "history-list empty-state";
    listEl.textContent = "No voice notes match this search.";
    updatePager(1);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / historyPageSize));
  recordPage = Math.min(recordPage, totalPages);
  const startIndex = (recordPage - 1) * historyPageSize;
  const pageRecords = filteredRecords.slice(startIndex, startIndex + historyPageSize);

  listEl.className = "history-list";
  listEl.innerHTML = pageRecords.map((record) => renderCard(record)).join("");
  updatePager(totalPages);
}

async function loadRecords() {
  records = await apiFetch("/api/voice-notes");
  applyFilters({ resetPage: false });
  if (activeRecord) {
    activeRecord = records.find((record) => record.id === activeRecord.id) ?? activeRecord;
  }
  renderCurrent();
  renderList();
}

startButton.addEventListener("click", async () => {
  if (!recordingSupported()) {
    setStatus("Microphone recording is not supported in this browser.", "error");
    return;
  }
  if (activeRecording) {
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = createWavRecorder(stream);
    activeRecording = {
      recorder,
      stream,
      startedAt: Date.now(),
      limitSeconds: selectedLimitSeconds(),
      timerId: null,
      isStopping: false,
      status: null
    };
    startButton.disabled = true;
    stopButton.disabled = false;
    renderCurrent();
    activeRecording.timerId = setInterval(updateRecordingTimer, 500);
    setStatus(`Recording. Limit ${formatDuration(activeRecording.limitSeconds)}.`);
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    setStatus(error.message || "Could not start microphone recording.", "error");
  }
});

stopButton.addEventListener("click", () => {
  stopRecording();
});

document.addEventListener("click", async (event) => {
  const toggleNoteButton = event.target.closest("[data-toggle-note]");
  if (toggleNoteButton) {
    const recordId = toggleNoteButton.dataset.toggleNote;
    if (expandedNoteRecords.has(recordId)) {
      expandedNoteRecords.delete(recordId);
    } else {
      expandedNoteRecords.add(recordId);
    }
    renderList();
    return;
  }

  const openButton = event.target.closest("[data-open-note]");
  if (openButton) {
    activeRecord = records.find((record) => record.id === openButton.dataset.openNote);
    if (activeRecord) {
      expandedNoteRecords.add(activeRecord.id);
    }
    renderCurrent();
    renderList();
    setStatus("Voice note loaded.");
    return;
  }

  const transcribeButton = event.target.closest("[data-transcribe-note]");
  if (transcribeButton) {
    transcribeButton.disabled = true;
    transcribeButton.textContent = "Transcribing...";
    try {
      await transcribeRecord(transcribeButton.dataset.transcribeNote);
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      transcribeButton.disabled = false;
      transcribeButton.textContent = "Transcribe";
    }
    return;
  }

  const analyzeButton = event.target.closest("[data-analyze-note]");
  if (analyzeButton) {
    analyzeButton.disabled = true;
    analyzeButton.textContent = "Improving...";
    try {
      const payload = await apiFetch(`/api/voice-notes/${analyzeButton.dataset.analyzeNote}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      activeRecord = payload.record;
      expandedNoteRecords.add(payload.record.id);
      await loadRecords();
      setStatus("Expression upgrade ready.");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      analyzeButton.disabled = false;
      analyzeButton.textContent = "Improve";
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete-note]");
  if (deleteButton) {
    await apiFetch(`/api/voice-notes/${deleteButton.dataset.deleteNote}`, { method: "DELETE" });
    if (activeRecord?.id === deleteButton.dataset.deleteNote) {
      activeRecord = null;
    }
    expandedNoteRecords.delete(deleteButton.dataset.deleteNote);
    if (recordPage > 1 && filteredRecords.length % historyPageSize === 1) {
      recordPage -= 1;
    }
    await loadRecords();
    setStatus("Voice note deleted.");
  }
});

clearButton.addEventListener("click", async () => {
  if (activeRecording) {
    setStatus("Stop the current recording before clearing voice notes.", "error");
    return;
  }
  await apiFetch("/api/voice-notes", { method: "DELETE" });
  activeRecord = null;
  recordPage = 1;
  expandedNoteRecords.clear();
  await loadRecords();
  setStatus("Voice notes cleared.");
});

searchInput.addEventListener("input", () => {
  applyFilters();
  renderList();
});

resetButton.addEventListener("click", () => {
  searchInput.value = "";
  applyFilters();
  renderList();
});

prevButton.addEventListener("click", () => {
  recordPage = Math.max(1, recordPage - 1);
  renderList();
});

nextButton.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / historyPageSize));
  recordPage = Math.min(totalPages, recordPage + 1);
  renderList();
});

loadRecords().catch((error) => setStatus(error.message, "error"));
