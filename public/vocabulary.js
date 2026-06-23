const form = document.querySelector("#vocabulary-form");
const topicSelect = document.querySelector("#vocabulary-topic");
const modeSelect = document.querySelector("#vocabulary-mode");
const limitInput = document.querySelector("#vocabulary-limit");
const voiceSelect = document.querySelector("#vocabulary-voice");
const speedInput = document.querySelector("#vocabulary-speed");
const speedValue = document.querySelector("#vocabulary-speed-value");
const showDefinitionInput = document.querySelector("#show-definition");
const loadButton = document.querySelector("#load-vocabulary");
const startFirstButton = document.querySelector("#start-first-vocabulary");
const topicPanel = document.querySelector("#vocabulary-topic-panel");
const statusEl = document.querySelector("#vocabulary-status");
const currentEl = document.querySelector("#vocabulary-current");
const queueEl = document.querySelector("#vocabulary-queue");
const historyEl = document.querySelector("#vocabulary-history");
const searchInput = document.querySelector("#vocabulary-search");
const errorSelect = document.querySelector("#vocabulary-error");
const resetButton = document.querySelector("#vocabulary-reset");
const clearButton = document.querySelector("#clear-vocabulary");
const prevButton = document.querySelector("#vocabulary-prev");
const nextButton = document.querySelector("#vocabulary-next");
const pageStatus = document.querySelector("#vocabulary-page-status");
const filterStatus = document.querySelector("#vocabulary-filter-status");

let topics = [];
let queue = [];
let records = [];
let filteredRecords = [];
let activeRecord = null;
let historyPage = 1;
const revealedRecords = new Set();
const expandedHistoryRecords = new Set();
const historyPageSize = 5;

const errorLabels = {
  target_word_missed: "target missed",
  spelling: "spelling",
  function_words: "function words",
  similar_confusion: "similar word",
  missing_words: "missing words"
};

function setStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status ${type === "error" ? "error" : ""}`.trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function updateSpeedLabel() {
  speedValue.textContent = `${Number(speedInput.value).toFixed(2)}x`;
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

function errorTagText(tags = []) {
  return tags.map((tag) => errorLabels[tag] || tag.replaceAll("_", " ")).join(", ") || "none";
}

function searchText(record) {
  return [
    record.word,
    record.topic,
    record.sourceText,
    record.vocabulary?.definition,
    record.vocabulary?.partOfSpeech,
    ...(record.attempts ?? []).map((attempt) => attempt.userText),
    ...(record.errorTags ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function applyHistoryFilters({ resetPage = true } = {}) {
  const query = searchInput.value.trim().toLowerCase();
  const errorTag = errorSelect.value;
  filteredRecords = records.filter((record) => {
    const matchesQuery = !query || searchText(record).includes(query);
    const matchesError = !errorTag || (record.errorTags ?? []).includes(errorTag);
    return matchesQuery && matchesError;
  });
  if (resetPage) {
    historyPage = 1;
  }
}

function updatePager(totalPages) {
  const hasRecords = filteredRecords.length > 0;
  prevButton.disabled = !hasRecords || historyPage <= 1;
  nextButton.disabled = !hasRecords || historyPage >= totalPages;
  pageStatus.textContent = hasRecords ? `${historyPage} / ${totalPages}` : "";
  filterStatus.textContent = records.length ? `${filteredRecords.length} of ${records.length} records` : "";
}

function renderTopicOptions() {
  topicSelect.innerHTML = topics
    .map(
      (topic) => `
        <option value="${escapeHtml(topic.id)}">
          ${String(topic.topicIndex).padStart(2, "0")} ${escapeHtml(topic.title)} (${escapeHtml(topic.sentenceCount)})
        </option>
      `
    )
    .join("");
}

function selectedTopic() {
  return topics.find((topic) => topic.id === topicSelect.value) || topics[0] || null;
}

function renderTopicPanel() {
  const topic = selectedTopic();
  if (!topic) {
    topicPanel.className = "topic-panel empty-state";
    topicPanel.textContent = "Choose a topic to begin.";
    return;
  }

  topicPanel.className = "topic-panel";
  topicPanel.innerHTML = `
    <div class="topic-panel-main">
      <div>
        <p class="eyebrow">${String(topic.topicIndex).padStart(2, "0")} · ${escapeHtml(topic.title)}</p>
        <h3>${escapeHtml(topic.sentenceCount)} sentence items</h3>
      </div>
      <div class="dictation-score-row">
        <span>${escapeHtml(topic.practicedCount)} practiced</span>
        <span>${escapeHtml(topic.dueCount)} due</span>
        <span>${escapeHtml(topic.mistakeCount)} mistakes</span>
      </div>
    </div>
    <audio controls preload="metadata" src="${escapeHtml(topic.audioUrl)}"></audio>
  `;
}

function renderQueue() {
  if (!queue.length) {
    queueEl.className = "vocabulary-grid empty-state";
    queueEl.textContent = "No items in this queue.";
    return;
  }

  queueEl.className = "vocabulary-grid";
  queueEl.innerHTML = queue
    .map((entry) => {
      const progress = entry.progress || {};
      return `
        <article class="vocabulary-card" data-entry-id="${escapeHtml(entry.id)}">
          <div>
            <p class="eyebrow">${escapeHtml(entry.topic)}</p>
            <h3>${escapeHtml(entry.word)}</h3>
            <p class="muted">${escapeHtml(entry.partOfSpeech || "-")} · ${escapeHtml(entry.definition || "No definition")}</p>
          </div>
          <div class="recording-compact-meta prompt-attempt-meta">
            <span>Best ${escapeHtml(progress.bestScore ?? 0)}%</span>
            <span>${escapeHtml(progress.practiceCount ?? 0)} practice${progress.practiceCount === 1 ? "" : "s"}</span>
            <span>${escapeHtml(progress.stage || "new")}</span>
          </div>
          <div class="history-card-actions">
            <button type="button" class="primary-button compact-button" data-start-vocabulary="${escapeHtml(entry.id)}">Start</button>
            ${
              entry.wordAudioUrl
                ? `<audio class="word-audio" controls preload="none" src="${escapeHtml(entry.wordAudioUrl)}"></audio>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDiff(operations = []) {
  if (!operations.length) {
    return "";
  }
  return `
    <div class="dictation-diff">
      ${operations
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
            return `<span class="diff-token is-spelling">${escapeHtml(item.actual)} -> ${escapeHtml(item.expected)}</span>`;
          }
          return `<span class="diff-token is-wrong">${escapeHtml(item.actual)} -> ${escapeHtml(item.expected)}</span>`;
        })
        .join("")}
    </div>
  `;
}

function renderAttemptResult(attempt, record) {
  if (!attempt) {
    return "";
  }

  return `
    <div class="dictation-result">
      <div class="dictation-score-row">
        <span class="dictation-score">${escapeHtml(attempt.score)}%</span>
        <span>${attempt.targetHeard ? "target heard" : "target missed"}</span>
        <span>${escapeHtml(errorTagText(attempt.errorTags))}</span>
        <span>next ${escapeHtml(formatDate(attempt.nextReviewAt))}</span>
      </div>
      ${renderDiff(attempt.operations)}
      <div class="dictation-core-grid">
        <div>
          <h4>Target word</h4>
          <p>${escapeHtml(record.word)}${attempt.heardVariant ? ` · heard ${escapeHtml(attempt.heardVariant)}` : ""}</p>
        </div>
        <div>
          <h4>Sentence</h4>
          <p>${escapeHtml(record.sourceText)}</p>
        </div>
      </div>
    </div>
  `;
}

function renderPracticeCard(record, { current = false } = {}) {
  const attempt = latestAttempt(record);
  const isExpanded = current || expandedHistoryRecords.has(record.id);
  const isRevealed = revealedRecords.has(record.id) || Boolean(attempt);
  const clue = showDefinitionInput.checked
    ? `<p class="vocabulary-clue">${escapeHtml(record.vocabulary?.partOfSpeech || "")} ${escapeHtml(record.vocabulary?.definition || "")}</p>`
    : "";

  return `
    <article class="history-card dictation-card ${isExpanded ? "is-expanded" : "is-collapsed"}" data-id="${escapeHtml(record.id)}">
      <div class="history-title-row">
        <div>
          <p class="eyebrow">${escapeHtml(record.topic)} · ${escapeHtml(record.voice?.shortLabel || "Voice")}</p>
          <h3>${current ? "Target listening" : escapeHtml(record.word)}</h3>
          <p class="muted">Speed ${escapeHtml(record.speedRatio ?? "-")}x · ${escapeHtml(record.stage || "new")}</p>
          <div class="recording-compact-meta prompt-attempt-meta">
            <span>${escapeHtml(record.attempts?.length ?? 0)} attempt${record.attempts?.length === 1 ? "" : "s"}</span>
            ${attempt ? `<span>Latest ${escapeHtml(attempt.score)}%</span>` : ""}
            <span>${record.targetHeard ? "target heard" : record.targetHeard === false ? "target missed" : "new"}</span>
          </div>
        </div>
        <div class="history-card-actions">
          ${current ? "" : `<button type="button" class="ghost-button compact-button" data-toggle-vocabulary-card="${escapeHtml(record.id)}">${isExpanded ? "Compact" : "Expand"}</button>`}
          ${
            isExpanded
              ? `<button type="button" class="ghost-button compact-button" data-reveal-vocabulary="${escapeHtml(record.id)}">
                  ${isRevealed ? "Hide clue" : "Reveal"}
                </button>`
              : ""
          }
          ${current || isExpanded ? "" : `<button type="button" class="ghost-button compact-button" data-practice-vocabulary="${escapeHtml(record.id)}">Practice</button>`}
          <button type="button" class="danger-button compact-button" data-delete-vocabulary="${escapeHtml(record.id)}">Delete</button>
        </div>
      </div>
      ${
        isExpanded
          ? `
            ${clue}
            <audio controls preload="metadata" src="${escapeHtml(record.audioUrl)}"></audio>
            <form class="dictation-answer-form" data-check-vocabulary="${escapeHtml(record.id)}">
              <label>
                <span>Your dictation</span>
                <textarea
                  class="dictation-answer"
                  rows="4"
                  maxlength="1000"
                  placeholder="Type the full sentence you hear."
                  required
                >${escapeHtml(attempt?.userText ?? "")}</textarea>
              </label>
              <button type="submit" class="primary-button compact-button">Check answer</button>
            </form>
            ${
              isRevealed
                ? `<p class="dictation-source"><strong>${escapeHtml(record.word)}</strong> · ${escapeHtml(record.sourceText)}${
                    record.vocabulary?.note ? ` · ${escapeHtml(record.vocabulary.note)}` : ""
                  }</p>`
                : ""
            }
            ${renderAttemptResult(attempt, record)}
          `
          : ""
      }
    </article>
  `;
}

function renderCurrent() {
  if (!activeRecord) {
    currentEl.className = "dictation-current empty-state";
    currentEl.textContent = "Start a vocabulary item to generate dictation audio.";
    return;
  }
  currentEl.className = "dictation-current";
  currentEl.innerHTML = renderPracticeCard(activeRecord, { current: true });
}

function renderHistory() {
  applyHistoryFilters({ resetPage: false });
  if (!records.length) {
    historyEl.className = "history-list empty-state";
    historyEl.textContent = "No vocabulary dictation records yet.";
    updatePager(1);
    return;
  }
  if (!filteredRecords.length) {
    historyEl.className = "history-list empty-state";
    historyEl.textContent = "No vocabulary records match this filter.";
    updatePager(1);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / historyPageSize));
  historyPage = Math.min(historyPage, totalPages);
  const pageRecords = filteredRecords.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize);
  historyEl.className = "history-list";
  historyEl.innerHTML = pageRecords.map((record) => renderPracticeCard(record)).join("");
  updatePager(totalPages);
}

function isEditableTarget(target) {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest("textarea, input, select, [contenteditable='true']"));
}

function preferredAudio() {
  const audioElements = [...document.querySelectorAll(".dictation-card audio")];
  const playingAudio = audioElements.find((audio) => !audio.paused && !audio.ended);
  return playingAudio || currentEl.querySelector("audio") || audioElements[0] || null;
}

async function toggleAudio() {
  const audio = preferredAudio();
  if (!audio) {
    setStatus("No vocabulary audio is ready yet.", "error");
    return;
  }
  if (audio.paused || audio.ended) {
    if (audio.ended) {
      audio.currentTime = 0;
    }
    await audio.play();
    setStatus("Playing vocabulary dictation audio.");
    return;
  }
  audio.pause();
  setStatus("Paused vocabulary dictation audio.");
}

async function loadTopics() {
  const payload = await apiFetch("/api/vocabulary/topics");
  topics = payload.topics || [];
  renderTopicOptions();
  renderTopicPanel();
}

async function loadHistory() {
  records = await apiFetch("/api/vocabulary/history");
  if (activeRecord) {
    activeRecord = records.find((record) => record.id === activeRecord.id) || activeRecord;
  }
  renderCurrent();
  renderHistory();
}

async function loadQueue() {
  const params = new URLSearchParams({
    topicId: topicSelect.value,
    mode: modeSelect.value,
    limit: limitInput.value
  });
  const payload = await apiFetch(`/api/vocabulary/queue?${params}`);
  queue = payload.entries || [];
  renderQueue();
  setStatus(`Loaded ${queue.length} vocabulary item${queue.length === 1 ? "" : "s"}.`);
}

async function startVocabularyEntry(entryId) {
  const record = await apiFetch("/api/vocabulary/dictation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entryId,
      voiceId: voiceSelect.value,
      speedRatio: Number(speedInput.value),
      volumeRatio: 1
    })
  });
  activeRecord = record;
  await loadHistory();
  setStatus("Vocabulary audio is ready. Press Shift + Space to pause or resume.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  loadButton.disabled = true;
  loadButton.textContent = "Loading...";
  try {
    await loadQueue();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    loadButton.disabled = false;
    loadButton.textContent = "Load practice queue";
  }
});

document.addEventListener("submit", async (event) => {
  const checkForm = event.target.closest("[data-check-vocabulary]");
  if (!checkForm) {
    return;
  }

  event.preventDefault();
  const recordId = checkForm.dataset.checkVocabulary;
  const answerInput = checkForm.querySelector(".dictation-answer");
  const submitButton = checkForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Checking...";
  try {
    const payload = await apiFetch(`/api/vocabulary/dictation/${recordId}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userText: answerInput.value })
    });
    activeRecord = payload.record;
    revealedRecords.add(recordId);
    await Promise.all([loadTopics(), loadQueue(), loadHistory()]);
    setStatus(`Checked. Score ${payload.attempt.score}%. ${payload.attempt.targetHeard ? "Target word heard." : "Target word missed."}`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Check answer";
  }
});

