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
      max_tokens: 1800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are an IELTS Speaking examiner and coach.",
            "Score only from the provided transcript, not from audio acoustics.",
            "Return strict JSON with no markdown.",
            "Use half-band IELTS scores from 0 to 9.",
            "Generate a natural Band 7.5-8.0 model answer based on the learner's ideas, not a generic unrelated answer."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Evaluate this IELTS speaking response and rewrite it into a stronger model answer.",
            questionOrPrompt: prompt,
            learnerTranscript: transcript,
            requiredJsonShape: {
              overallBand: "number",
              criteria: {
                fluencyCoherence: "number",
                lexicalResource: "number",
                grammarRangeAccuracy: "number",
                pronunciationEstimate: "number or null"
              },
              summary: "short overall diagnosis",
              strengths: ["specific strengths"],
              improvements: ["specific problems to fix"],
              sentenceCorrections: [
                {
                  original: "learner phrase or sentence",
                  improved: "corrected version",
                  reason: "short reason"
                }
              ],
              modelAnswer: "improved sample answer using the learner's original content and IELTS style",
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
