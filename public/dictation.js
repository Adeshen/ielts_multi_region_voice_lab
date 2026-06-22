const form = document.querySelector("#dictation-form");
const sourceTextInput = document.querySelector("#source-text");
const sourceCount = document.querySelector("#source-count");
const sampleButton = document.querySelector("#dictation-sample");
const voiceSelect = document.querySelector("#dictation-voice");
const speedInput = document.querySelector("#dictation-speed");
const speedValue = document.querySelector("#dictation-speed-value");
const startButton = document.querySelector("#start-dictation");
const statusEl = document.querySelector("#dictation-status");
const currentEl = document.querySelector("#dictation-current");
const listEl = document.querySelector("#dictation-list");
const clearButton = document.querySelector("#clear-dictation");
const searchInput = document.querySelector("#dictation-search");
const resetButton = document.querySelector("#dictation-reset");
const prevButton = document.querySelector("#dictation-prev");
const nextButton = document.querySelector("#dictation-next");
const pageStatus = document.querySelector("#dictation-page-status");
const filterStatus = document.querySelector("#dictation-filter-status");

let records = [];
let filteredRecords = [];
let activeRecord = null;
let recordPage = 1;
const revealedRecords = new Set();
const expandedHistoryRecords = new Set();
const historyPageSize = 4;

