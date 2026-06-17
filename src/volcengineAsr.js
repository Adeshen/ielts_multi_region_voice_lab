const ASR_SUBMIT_ENDPOINT =
  process.env.VOLCENGINE_ASR_SUBMIT_ENDPOINT || "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const ASR_QUERY_ENDPOINT =
  process.env.VOLCENGINE_ASR_QUERY_ENDPOINT || "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";
const ASR_RESOURCE_ID = process.env.VOLCENGINE_ASR_RESOURCE_ID || "volc.seedasr.auc";
const ASR_MODEL_NAME = process.env.VOLCENGINE_ASR_MODEL_NAME || "bigmodel";
const ASR_MAX_POLLS = Number(process.env.VOLCENGINE_ASR_MAX_POLLS || 30);
const ASR_POLL_INTERVAL_MS = Number(process.env.VOLCENGINE_ASR_POLL_INTERVAL_MS || 2000);
const PROCESSING_CODES = new Set(["20000001", "20000002"]);
const STATUS_MESSAGES = new Map([
  ["20000003", "Silent audio: no speech was detected."],
  ["45000001", "Invalid ASR request parameters."],
  ["45000002", "Empty audio file."],
  ["45000131", "Audio duration quota or submission limit exceeded."],
  ["45000132", "Audio file is too large."],
  ["45000151", "Audio format is not supported or is invalid."],
  ["55000031", "Volcengine ASR service is busy."]
]);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function validateVolcengineAsrCredentials() {
  requiredEnv("VOLCENGINE_APP_ID");
  requiredEnv("VOLCENGINE_ACCESS_TOKEN");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function headers(requestId) {
  const appId = requiredEnv("VOLCENGINE_APP_ID");
  const token = requiredEnv("VOLCENGINE_ACCESS_TOKEN");
  return {
    "Content-Type": "application/json",
    "X-Api-App-Key": appId,
    "X-Api-Access-Key": token,
    "X-Api-Resource-Id": ASR_RESOURCE_ID,
    "X-Api-Request-Id": requestId,
    "X-Api-Sequence": "-1"
  };
}

function extractTaskId(payload, responseHeaders) {
  return (
    responseHeaders.get("x-api-task-id") ||
    payload?.task_id ||
    payload?.taskId ||
    payload?.id ||
    payload?.result?.task_id ||
    payload?.result?.taskId ||
    ""
  );
}

function extractStatus(payload, responseHeaders) {
  return String(
    responseHeaders.get("x-api-status-code") ||
      payload?.status ||
      payload?.status_code ||
      payload?.code ||
      payload?.result?.status ||
      ""
  ).toLowerCase();
}

function extractProviderMessage(responseHeaders, payload) {
  return (
    responseHeaders?.get?.("x-api-message") ||
    responseHeaders?.get?.("x-tt-logid") ||
    payload?.message ||
    payload?.error?.message ||
    payload?.error ||
    payload?.result?.message ||
    payload?.raw ||
    ""
  );
}

function extractText(payload) {
  const candidates = [
    payload?.text,
    payload?.result?.text,
    payload?.result?.utterances?.map((item) => item.text).join("\n"),
    payload?.result?.results?.map((item) => item.text).join("\n"),
    payload?.utterances?.map((item) => item.text).join("\n")
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function errorMessage(payload, fallback, responseHeaders) {
  const providerMessage = extractProviderMessage(responseHeaders, payload);

  if (!providerMessage) {
    return fallback;
  }

  const text = typeof providerMessage === "string" ? providerMessage : JSON.stringify(providerMessage);
  return `${fallback} Provider response: ${text.slice(0, 800)}`;
}

function statusErrorMessage(status) {
  return STATUS_MESSAGES.get(status) || `Volcengine ASR task failed with status ${status}.`;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function supportedFormat(filename) {
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  if (!["raw", "wav", "mp3", "ogg"].includes(extension)) {
    throw new Error("Volcengine ASR supports raw, wav, mp3, and ogg audio. Please record or upload a supported format.");
  }
  return extension;
}

async function submitAudio({ audioUrl, filename, prompt }) {
  const requestId = crypto.randomUUID();
  const extension = supportedFormat(filename);
  const response = await fetch(ASR_SUBMIT_ENDPOINT, {
    method: "POST",
    headers: headers(requestId),
    body: JSON.stringify({
      user: {
        uid: "ielts-local-web"
      },
      audio: {
        format: extension,
        language: "en-US",
        url: audioUrl
      },
      request: {
        model_name: ASR_MODEL_NAME,
        enable_itn: true,
        enable_punc: true,
        show_utterances: true
      }
    })
  });

  const payload = await parseJsonResponse(response);
  const status = extractStatus(payload, response.headers);
  if (!response.ok || status !== "20000000") {
    throw new Error(errorMessage(payload, `Volcengine ASR submit failed with status ${status || response.status}.`, response.headers));
  }

  const directText = extractText(payload);
  if (directText) {
    return { payload, requestId, text: directText };
  }

  return { payload, requestId, taskId: extractTaskId(payload, response.headers) || requestId };
}

async function queryAudio({ requestId }) {
  const response = await fetch(ASR_QUERY_ENDPOINT, {
    method: "POST",
    headers: headers(requestId),
    body: JSON.stringify({})
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(errorMessage(payload, `Volcengine ASR query failed with status ${response.status}.`, response.headers));
  }
  return { payload, status: extractStatus(payload, response.headers), text: extractText(payload) };
}

export async function transcribeAudioFile({ audioUrl, filename, prompt }) {
  validateVolcengineAsrCredentials();
  if (!audioUrl) {
    throw new Error(
      "Missing VOLCENGINE_ASR_AUDIO_BASE_URL. The Volcengine recording-file ASR API requires a public audio URL, so expose this local app with a public URL and set that env variable."
    );
  }

  const submitted = await submitAudio({ audioUrl, filename, prompt });
  if (submitted.text) {
    return {
      text: submitted.text,
      provider: "volcengine-asr",
      model: ASR_MODEL_NAME,
      raw: submitted.payload
    };
  }

  for (let attempt = 0; attempt < ASR_MAX_POLLS; attempt += 1) {
    await sleep(ASR_POLL_INTERVAL_MS);
    const result = await queryAudio({ requestId: submitted.taskId || submitted.requestId });
    if (result.text) {
      return {
        text: result.text,
        provider: "volcengine-asr",
        model: ASR_MODEL_NAME,
        raw: result.payload
      };
    }
    if (PROCESSING_CODES.has(result.status)) {
      continue;
    }
    if (result.status && result.status !== "20000000") {
      throw new Error(errorMessage(result.payload, statusErrorMessage(result.status)));
    }
  }

  throw new Error("Volcengine ASR task timed out. Try a shorter recording or check the ASR endpoint configuration.");
}
