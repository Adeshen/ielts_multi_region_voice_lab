import { IELTS_CORE_VOCABULARY } from "./ieltsVocabulary.js";

const functionWords = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "from",
  "with",
  "by",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "that",
  "which",
  "who",
  "it",
  "this",
  "these",
  "those"
]);

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

function editDistance(left, right) {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const dp = Array.from({ length: rows }, () => Array(columns).fill(0));

  for (let row = 0; row < rows; row += 1) {
    dp[row][0] = row;
  }
  for (let column = 0; column < columns; column += 1) {
    dp[0][column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      dp[row][column] = Math.min(
        dp[row - 1][column] + 1,
        dp[row][column - 1] + 1,
        dp[row - 1][column - 1] + cost
      );
    }
  }

  return dp[left.length][right.length];
}

function classifySubstitution(expected, actual) {
  const distance = editDistance(expected, actual);
  const maxLength = Math.max(expected.length, actual.length);
  return distance <= Math.max(1, Math.floor(maxLength * 0.34)) ? "spelling" : "wrong_word";
}

function alignWords(expectedWords, actualWords) {
  const rows = expectedWords.length + 1;
  const columns = actualWords.length + 1;
  const dp = Array.from({ length: rows }, () => Array(columns).fill(0));

  for (let row = 0; row < rows; row += 1) {
    dp[row][0] = row;
  }
  for (let column = 0; column < columns; column += 1) {
    dp[0][column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = expectedWords[row - 1] === actualWords[column - 1] ? 0 : 1;
      dp[row][column] = Math.min(
        dp[row - 1][column] + 1,
        dp[row][column - 1] + 1,
        dp[row - 1][column - 1] + substitutionCost
      );
    }
  }

  const operations = [];
  let row = expectedWords.length;
  let column = actualWords.length;

  while (row > 0 || column > 0) {
    if (
      row > 0 &&
      column > 0 &&
      dp[row][column] === dp[row - 1][column - 1] + (expectedWords[row - 1] === actualWords[column - 1] ? 0 : 1)
    ) {
      const expected = expectedWords[row - 1];
      const actual = actualWords[column - 1];
      operations.unshift({
        type: expected === actual ? "correct" : classifySubstitution(expected, actual),
        expected,
        actual
      });
      row -= 1;
      column -= 1;
    } else if (row > 0 && dp[row][column] === dp[row - 1][column] + 1) {
      operations.unshift({ type: "missing", expected: expectedWords[row - 1], actual: "" });
      row -= 1;
    } else {
      operations.unshift({ type: "extra", expected: "", actual: actualWords[column - 1] });
      column -= 1;
    }
  }

  return operations;
}

function phraseInText(phrase, normalizedText) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) {
    return false;
  }
  return new RegExp(`(^|\\s)${normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(normalizedText);
}

export function compareDictation(sourceText, userText) {
  const expectedWords = tokenize(sourceText);
  const actualWords = tokenize(userText);
  const operations = alignWords(expectedWords, actualWords);
  const mistakes = operations.filter((item) => item.type !== "correct");
  const correctCount = operations.filter((item) => item.type === "correct").length;
  const spellingCount = operations.filter((item) => item.type === "spelling").length;
  const scoreBase = expectedWords.length || 1;
  const score = Math.max(0, Math.round(((correctCount + spellingCount * 0.5) / scoreBase) * 100));
  const missingFunctionWords = mistakes
    .filter((item) => item.type === "missing" && functionWords.has(item.expected))
    .map((item) => item.expected);
  const normalizedExpected = normalizeText(sourceText);
  const normalizedActual = normalizeText(userText);
  const coreVocabulary = IELTS_CORE_VOCABULARY.filter((word) => phraseInText(word, normalizedExpected)).map((word) => ({
    word,
    heard: phraseInText(word, normalizedActual)
  }));

  return {
    score,
    expectedWordCount: expectedWords.length,
    actualWordCount: actualWords.length,
    correctCount,
    spellingCount,
    missingCount: mistakes.filter((item) => item.type === "missing").length,
    extraCount: mistakes.filter((item) => item.type === "extra").length,
    wrongWordCount: mistakes.filter((item) => item.type === "wrong_word").length,
    missingFunctionWords: [...new Set(missingFunctionWords)],
    coreVocabulary,
    operations,
    mistakes
  };
}
