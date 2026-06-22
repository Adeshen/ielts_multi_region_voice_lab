const form = document.querySelector("#speaking-form");
const promptInput = document.querySelector("#prompt");
const promptCount = document.querySelector("#prompt-count");
const sampleButton = document.querySelector("#prompt-sample");
const saveButton = document.querySelector("#save-prompt");
const recordingLimitSelect = document.querySelector("#recording-limit");
const clearButton = document.querySelector("#clear-speaking");
const searchInput = document.querySelector("#speaking-search");
const resetButton = document.querySelector("#speaking-reset");
const prevButton = document.querySelector("#speaking-prev");
const nextButton = document.querySelector("#speaking-next");
const pageStatus = document.querySelector("#speaking-page-status");
const filterStatus = document.querySelector("#speaking-filter-status");
const statusEl = document.querySelector("#speaking-status");
const listEl = document.querySelector("#speaking-list");

let records = [];
let filteredRecords = [];
let recordPage = 1;
let activeRecording = null;
const expandedRecordings = new Set();
const expandedAnalyses = new Set();
const expandedPromptCards = new Set();
const historyPageSize = 4;

const samples = [
  "Describe a time when you learned something useful from another person.",
  "Talk about a public place in your city that you enjoy visiting.",
  "Some people prefer to study alone, while others prefer to study with classmates. Which do you prefer and why?"
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

function recordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
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

function updateCounter() {
  promptCount.textContent = `${promptInput.value.length} / ${promptInput.maxLength}`;
}

function selectedRecordingLimitSeconds() {
  const value = Number(recordingLimitSelect.value);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 180) : 120;
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function audioFrameFor(audio) {
  return audio.closest(".history-audio");
}

function speakingSearchText(record) {
  return [
    record.title,
    record.prompt,
    ...(record.recordings ?? []).flatMap((recording) => [
      recording.transcript,
      recording.analysis?.summary,
      recording.analysis?.modelAnswer,
      recording.analysis?.topicFamily,
      ...(recording.analysis?.modelAnswerTargetWords ?? []),
      ...(recording.analysis?.cueCardKeywords ?? [])
    ])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function applyFilters({ resetPage = true } = {}) {
  const query = searchInput.value.trim().toLowerCase();
  filteredRecords = records.filter((record) => !query || speakingSearchText(record).includes(query));
  if (resetPage) {
    recordPage = 1;
  }
}

function updatePager(totalPages) {
  const hasRecords = filteredRecords.length > 0;
  prevButton.disabled = !hasRecords || recordPage <= 1;
  nextButton.disabled = !hasRecords || recordPage >= totalPages;
  pageStatus.textContent = hasRecords ? `${recordPage} / ${totalPages}` : "";
  filterStatus.textContent = records.length ? `${filteredRecords.length} of ${records.length} prompts` : "";
}

function analysisBand(analysis) {
  const value = analysis?.overallBand;
  return value ? `Band ${value}` : "";
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

function renderLexicalCoverage(analysis) {
  const coverage = analysis.lexicalCoverage;
  if (!coverage) {
    return "";
  }

  const missedOpportunities = (coverage.missedOpportunities ?? [])
    .map(
      (item) => `
        <div class="vocab-card">
          <strong>${escapeHtml(item.word ?? "")}</strong>
          <p>${escapeHtml(item.whyUseful ?? "")}</p>
          <p class="muted">${escapeHtml(item.samplePhrase ?? "")}</p>
        </div>
      `
    )
    .join("");
  const wordsToAvoid = (coverage.wordsToAvoidForThisTopic ?? [])
    .map(
      (item) => `
        <div class="vocab-card is-muted">
          <strong>${escapeHtml(item.word ?? "")}</strong>
          <p>${escapeHtml(item.reason ?? "")}</p>
        </div>
      `
    )
    .join("");

  return `
    <div class="analysis-section lexical-section">
      <div class="lexical-heading">
        <h4>Core vocabulary alignment</h4>
        ${analysis.topicFamily ? `<span>${escapeHtml(analysis.topicFamily)}</span>` : ""}
      </div>
      <div class="lexical-grid">
        <div>
          <h5>Already used</h5>
          ${renderChipList(coverage.usedCoreVocabulary, "No clear core vocabulary match found yet.")}
        </div>
        <div>
          <h5>Model answer targets</h5>
          ${renderChipList(analysis.modelAnswerTargetWords, "No target words reported.")}
        </div>
      </div>
      ${missedOpportunities ? `<div><h5>Good next words</h5><div class="vocab-card-grid">${missedOpportunities}</div></div>` : ""}
      ${wordsToAvoid ? `<div><h5>Avoid forcing</h5><div class="vocab-card-grid">${wordsToAvoid}</div></div>` : ""}
    </div>
  `;
}

function renderCueCardNotes(analysis) {
  const keywords = (analysis.cueCardKeywords ?? []).filter(Boolean);
  const route = (analysis.speakingRoute ?? []).filter(Boolean);
  if (!keywords.length && !route.length) {
    return "";
  }

  const routeCards = route
    .map(
      (item) => `
        <div class="cue-route-card">
          <strong>${escapeHtml(item.stage ?? "")}</strong>
          ${renderChipList(item.keywords, "No route keywords reported.")}
          <p class="muted">${escapeHtml(item.purpose ?? "")}</p>
        </div>
      `
    )
    .join("");

  return `
    <div class="analysis-section cue-section">
      <div class="lexical-heading">
        <h4>Part 2 cue-card notes</h4>
        <span>1-minute prep</span>
      </div>
      ${renderChipList(keywords, "No cue-card keywords reported.")}
      ${routeCards ? `<div class="cue-route-grid">${routeCards}</div>` : ""}
    </div>
  `;
}

function renderTimingFeedback(analysis) {
  const timing = analysis.timingFeedback;
  if (!timing) {
    return "";
  }

  const items = [
    ["Pacing", timing.pacing],
    ["Pauses", timing.pauses],
    ["Organization", timing.organization],
    ["Evidence", timing.evidenceUsed]
  ].filter(([, value]) => value);

  if (!items.length) {
    return "";
  }

  return `
    <div class="analysis-section timing-section">
      <h4>ASR timing feedback</h4>
      <div class="timing-feedback-grid">
        ${items
          .map(
            ([label, value]) => `
              <div class="timing-feedback-card">
                <strong>${escapeHtml(label)}</strong>
                <p>${escapeHtml(value)}</p>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderAnalysis(analysis, recordingId) {
  if (!analysis) {
    return "";
  }

  const panelId = `analysis-${recordingId}`;
  const isExpanded = expandedAnalyses.has(recordingId);
  const criteria = analysis.criteria ?? {};
  const strengths = (analysis.strengths ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const improvements = (analysis.improvements ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const corrections = (analysis.sentenceCorrections ?? [])
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
    <div class="analysis-panel ${isExpanded ? "is-expanded" : "is-collapsed"}">
      <div class="analysis-header">
        <div class="analysis-score-row">
          <span class="analysis-score">Band ${escapeHtml(analysis.overallBand ?? "-")}</span>
          <span>FC ${escapeHtml(criteria.fluencyCoherence ?? "-")}</span>
          <span>LR ${escapeHtml(criteria.lexicalResource ?? "-")}</span>
          <span>GRA ${escapeHtml(criteria.grammarRangeAccuracy ?? "-")}</span>
          <span>Pron. ${escapeHtml(criteria.pronunciationEstimate ?? "N/A")}</span>
        </div>
        <button
          type="button"
          class="ghost-button compact-button"
          data-toggle-analysis="${escapeHtml(recordingId)}"
          aria-expanded="${isExpanded ? "true" : "false"}"
          aria-controls="${escapeHtml(panelId)}"
        >${isExpanded ? "Collapse" : "Expand"}</button>
      </div>
      <div id="${escapeHtml(panelId)}" class="analysis-body" ${isExpanded ? "" : "hidden"}>
        <p class="analysis-summary">${escapeHtml(analysis.summary ?? "")}</p>
        <div class="analysis-columns">
          <div>
            <h4>Strengths</h4>
            <ul>${strengths}</ul>
          </div>
          <div>
            <h4>Improve</h4>
            <ul>${improvements}</ul>
          </div>
        </div>
        ${renderTimingFeedback(analysis)}
        ${renderLexicalCoverage(analysis)}
        ${corrections ? `<div class="analysis-section"><h4>Sentence fixes</h4>${corrections}</div>` : ""}
        ${renderCueCardNotes(analysis)}
        <div class="analysis-section">
          <h4>Model answer</h4>
          <p class="model-answer">${escapeHtml(analysis.modelAnswer ?? "")}</p>
        </div>
        <p class="muted">${escapeHtml(analysis.practiceTip ?? "")}</p>
        <p class="muted">${escapeHtml(analysis.limitation ?? "")}</p>
      </div>
    </div>
  `;
}

function renderRecordings(record) {
  const recordings = record.recordings ?? [];
  if (!recordings.length) {
    return '<p class="recording-empty">No attempts yet. Record your first answer for this prompt.</p>';
  }

  return recordings
    .map(
      (recording, index) => {
        const hasTranscript = Boolean(recording.transcript);
        const hasAnalysis = Boolean(recording.analysis);
        const isExpanded = expandedRecordings.has(recording.id) || (!hasTranscript && !hasAnalysis);
        const bandLabel = analysisBand(recording.analysis);
        const statusTags = [
          hasTranscript ? "Transcript ready" : "",
          bandLabel,
          hasAnalysis ? "Analysis ready" : ""
        ]
          .filter(Boolean)
          .map((item) => `<span>${escapeHtml(item)}</span>`)
          .join("");

        return `
        <div class="history-audio learner-recording ${isExpanded ? "is-expanded" : "is-collapsed"}">
          <div class="recording-title-row">
            <div>
              <strong>Attempt ${recordings.length - index}</strong>
              <span>${escapeHtml(formatDate(recording.createdAt))}</span>
              ${statusTags ? `<div class="recording-compact-meta">${statusTags}</div>` : ""}
            </div>
            <div class="recording-title-actions">
              <button
                type="button"
                class="ghost-button compact-button"
                data-toggle-recording="${escapeHtml(recording.id)}"
                aria-expanded="${isExpanded ? "true" : "false"}"
              >${isExpanded ? "Compact" : "Expand"}</button>
              <button
                type="button"
                class="danger-button compact-button"
                data-delete-recording="${escapeHtml(recording.id)}"
                data-record-id="${escapeHtml(record.id)}"
              >Delete</button>
            </div>
          </div>
          ${
            isExpanded
              ? `
                <audio controls preload="metadata" src="${escapeHtml(recording.audioUrl)}"></audio>
                <div class="transcript-panel">
                  <label>
                    <span>Answer transcript</span>
                    <textarea
                      class="transcript-input"
                      rows="4"
                      maxlength="4000"
                      placeholder="Paste or type what you said in this recording."
                      data-transcript="${escapeHtml(recording.id)}"
                    >${escapeHtml(recording.transcript ?? "")}</textarea>
                  </label>
                  <button
                    type="button"
                    class="ghost-button"
                    data-transcribe-recording="${escapeHtml(recording.id)}"
                    data-record-id="${escapeHtml(record.id)}"
                  >Transcribe</button>
                  <button
                    type="button"
                    class="ghost-button"
                    data-analyze-recording="${escapeHtml(recording.id)}"
                    data-record-id="${escapeHtml(record.id)}"
                  >Analyze</button>
                </div>
                ${renderAnalysis(recording.analysis, recording.id)}
              `
              : ""
          }
        </div>
      `;
      }
    )
    .join("");
}

function renderRecords() {
  applyFilters({ resetPage: false });

  if (!records.length) {
    listEl.className = "history-list empty-state";
    listEl.textContent = "No speaking prompts yet.";
    updatePager(1);
    return;
  }

  if (!filteredRecords.length) {
    listEl.className = "history-list empty-state";
    listEl.textContent = "No speaking prompts match this search.";
    updatePager(1);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / historyPageSize));
  recordPage = Math.min(recordPage, totalPages);
  const startIndex = (recordPage - 1) * historyPageSize;
  const pageRecords = filteredRecords.slice(startIndex, startIndex + historyPageSize);

  listEl.className = "history-list";
  listEl.innerHTML = pageRecords
    .map(
      (record) => {
        const recordingCount = record.recordings?.length ?? 0;
        const recordingLabel = recordingCount ? "Record another attempt" : "Record first attempt";
        const statusText = recordingCount
          ? `${recordingCount} attempt${recordingCount === 1 ? "" : "s"} saved for this prompt.`
          : "Ready to record your first answer.";
        const isExpanded = expandedPromptCards.has(record.id);
        const transcriptCount = (record.recordings ?? []).filter((recording) => recording.transcript).length;
        const analysisCount = (record.recordings ?? []).filter((recording) => recording.analysis).length;

        return `
        <article class="history-card speaking-card ${isExpanded ? "is-expanded" : "is-collapsed"}" data-id="${escapeHtml(record.id)}">
          <div class="history-title-row">
            <div>
              <p class="eyebrow">${escapeHtml(formatDate(record.createdAt))}</p>
              <h3>${escapeHtml(record.title)}</h3>
              <div class="recording-compact-meta prompt-attempt-meta">
                <span>${escapeHtml(recordingCount)} attempt${recordingCount === 1 ? "" : "s"}</span>
                <span>${escapeHtml(transcriptCount)} transcript${transcriptCount === 1 ? "" : "s"}</span>
                <span>${escapeHtml(analysisCount)} analysis</span>
              </div>
              <p class="history-text speaking-prompt-text">${escapeHtml(record.prompt)}</p>
            </div>
            <div class="history-card-actions">
              <button type="button" class="ghost-button" data-toggle-prompt="${escapeHtml(record.id)}">${isExpanded ? "Compact" : "Expand"}</button>
              ${isExpanded ? `<button type="button" class="primary-button" data-start-recording="${escapeHtml(record.id)}">${escapeHtml(recordingLabel)}</button>` : ""}
              ${isExpanded ? `<button type="button" class="ghost-button" data-stop-recording="${escapeHtml(record.id)}" disabled>Stop</button>` : ""}
              <button type="button" class="danger-button" data-delete-record="${escapeHtml(record.id)}">Delete</button>
            </div>
          </div>
          ${isExpanded ? `<div class="record-status" data-record-status="${escapeHtml(record.id)}">${escapeHtml(statusText)}</div>` : ""}
          ${isExpanded ? `<div class="recordings-list">${renderRecordings(record)}</div>` : ""}
        </article>
      `
      }
    )
    .join("");
  updatePager(totalPages);
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

async function loadRecords() {
  records = await apiFetch("/api/speaking");
  applyFilters({ resetPage: false });
  renderRecords();
}

function resetRecordingUi() {
  if (!activeRecording) {
    return;
  }

  clearInterval(activeRecording.timerId);
  activeRecording.stream.getTracks().forEach((track) => track.stop());
  activeRecording.card.classList.remove("is-recording");
  activeRecording.startButton.disabled = false;
  activeRecording.stopButton.disabled = true;
}

function updateRecordingTimer() {
  if (!activeRecording) {
    return;
  }

  const elapsedSeconds = Math.floor((Date.now() - activeRecording.startedAt) / 1000);
  const limitSeconds = activeRecording.limitSeconds;
  const timerText = limitSeconds
    ? `${formatDuration(elapsedSeconds)} / ${formatDuration(limitSeconds)}`
    : `${formatDuration(elapsedSeconds)} / ${formatDuration(120)}`;
  activeRecording.status.textContent = `Recording attempt... ${timerText}`;

  if (limitSeconds && elapsedSeconds >= limitSeconds) {
    stopActiveRecording({ automatic: true });
  }
}

async function stopActiveRecording({ automatic = false } = {}) {
  if (!activeRecording || activeRecording.isStopping) {
    return;
  }

  const recording = activeRecording;
  recording.isStopping = true;
  recording.stopButton.disabled = true;

  try {
    const blob = recording.recorder.stop();
    recording.status.textContent = automatic ? "Time limit reached. Saving recording..." : "Saving recording...";
    resetRecordingUi();
    activeRecording = null;
    const dataUrl = await blobToDataUrl(blob);
    const savedRecording = await apiFetch(`/api/speaking/${recording.card.dataset.id}/recordings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl })
    });
    expandedRecordings.add(savedRecording.id);
    await loadRecords();
    setStatus(
      automatic
        ? "Recording attempt saved after reaching the time limit."
        : "Recording attempt saved. You can record another attempt for the same prompt."
    );
  } catch (error) {
    resetRecordingUi();
    activeRecording = null;
    setStatus(error.message, "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  saveButton.disabled = true;
  saveButton.textContent = "Saving...";
  try {
    const record = await apiFetch("/api/speaking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptInput.value })
    });
    expandedPromptCards.add(record.id);
    await loadRecords();
    setStatus(`Saved prompt: ${record.title}`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save prompt";
  }
});

sampleButton.addEventListener("click", () => {
  promptInput.value = samples[Math.floor(Math.random() * samples.length)];
  updateCounter();
  promptInput.focus();
});

listEl.addEventListener("click", async (event) => {
  const togglePromptButton = event.target.closest("[data-toggle-prompt]");
  if (togglePromptButton) {
    const recordId = togglePromptButton.dataset.togglePrompt;
    if (expandedPromptCards.has(recordId)) {
      expandedPromptCards.delete(recordId);
    } else {
      expandedPromptCards.add(recordId);
    }
    renderRecords();
    return;
  }

  const startButton = event.target.closest("[data-start-recording]");
  if (startButton) {
    if (!recordingSupported()) {
      setStatus("Microphone recording is not supported in this browser.", "error");
      return;
    }
    if (activeRecording) {
      setStatus("Stop the current recording before starting another one.", "error");
      return;
    }

    const recordId = startButton.dataset.startRecording;
    const card = startButton.closest(".speaking-card");
    const stopButton = card.querySelector("[data-stop-recording]");
    const cardStatus = card.querySelector("[data-record-status]");
    let stream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = createWavRecorder(stream);
      const limitSeconds = selectedRecordingLimitSeconds();
      activeRecording = {
        card,
        recorder,
        startButton,
        stopButton,
        stream,
        status: cardStatus,
        startedAt: Date.now(),
        limitSeconds,
        timerId: null,
        isStopping: false
      };
      card.classList.add("is-recording");
      startButton.disabled = true;
      stopButton.disabled = false;
      updateRecordingTimer();
      activeRecording.timerId = setInterval(updateRecordingTimer, 500);
      setStatus(`Recording from microphone. Limit ${formatDuration(limitSeconds)}.`);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setStatus(error.message || "Could not start microphone recording.", "error");
    }
    return;
  }

  const stopButton = event.target.closest("[data-stop-recording]");
  if (stopButton) {
    await stopActiveRecording();
    return;
  }

  const deleteRecordingButton = event.target.closest("[data-delete-recording]");
  if (deleteRecordingButton) {
    await apiFetch(
      `/api/speaking/${deleteRecordingButton.dataset.recordId}/recordings/${deleteRecordingButton.dataset.deleteRecording}`,
      { method: "DELETE" }
    );
    expandedRecordings.delete(deleteRecordingButton.dataset.deleteRecording);
    expandedAnalyses.delete(deleteRecordingButton.dataset.deleteRecording);
    await loadRecords();
    setStatus("Deleted one recording.");
    return;
  }

  const toggleRecordingButton = event.target.closest("[data-toggle-recording]");
  if (toggleRecordingButton) {
    const recordingId = toggleRecordingButton.dataset.toggleRecording;
    if (expandedRecordings.has(recordingId)) {
      expandedRecordings.delete(recordingId);
    } else {
      expandedRecordings.add(recordingId);
    }
    renderRecords();
    return;
  }

  const toggleAnalysisButton = event.target.closest("[data-toggle-analysis]");
  if (toggleAnalysisButton) {
    const recordingId = toggleAnalysisButton.dataset.toggleAnalysis;
    if (expandedAnalyses.has(recordingId)) {
      expandedAnalyses.delete(recordingId);
    } else {
      expandedAnalyses.add(recordingId);
    }
    renderRecords();
    return;
  }

  const transcribeButton = event.target.closest("[data-transcribe-recording]");
  if (transcribeButton) {
    transcribeButton.disabled = true;
    transcribeButton.textContent = "Transcribing...";
    setStatus("Submitting audio to ASR. This can take up to about 60 seconds for longer WAV recordings.");
    try {
      await apiFetch(
        `/api/speaking/${transcribeButton.dataset.recordId}/recordings/${transcribeButton.dataset.transcribeRecording}/transcribe`,
        { method: "POST" }
      );
      expandedRecordings.add(transcribeButton.dataset.transcribeRecording);
      await loadRecords();
      setStatus("Transcript ready. You can analyze it now.");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      transcribeButton.disabled = false;
      transcribeButton.textContent = "Transcribe";
    }
    return;
  }

  const analyzeButton = event.target.closest("[data-analyze-recording]");
  if (analyzeButton) {
    const card = analyzeButton.closest(".history-audio");
    const transcriptInput = card.querySelector(`[data-transcript="${CSS.escape(analyzeButton.dataset.analyzeRecording)}"]`);
    analyzeButton.disabled = true;
    analyzeButton.textContent = "Analyzing...";
    try {
      await apiFetch(
        `/api/speaking/${analyzeButton.dataset.recordId}/recordings/${analyzeButton.dataset.analyzeRecording}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: transcriptInput.value })
        }
      );
      expandedRecordings.add(analyzeButton.dataset.analyzeRecording);
      expandedAnalyses.add(analyzeButton.dataset.analyzeRecording);
      await loadRecords();
      setStatus("Analysis ready.");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      analyzeButton.disabled = false;
      analyzeButton.textContent = "Analyze";
    }
    return;
  }

  const deleteRecordButton = event.target.closest("[data-delete-record]");
  if (deleteRecordButton) {
    if (activeRecording) {
      setStatus("Stop the current recording before deleting a prompt.", "error");
      return;
    }
    await apiFetch(`/api/speaking/${deleteRecordButton.dataset.deleteRecord}`, { method: "DELETE" });
    expandedPromptCards.delete(deleteRecordButton.dataset.deleteRecord);
    if (recordPage > 1 && filteredRecords.length % historyPageSize === 1) {
      recordPage -= 1;
    }
    await loadRecords();
    setStatus("Deleted one speaking prompt.");
  }
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

clearButton.addEventListener("click", async () => {
  if (activeRecording) {
    setStatus("Stop the current recording before clearing prompts.", "error");
    return;
  }
  await apiFetch("/api/speaking", { method: "DELETE" });
  recordPage = 1;
  expandedPromptCards.clear();
  expandedRecordings.clear();
  expandedAnalyses.clear();
  await loadRecords();
  setStatus("Speaking prompts cleared.");
});

searchInput.addEventListener("input", () => {
  applyFilters();
  renderRecords();
});

resetButton.addEventListener("click", () => {
  searchInput.value = "";
  applyFilters();
  renderRecords();
});

prevButton.addEventListener("click", () => {
  recordPage = Math.max(1, recordPage - 1);
  renderRecords();
});

nextButton.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / historyPageSize));
  recordPage = Math.min(totalPages, recordPage + 1);
  renderRecords();
});

promptInput.addEventListener("input", updateCounter);

updateCounter();
loadRecords().catch((error) => setStatus(error.message, "error"));
