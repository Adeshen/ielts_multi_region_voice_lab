import { promises as fs } from "node:fs";
import path from "node:path";

const vocabularyFilePath = process.env.VOCABULARY_FILE || path.join(process.cwd(), "data", "vocabulary.txt");
const githubAudioBaseUrl =
  "https://raw.githubusercontent.com/hefengxian/my-ielts/master/public/vocabulary/audio";
const separators = new Set(["+++", "---", "==="]);

let cachedBank;
let cachedMtimeMs = 0;

export async function loadVocabularyBank() {
  const stat = await fs.stat(vocabularyFilePath);
  if (cachedBank && cachedMtimeMs === stat.mtimeMs) {
    return cachedBank;
  }

  const text = await fs.readFile(vocabularyFilePath, "utf8");
  cachedBank = parseVocabularyText(text);
  cachedMtimeMs = stat.mtimeMs;
  return cachedBank;
}

export async function listVocabularyTopics() {
  const bank = await loadVocabularyBank();
  return bank.topics;
}

export async function findVocabularyEntry(entryId) {
  const bank = await loadVocabularyBank();
  return bank.entries.find((entry) => entry.id === entryId) || null;
}

export async function buildVocabularyQueue({ topicId, mode = "new", limit = 15, records = [] } = {}) {
  const bank = await loadVocabularyBank();
  const now = Date.now();
  const summaries = summarizeVocabularyProgress(records);
  const entries = bank.entries
    .filter((entry) => entry.sentence)
    .filter((entry) => !topicId || entry.topicId === topicId)
    .map((entry) => ({
      ...entry,
      progress: summaries.get(entry.id) || emptyProgress(entry.id)
    }));

  let filtered;
  if (mode === "review") {
    filtered = entries.filter((entry) => entry.progress.nextReviewAt && Date.parse(entry.progress.nextReviewAt) <= now);
    if (!filtered.length) {
      filtered = entries.filter((entry) => entry.progress.practiceCount > 0);
    }
    filtered.sort(compareReviewPriority);
  } else if (mode === "mistakes") {
    filtered = entries
      .filter((entry) => entry.progress.practiceCount > 0)
      .filter(
        (entry) =>
          (entry.progress.latestScore != null && entry.progress.latestScore < 85) ||
          entry.progress.targetHeard === false ||
          (entry.progress.errorTags || []).length > 0
      )
      .sort(compareMistakePriority);
  } else {
    filtered = entries
      .filter((entry) => entry.progress.practiceCount === 0)
      .sort((left, right) => left.topicIndex - right.topicIndex || left.entryIndex - right.entryIndex);
  }

  return filtered.slice(0, Math.max(1, Math.min(50, Number(limit) || 15))).map(publicVocabularyEntry);
}

export function summarizeVocabularyProgress(records = []) {
  const summaries = new Map();
  const sortedRecords = [...records].sort((left, right) => Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0));

  for (const record of sortedRecords) {
    if (!record.entryId) {
      continue;
    }
    const latestAttempt = (record.attempts || [])[0] || null;
    const summary = summaries.get(record.entryId) || emptyProgress(record.entryId);
    summary.practiceCount += 1;
    summary.lastRecordId = record.id;
    summary.lastPracticedAt = record.createdAt || summary.lastPracticedAt;
    summary.nextReviewAt = record.nextReviewAt || summary.nextReviewAt;
    summary.consecutiveCorrect = record.consecutiveCorrect ?? summary.consecutiveCorrect;
    summary.stage = record.stage || summary.stage;
    summary.errorTags = record.errorTags || summary.errorTags;
    summary.targetHeard = record.targetHeard ?? summary.targetHeard;

    if (latestAttempt) {
      summary.attemptCount += 1;
      summary.latestScore = latestAttempt.score ?? summary.latestScore;
      summary.bestScore = Math.max(summary.bestScore, latestAttempt.score ?? 0);
      summary.targetHeard = latestAttempt.targetHeard ?? summary.targetHeard;
      summary.errorTags = latestAttempt.errorTags || summary.errorTags;
    }
    summaries.set(record.entryId, summary);
  }

  return summaries;
}

export function publicVocabularyEntry(entry) {
  return {
    id: entry.id,
    topicId: entry.topicId,
    topic: entry.topic,
    topicIndex: entry.topicIndex,
    entryIndex: entry.entryIndex,
    word: entry.word,
    variants: entry.variants,
    partOfSpeech: entry.partOfSpeech,
    definition: entry.definition,
    sentence: entry.sentence,
    note: entry.note,
    wordAudioUrl: entry.wordAudioUrl,
    topicAudioUrl: entry.topicAudioUrl,
    progress: entry.progress
  };
}