document.addEventListener("click", async (event) => {
  const startButton = event.target.closest("[data-start-vocabulary]");
  if (startButton) {
    startButton.disabled = true;
    startButton.textContent = "Starting...";
    try {
      await startVocabularyEntry(startButton.dataset.startVocabulary);
    } catch (error) {
      setStatus(error.message, "error");
      startButton.disabled = false;
      startButton.textContent = "Start";
    }
    return;
  }

  const practiceButton = event.target.closest("[data-practice-vocabulary]");
  if (practiceButton) {
    activeRecord = records.find((record) => record.id === practiceButton.dataset.practiceVocabulary) || null;
    renderCurrent();
    setStatus("Loaded this vocabulary record. Press Shift + Space to pause or resume.");
    return;
  }

  const toggleButton = event.target.closest("[data-toggle-vocabulary-card]");
  if (toggleButton) {
    const recordId = toggleButton.dataset.toggleVocabularyCard;
    if (expandedHistoryRecords.has(recordId)) {
      expandedHistoryRecords.delete(recordId);
    } else {
      expandedHistoryRecords.add(recordId);
    }
    renderHistory();
    return;
  }

  const revealButton = event.target.closest("[data-reveal-vocabulary]");
  if (revealButton) {
    const recordId = revealButton.dataset.revealVocabulary;
    if (revealedRecords.has(recordId)) {
      revealedRecords.delete(recordId);
    } else {
      revealedRecords.add(recordId);
    }
    renderCurrent();
    renderHistory();
    return;
  }

  const deleteButton = event.target.closest("[data-delete-vocabulary]");
  if (deleteButton) {
    await apiFetch(`/api/vocabulary/dictation/${deleteButton.dataset.deleteVocabulary}`, { method: "DELETE" });
    if (activeRecord?.id === deleteButton.dataset.deleteVocabulary) {
      activeRecord = null;
    }
    revealedRecords.delete(deleteButton.dataset.deleteVocabulary);
    expandedHistoryRecords.delete(deleteButton.dataset.deleteVocabulary);
    await Promise.all([loadTopics(), loadQueue(), loadHistory()]);
    setStatus("Deleted one vocabulary dictation record.");
  }
});

