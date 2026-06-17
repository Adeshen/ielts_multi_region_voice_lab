import {
  IELTS_CORE_VOCABULARY,
  IELTS_CORE_VOCABULARY_LABEL,
  IELTS_MOTHER_TOPICS
} from "./ieltsVocabulary.js";

const deepseekApiUrl = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";
const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";

export function validateDeepseekCredentials() {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("Missing environment variable DEEPSEEK_API_KEY.");
  }
}

function extractJsonObject(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("DeepSeek returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = /\{[\s\S]*\}/.exec(trimmed);
    if (!match) {
      throw new Error("DeepSeek response was not valid JSON.");
    }
    return JSON.parse(match[0]);
  }
}

export async function analyzeSpeakingAnswer({ prompt, transcript }) {
  validateDeepseekCredentials();

  const response = await fetch(deepseekApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: deepseekModel,
      temperature: 0.35,
      max_tokens: 2800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are an IELTS Speaking examiner and coach.",
            "Score only from the provided transcript, not from audio acoustics.",
            "Return strict JSON with no markdown.",
            "Use half-band IELTS scores from 0 to 9.",
            "Use the provided IELTS mother-topic list and core vocabulary bank as coaching references.",
            "Identify the closest mother-topic family, then evaluate lexical resource through both accuracy and natural topic vocabulary.",
            "Do not force vocabulary stuffing: recommend and use only words that fit the learner's answer naturally.",
            "Generate a natural Band 7.5-8.0 model answer based on the learner's ideas, not a generic unrelated answer."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Evaluate this IELTS speaking response and rewrite it into a stronger model answer.",
            questionOrPrompt: prompt,
            learnerTranscript: transcript,
            motherTopicOptions: IELTS_MOTHER_TOPICS,
            coreVocabularySource: IELTS_CORE_VOCABULARY_LABEL,
            coreVocabularyBank: IELTS_CORE_VOCABULARY,
            vocabularyPolicy: [
              "Choose one closest mother topic from motherTopicOptions.",
              "Find core vocabulary already used naturally in the learner transcript.",
              "Recommend 5 to 10 useful core words or phrases from coreVocabularyBank that match this prompt and answer.",
              "Give a short sample phrase for each recommended word so the learner can practice it in context.",
              "List any tempting core words that should be avoided for this answer because they would sound forced or unrelated.",
              "Use several relevant target words naturally in the model answer, but keep the answer fluent and human.",
              "Create Part 2 cue-card keywords that are short enough to write during the one-minute preparation time."
            ],
            requiredJsonShape: {
              overallBand: "number",
              criteria: {
                fluencyCoherence: "number",
                lexicalResource: "number",
                grammarRangeAccuracy: "number",
                pronunciationEstimate: "number or null"
              },
              topicFamily: "closest mother-topic label from motherTopicOptions",
              summary: "short overall diagnosis",
              strengths: ["specific strengths"],
              improvements: ["specific problems to fix"],
              lexicalCoverage: {
                usedCoreVocabulary: ["core vocabulary words or phrases already used naturally"],
                missedOpportunities: [
                  {
                    word: "useful core vocabulary item",
                    whyUseful: "why this word fits the answer",
                    samplePhrase: "short phrase showing natural use"
                  }
                ],
                wordsToAvoidForThisTopic: [
                  {
                    word: "core vocabulary item",
                    reason: "why it would be forced or unrelated here"
                  }
                ]
              },
              sentenceCorrections: [
                {
                  original: "learner phrase or sentence",
                  improved: "corrected version",
                  reason: "short reason"
                }
              ],
              modelAnswer: "improved sample answer using the learner's original content and IELTS style",
              modelAnswerTargetWords: ["core vocabulary intentionally used in the model answer"],
              cueCardKeywords: ["8 to 14 very short keywords or phrases from the model answer, suitable for handwritten Part 2 notes"],
              speakingRoute: [
                {
                  stage: "opening / background / details / feeling / ending",
                  keywords: ["2 to 5 note-style keywords"],
                  purpose: "how these keywords help the learner speak"
                }
              ],
              practiceTip: "one focused next step",
              limitation: "mention that pronunciation is only estimated from transcript unless real speech recognition/phonetic analysis is added"
            }
          })
        }
      ]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.message || `DeepSeek request failed with ${response.status}.`;
    throw new Error(message);
  }

  const content = payload.choices?.[0]?.message?.content;
  return extractJsonObject(content);
}

export async function reviewDictationAttempt({ sourceText, userText, deterministicResult }) {
  validateDeepseekCredentials();

  const response = await fetch(deepseekApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: deepseekModel,
      temperature: 0.2,
      max_tokens: 1800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are an IELTS listening dictation coach.",
            "Compare the target sentence with the learner's typed dictation.",
            "Be more flexible than a raw word diff: consider spelling slips, contractions, plural/singular, near-homophones, word boundary mistakes, and acceptable variants.",
            "Do not invent words that are not supported by the target or learner answer.",
            "Return strict JSON with no markdown."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Review this IELTS dictation attempt and give a teacher-like judgement.",
            sourceText,
            learnerDictation: userText,
            rawProgramResult: deterministicResult,
            requiredJsonShape: {
              aiScore: "integer from 0 to 100",
              judgement: "short overall diagnosis",
              acceptedMatches: [
                {
                  expected: "target word or phrase",
                  actual: "learner word or phrase",
                  reason: "why this can be treated as acceptable or minor"
                }
              ],
              criticalMistakes: [
                {
                  expected: "target word or phrase",
                  actual: "learner word or phrase, or empty if missing",
                  type: "missing / wrong_word / spelling / word_boundary / grammar_word / extra",
                  impact: "why it matters for listening accuracy"
                }
              ],
              likelyListeningIssues: ["weak forms, linking, final consonants, vowel contrast, plural ending, word boundary, spelling, etc."],
              correctedDictation: "the correct sentence",
              practiceAdvice: "one focused drill for the next attempt"
            }
          })
        }
      ]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.message || `DeepSeek request failed with ${response.status}.`;
    throw new Error(message);
  }

  const content = payload.choices?.[0]?.message?.content;
  return extractJsonObject(content);
}