export function evaluateVocabularyAttempt({ entry, result, userText, previousRecord }) {
  const normalizedAnswer = normalizeForMatching(userText);
  const heardVariant = entry.variants.find((variant) => phraseInNormalizedText(variant, normalizedAnswer));
  const targetHeard = Boolean(heardVariant);
  const errorTags = [];

  if (!targetHeard) {
    errorTags.push("target_word_missed");
  }
  if (result.spellingCount > 0) {
    errorTags.push("spelling");
  }
  if ((result.missingFunctionWords || []).length > 0) {
    errorTags.push("function_words");
  }
  if (result.wrongWordCount > 0) {
    errorTags.push("similar_confusion");
  }
  if (result.missingCount > 0) {
    errorTags.push("missing_words");
  }

  const cleanAttempt = result.score >= 95 && targetHeard && result.spellingCount === 0 && result.wrongWordCount === 0;
  const consecutiveCorrect = cleanAttempt ? (previousRecord?.consecutiveCorrect || 0) + 1 : 0;
  const stage = stageForAttempt({ score: result.score, consecutiveCorrect });
  const nextReviewAt = nextReviewDate({ score: result.score, consecutiveCorrect, errorTags });

  return {
    targetHeard,
    heardVariant: heardVariant || "",
    errorTags: [...new Set(errorTags)],
    consecutiveCorrect,
    stage,
    nextReviewAt
  };
}

function parseVocabularyText(text) {
  const topics = [];
  const entries = [];
  let currentTopic = null;
  let topicIndex = 0;
  let topicEntryIndex = 0;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || separators.has(trimmed)) {
      continue;
    }

    if (!trimmed.includes("|")) {
      topicIndex += 1;
      topicEntryIndex = 0;
      currentTopic = createTopic({ title: trimmed, topicIndex });
      topics.push(currentTopic);
      continue;
    }

    if (!currentTopic) {
      continue;
    }

    const [rawWord = "", partOfSpeech = "", definition = "", sentence = "", note = ""] = trimmed.split("|");
    const word = rawWord.trim();
    if (!word) {
      continue;
    }

    topicEntryIndex += 1;
    const entry = {
      id: `t${topicIndex}-e${topicEntryIndex}`,
      topicId: currentTopic.id,
      topic: currentTopic.title,
      topicIndex,
      entryIndex: topicEntryIndex,
      word,
      variants: variantsForWord(word),
      partOfSpeech: partOfSpeech.trim(),
      definition: definition.trim(),
      sentence: sentence.trim(),
      note: note.trim(),
      wordAudioUrl: rawAudioUrl(currentTopic.audioFolderName, `${variantsForWord(word)[0]}.mp3`),
      topicAudioUrl: currentTopic.audioUrl
    };
    entries.push(entry);
  }

  return {
    topics: topics.map((topic) => ({
      ...topic,
      entryCount: entries.filter((entry) => entry.topicId === topic.id).length,
      sentenceCount: entries.filter((entry) => entry.topicId === topic.id && entry.sentence).length
    })),
    entries
  };
}

function createTopic({ title, topicIndex }) {
  const padded = String(topicIndex).padStart(2, "0");
  const audioFolderName = `${padded}_${title}`;
  return {
    id: `t${topicIndex}`,
    title,
    topicIndex,
    audioFolderName,
    audioUrl: rawAudioUrl(`${audioFolderName}.mp3`)
  };
}

function variantsForWord(word) {
  const splitVariants = word
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  return [
    ...splitVariants,
    word
  ].filter((item, index, items) => items.indexOf(item) === index);
}

function rawAudioUrl(...segments) {
  return `${githubAudioBaseUrl}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function emptyProgress(entryId) {
  return {
    entryId,
    practiceCount: 0,
    attemptCount: 0,
    latestScore: null,
    bestScore: 0,
    targetHeard: null,
    lastPracticedAt: null,
    nextReviewAt: null,
    consecutiveCorrect: 0,
    stage: "new",
    errorTags: []
  };
}

function compareReviewPriority(left, right) {
  const leftDue = Date.parse(left.progress.nextReviewAt || 0);
  const rightDue = Date.parse(right.progress.nextReviewAt || 0);
  return leftDue - rightDue || (left.progress.latestScore ?? 101) - (right.progress.latestScore ?? 101);
}

function compareMistakePriority(left, right) {
  return (left.progress.latestScore ?? 101) - (right.progress.latestScore ?? 101) || left.entryIndex - right.entryIndex;
}

function stageForAttempt({ score, consecutiveCorrect }) {
  if (consecutiveCorrect >= 2) {
    return "long_term";
  }
  if (score < 70) {
    return "short_sentence";
  }
  if (score < 85) {
    return "normal_sentence";
  }
  return "regional_or_faster";
}

function nextReviewDate({ score, consecutiveCorrect, errorTags }) {
  let delayMs;
  if (errorTags.includes("spelling") || errorTags.includes("target_word_missed") || score < 70) {
    delayMs = 6 * 60 * 60 * 1000;
  } else if (score < 85) {
    delayMs = 24 * 60 * 60 * 1000;
  } else if (score < 95) {
    delayMs = 3 * 24 * 60 * 60 * 1000;
  } else if (consecutiveCorrect >= 2) {
    delayMs = 14 * 24 * 60 * 60 * 1000;
  } else {
    delayMs = 7 * 24 * 60 * 60 * 1000;
  }
  return new Date(Date.now() + delayMs).toISOString();
}

function normalizeForMatching(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseInNormalizedText(phrase, normalizedText) {
  const normalizedPhrase = normalizeForMatching(phrase);
  if (!normalizedPhrase) {
    return false;
  }
  return new RegExp(`(^|\\s)${normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(normalizedText);
}