startFirstButton.addEventListener("click", async () => {
  try {
    if (!queue.length) {
      await loadQueue();
    }
    if (!queue.length) {
      setStatus("No queue item is available.", "error");
      return;
    }
    await startVocabularyEntry(queue[0].id);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

topicSelect.addEventListener("change", () => {
  renderTopicPanel();
  queue = [];
  renderQueue();
});

modeSelect.addEventListener("change", () => {
  loadQueue().catch((error) => setStatus(error.message, "error"));
});
speedInput.addEventListener("input", updateSpeedLabel);
showDefinitionInput.addEventListener("change", () => {
  renderCurrent();
});

searchInput.addEventListener("input", () => {
  applyHistoryFilters();
  renderHistory();
});

errorSelect.addEventListener("change", () => {
  applyHistoryFilters();
  renderHistory();
});

resetButton.addEventListener("click", () => {
  searchInput.value = "";
  errorSelect.value = "";
  applyHistoryFilters();
  renderHistory();
});

prevButton.addEventListener("click", () => {
  historyPage = Math.max(1, historyPage - 1);
  renderHistory();
});

nextButton.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / historyPageSize));
  historyPage = Math.min(totalPages, historyPage + 1);
  renderHistory();
});

clearButton.addEventListener("click", async () => {
  await apiFetch("/api/vocabulary/history", { method: "DELETE" });
  activeRecord = null;
  revealedRecords.clear();
  expandedHistoryRecords.clear();
  await Promise.all([loadTopics(), loadQueue(), loadHistory()]);
  setStatus("Vocabulary history cleared.");
});

document.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }
  const isSpace = event.code === "Space" || event.key === " ";
  const isTextEditing = isEditableTarget(event.target);
  const shouldToggle = event.key === "Escape" || (event.shiftKey && isSpace) || (!isTextEditing && isSpace);
  if (!shouldToggle) {
    return;
  }
  event.preventDefault();
  toggleAudio().catch((error) => setStatus(error.message, "error"));
});

updateSpeedLabel();
Promise.all([loadTopics(), loadHistory()])
  .then(loadQueue)
  .catch((error) => setStatus(error.message, "error"));