const samples = [
  "The coastal environment is home to many rare species.",
  "Students need a clear structure before they start a demanding group project.",
  "Public transport may be limited in remote areas, so visitors should plan in advance.",
  "The documentary used visual information to explain ancient fossils and landscapes."
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

function updateCounter() {
  sourceCount.textContent = `${sourceTextInput.value.length} / ${sourceTextInput.maxLength}`;
}

function updateSpeedLabel() {
  speedValue.textContent = `${Number(speedInput.value).toFixed(2)}x`;
}

function dictationSearchText(record) {
  return [
    record.sourceText,
    record.voice?.label,
    record.voice?.shortLabel,
    record.source,
    ...(record.attempts ?? []).flatMap((attempt) => [
      attempt.userText,
      attempt.aiReview?.judgement,
      attempt.aiReview?.practiceAdvice,
      ...(attempt.mistakes ?? []).map((item) => [item.type, item.expected, item.actual].filter(Boolean).join(" ")),
      ...(attempt.aiReview?.likelyListeningIssues ?? [])
    ])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function applyFilters({ resetPage = true } = {}) {
  const query = searchInput.value.trim().toLowerCase();
  filteredRecords = records.filter((record) => !query || dictationSearchText(record).includes(query));
  if (resetPage) {
    recordPage = 1;
  }
}

function updatePager(totalPages) {
  const hasRecords = filteredRecords.length > 0;
  prevButton.disabled = !hasRecords || recordPage <= 1;
  nextButton.disabled = !hasRecords || recordPage >= totalPages;
  pageStatus.textContent = hasRecords ? `${recordPage} / ${totalPages}` : "";
  filterStatus.textContent = records.length ? `${filteredRecords.length} of ${records.length} records` : "";
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

function latestAttempt(record) {
  return (record.attempts ?? [])[0] ?? null;
}

function renderDiff(operations = []) {
  if (!operations.length) {
    return "";
  }

  const tokens = operations
    .map((item) => {
      if (item.type === "correct") {
        return `<span class="diff-token is-correct">${escapeHtml(item.expected)}</span>`;
      }
      if (item.type === "missing") {
        return `<span class="diff-token is-missing">${escapeHtml(item.expected)}</span>`;
      }
      if (item.type === "extra") {
        return `<span class="diff-token is-extra">+${escapeHtml(item.actual)}</span>`;
      }
      if (item.type === "spelling") {
        return `<span class="diff-token is-spelling">${escapeHtml(item.actual)} → ${escapeHtml(item.expected)}</span>`;
      }
      return `<span class="diff-token is-wrong">${escapeHtml(item.actual)} → ${escapeHtml(item.expected)}</span>`;
    })
    .join("");

  return `<div class="dictation-diff">${tokens}</div>`;
}

function renderAiReview(aiReview) {
  if (!aiReview) {
    return "";
  }

  const acceptedMatches = (aiReview.acceptedMatches ?? [])
    .map(
      (item) => `
        <li>
          <strong>${escapeHtml(item.actual ?? "")} → ${escapeHtml(item.expected ?? "")}</strong>
          <span>${escapeHtml(item.reason ?? "")}</span>
        </li>
      `
    )
    .join("");
  const criticalMistakes = (aiReview.criticalMistakes ?? [])
    .map(
      (item) => `
        <li>
          <strong>${escapeHtml(item.type ?? "mistake")}: ${escapeHtml(item.actual ?? "")} → ${escapeHtml(item.expected ?? "")}</strong>
          <span>${escapeHtml(item.impact ?? "")}</span>
        </li>
      `
    )
    .join("");

  return `
    <div class="ai-review-panel">
      <div class="dictation-score-row">
        <span class="dictation-score">AI ${escapeHtml(aiReview.aiScore ?? "-")}%</span>
        <span>${escapeHtml(aiReview.model ?? "DeepSeek")}</span>
      </div>
      <p>${escapeHtml(aiReview.judgement ?? "")}</p>
      ${
        aiReview.likelyListeningIssues?.length
          ? `<p class="muted">Likely issues: ${escapeHtml(aiReview.likelyListeningIssues.join(", "))}</p>`
          : ""
      }
      ${acceptedMatches ? `<div><h4>Accepted or minor</h4><ul class="dictation-mistakes">${acceptedMatches}</ul></div>` : ""}
      ${criticalMistakes ? `<div><h4>Critical mistakes</h4><ul class="dictation-mistakes">${criticalMistakes}</ul></div>` : ""}
      ${aiReview.practiceAdvice ? `<p class="muted">${escapeHtml(aiReview.practiceAdvice)}</p>` : ""}
    </div>
  `;
}

function renderMistakes(attempt, record) {
  if (!attempt) {
    return "";
  }

  const coreVocabulary = (attempt.coreVocabulary ?? []).filter((item) => item.word);
  const coreHits = coreVocabulary.filter((item) => item.heard).map((item) => item.word);
  const coreMisses = coreVocabulary.filter((item) => !item.heard).map((item) => item.word);
  const mistakeItems = (attempt.mistakes ?? [])
    .slice(0, 12)
    .map(
      (item) => `
        <li>
          <strong>${escapeHtml(item.type.replaceAll("_", " "))}</strong>
          ${item.expected ? `<span>Expected: ${escapeHtml(item.expected)}</span>` : ""}
          ${item.actual ? `<span>Heard: ${escapeHtml(item.actual)}</span>` : ""}
        </li>
      `
    )
    .join("");

  return `
    <div class="dictation-result">
      <div class="dictation-score-row">
        <span class="dictation-score">${escapeHtml(attempt.score)}%</span>
        <span>${escapeHtml(attempt.correctCount)} / ${escapeHtml(attempt.expectedWordCount)} words</span>
        <span>${escapeHtml(attempt.spellingCount)} spelling</span>
        <span>${escapeHtml(attempt.missingCount)} missing</span>
        <span>${escapeHtml(attempt.extraCount)} extra</span>
      </div>
      ${renderDiff(attempt.operations)}
      ${
        attempt.missingFunctionWords?.length
          ? `<p class="muted">Function words missed: ${escapeHtml(attempt.missingFunctionWords.join(", "))}</p>`
          : ""
      }
      ${
        coreVocabulary.length
          ? `
            <div class="dictation-core-grid">
              <div>
                <h4>Core words heard</h4>
                <p>${escapeHtml(coreHits.join(", ") || "None yet")}</p>
              </div>
              <div>
                <h4>Core words missed</h4>
                <p>${escapeHtml(coreMisses.join(", ") || "None")}</p>
              </div>
            </div>
          `
          : ""
      }
      ${mistakeItems ? `<ul class="dictation-mistakes">${mistakeItems}</ul>` : ""}
      <button
        type="button"
        class="ghost-button compact-button"
        data-review-dictation="${escapeHtml(record.id)}"
        data-attempt-id="${escapeHtml(attempt.id)}"
      >${attempt.aiReview ? "Run AI review again" : "AI review"}</button>
      ${renderAiReview(attempt.aiReview)}
    </div>
  `;
}

function renderPracticeCard(record, { current = false } = {}) {
  const attempt = latestAttempt(record);
  const isRevealed = revealedRecords.has(record.id);
  const isExpanded = current || expandedHistoryRecords.has(record.id);
  return `
    <article class="history-card dictation-card ${isExpanded ? "is-expanded" : "is-collapsed"}" data-id="${escapeHtml(record.id)}">
      <div class="history-title-row">
        <div>
          <p class="eyebrow">${escapeHtml(formatDate(record.createdAt))}</p>
          <h3>${escapeHtml(record.voice?.shortLabel ?? record.voice?.label ?? "Dictation audio")}</h3>
          <p class="muted">Speed ${escapeHtml(record.speedRatio ?? "-")}x${record.source === "tts-history" ? " · reused from TTS comparison" : ""}</p>
          <div class="recording-compact-meta prompt-attempt-meta">
            <span>${escapeHtml(record.attempts?.length ?? 0)} attempt${record.attempts?.length === 1 ? "" : "s"}</span>
            ${attempt ? `<span>Latest ${escapeHtml(attempt.score)}%</span>` : ""}
          </div>
        </div>
        <div class="history-card-actions">
          ${current ? "" : `<button type="button" class="ghost-button compact-button" data-toggle-dictation-card="${escapeHtml(record.id)}">${isExpanded ? "Compact" : "Expand"}</button>`}
          ${
            current
              ? ""
              : `<button type="button" class="ghost-button compact-button" data-practice-dictation="${escapeHtml(record.id)}">Practice</button>`
          }
          ${isExpanded ? `<button type="button" class="ghost-button compact-button" data-reveal-dictation="${escapeHtml(record.id)}">${isRevealed ? "Hide answer" : "Reveal"}</button>` : ""}
          <button type="button" class="danger-button compact-button" data-delete-dictation="${escapeHtml(record.id)}">Delete</button>
        </div>
      </div>
      ${
        isExpanded
          ? `
            <audio controls preload="metadata" src="${escapeHtml(record.audioUrl)}"></audio>
            <form class="dictation-answer-form" data-check-dictation="${escapeHtml(record.id)}">
              <label>
                <span>Your dictation</span>
                <textarea
                  class="dictation-answer"
                  rows="4"
                  maxlength="1000"
                  placeholder="Type what you hear. The original sentence stays hidden."
                  required
                >${escapeHtml(attempt?.userText ?? "")}</textarea>
              </label>
              <button type="submit" class="primary-button compact-button">Check answer</button>
            </form>
            ${isRevealed ? `<p class="dictation-source">${escapeHtml(record.sourceText)}</p>` : ""}
            ${attempt ? renderMistakes(attempt, record) : ""}
          `
          : ""
      }
    </article>
  `;
}

function renderCurrent() {
  if (!activeRecord) {
    currentEl.className = "dictation-current empty-state";
    currentEl.textContent = "Generated dictation audio will appear here.";
    return;
  }

  currentEl.className = "dictation-current";
  currentEl.innerHTML = renderPracticeCard(activeRecord, { current: true });
}

function renderHistory() {
  applyFilters({ resetPage: false });

  if (!records.length) {
    listEl.className = "history-list empty-state";
    listEl.textContent = "No dictation records yet.";
    updatePager(1);
    return;
  }

  if (!filteredRecords.length) {
    listEl.className = "history-list empty-state";
    listEl.textContent = "No dictation records match this search.";
    updatePager(1);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / historyPageSize));
  recordPage = Math.min(recordPage, totalPages);
  const startIndex = (recordPage - 1) * historyPageSize;
  const pageRecords = filteredRecords.slice(startIndex, startIndex + historyPageSize);

  listEl.className = "history-list";
  listEl.innerHTML = pageRecords.map((record) => renderPracticeCard(record)).join("");
  updatePager(totalPages);
}

async function loadRecords() {
  records = await apiFetch("/api/dictation");
  applyFilters({ resetPage: false });
  const requestedRecordId = new URLSearchParams(window.location.search).get("record");
  if (requestedRecordId && !activeRecord) {
    activeRecord = records.find((record) => record.id === requestedRecordId) ?? null;
    if (activeRecord) {
      setStatus("Loaded reused audio from TTS comparison. Listen first, then type what you heard.");
    }
  }
  if (activeRecord) {
    activeRecord = records.find((record) => record.id === activeRecord.id) ?? activeRecord;
  }
  renderCurrent();
  renderHistory();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  startButton.disabled = true;
  startButton.textContent = "Generating...";
  try {
    const record = await apiFetch("/api/dictation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceText: sourceTextInput.value,
        voiceId: voiceSelect.value,
        speedRatio: Number(speedInput.value),
        volumeRatio: 1
      })
    });
    activeRecord = record;
    expandedHistoryRecords.add(record.id);
    await loadRecords();
    setStatus("Dictation audio is ready. Listen first, then type what you heard.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    startButton.disabled = false;
    startButton.textContent = "Generate dictation";
  }
});

document.addEventListener("submit", async (event) => {
  const checkForm = event.target.closest("[data-check-dictation]");
  if (!checkForm) {
    return;
  }

  event.preventDefault();
  const recordId = checkForm.dataset.checkDictation;
  const submitButton = checkForm.querySelector("button[type='submit']");
  const answerInput = checkForm.querySelector(".dictation-answer");
  submitButton.disabled = true;
  submitButton.textContent = "Checking...";
  try {
    const payload = await apiFetch(`/api/dictation/${recordId}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userText: answerInput.value })
    });
    activeRecord = payload.record;
    expandedHistoryRecords.add(recordId);
    await loadRecords();
    setStatus(`Checked. Accuracy ${payload.attempt.score}%.`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Check answer";
  }
});

document.addEventListener("click", async (event) => {
  const sample = event.target.closest("#dictation-sample");
  if (sample) {
    sourceTextInput.value = samples[Math.floor(Math.random() * samples.length)];
    updateCounter();
    sourceTextInput.focus();
    return;
  }

  const toggleCardButton = event.target.closest("[data-toggle-dictation-card]");
  if (toggleCardButton) {
    const recordId = toggleCardButton.dataset.toggleDictationCard;
    if (expandedHistoryRecords.has(recordId)) {
      expandedHistoryRecords.delete(recordId);
    } else {
      expandedHistoryRecords.add(recordId);
    }
    renderHistory();
    return;
  }

  const practiceButton = event.target.closest("[data-practice-dictation]");
  if (practiceButton) {
    activeRecord = records.find((record) => record.id === practiceButton.dataset.practiceDictation);
    if (activeRecord) {
      expandedHistoryRecords.add(activeRecord.id);
    }
    renderCurrent();
    setStatus("Loaded this record into the current exercise.");
    return;
  }

  const revealButton = event.target.closest("[data-reveal-dictation]");
  if (revealButton) {
    const recordId = revealButton.dataset.revealDictation;
    if (revealedRecords.has(recordId)) {
      revealedRecords.delete(recordId);
    } else {
      revealedRecords.add(recordId);
    }
    renderCurrent();
    renderHistory();
    return;
  }

  const reviewButton = event.target.closest("[data-review-dictation]");
  if (reviewButton) {
    reviewButton.disabled = true;
    reviewButton.textContent = "Reviewing...";
    try {
      const payload = await apiFetch(
        `/api/dictation/${reviewButton.dataset.reviewDictation}/attempts/${reviewButton.dataset.attemptId}/review`,
        { method: "POST" }
      );
      activeRecord = payload.record;
      expandedHistoryRecords.add(reviewButton.dataset.reviewDictation);
      await loadRecords();
      setStatus(`AI review ready. DeepSeek score ${payload.aiReview.aiScore ?? "-"}%.`);
    } catch (error) {
      reviewButton.disabled = false;
      reviewButton.textContent = "AI review";
      setStatus(error.message, "error");
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete-dictation]");
  if (deleteButton) {
    await apiFetch(`/api/dictation/${deleteButton.dataset.deleteDictation}`, { method: "DELETE" });
    if (activeRecord?.id === deleteButton.dataset.deleteDictation) {
      activeRecord = null;
    }
    revealedRecords.delete(deleteButton.dataset.deleteDictation);
    expandedHistoryRecords.delete(deleteButton.dataset.deleteDictation);
    if (recordPage > 1 && filteredRecords.length % historyPageSize === 1) {
      recordPage -= 1;
    }
    await loadRecords();
    setStatus("Deleted one dictation record.");
    return;
  }
});

clearButton.addEventListener("click", async () => {
  await apiFetch("/api/dictation", { method: "DELETE" });
  activeRecord = null;
  recordPage = 1;
  revealedRecords.clear();
  expandedHistoryRecords.clear();
  await loadRecords();
  setStatus("Dictation history cleared.");
});

searchInput.addEventListener("input", () => {
  applyFilters();
  renderHistory();
});

resetButton.addEventListener("click", () => {
  searchInput.value = "";
  applyFilters();
  renderHistory();
});

prevButton.addEventListener("click", () => {
  recordPage = Math.max(1, recordPage - 1);
  renderHistory();
});

nextButton.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / historyPageSize));
  recordPage = Math.min(totalPages, recordPage + 1);
  renderHistory();
});

sourceTextInput.addEventListener("input", updateCounter);
speedInput.addEventListener("input", updateSpeedLabel);

updateCounter();
updateSpeedLabel();
loadRecords().catch((error) => setStatus(error.message, "error"));
