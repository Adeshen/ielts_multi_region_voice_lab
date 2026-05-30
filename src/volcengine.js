const TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
const TTS_V3_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function validateCredentials() {
  requiredEnv("VOLCENGINE_APP_ID");
  requiredEnv("VOLCENGINE_ACCESS_TOKEN");
}

export async function synthesizeSpeech({ text, voice, speedRatio, volumeRatio }) {
  if ((process.env.VOLCENGINE_API_VERSION || "v3").toLowerCase() === "v3") {
    return synthesizeSpeechV3({ text, voice, speedRatio, volumeRatio });
  }
  return synthesizeSpeechV1({ text, voice, speedRatio, volumeRatio });
}

function toPercentRatio(value) {
  return Math.round((value - 1) * 100);
}

function parseJsonEvents(raw) {
  const events = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        events.push(JSON.parse(raw.slice(start, index + 1)));
        start = -1;
      }
    }
  }

  return events;
}

async function synthesizeSpeechV3({ text, voice, speedRatio, volumeRatio }) {
  const appid = requiredEnv("VOLCENGINE_APP_ID");
  const token = requiredEnv("VOLCENGINE_ACCESS_TOKEN");
  const requestId = crypto.randomUUID();
  const resourceId = voice.resourceId;

  const response = await fetch(TTS_V3_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer;${token}`,
      "Content-Type": "application/json",
      "X-Api-App-Id": appid,
      "X-Api-Access-Key": token,
      "X-Api-Resource-Id": resourceId,
      "X-Api-Request-Id": requestId
    },
    body: JSON.stringify({
      user: {
        uid: "ielts-local-web"
      },
      req_params: {
        text,
        speaker: voice.speaker,
        audio_params: {
          format: "mp3",
          sample_rate: 24000,
          speech_rate: toPercentRatio(speedRatio),
          loudness_rate: toPercentRatio(volumeRatio)
        }
      }
    })
  });

  const raw = await response.text();
  let events;
  try {
    events = parseJsonEvents(raw);
  } catch {
    throw new Error(`TTS V3 returned an unreadable response with status ${response.status}`);
  }

  const errorEvent = events.find((event) => {
    const code = Number(event.code);
    return Number.isFinite(code) && code !== 0 && code !== 20000000;
  });
  if (!response.ok || errorEvent) {
    const message = errorEvent?.message || `TTS V3 request failed with status ${response.status}`;
    throw new Error(`${message} (resource=${resourceId}, speaker=${voice.speaker})`);
  }

  const chunks = events
    .map((event) => event.data)
    .filter((data) => typeof data === "string" && data.length > 0)
    .map((data) => Buffer.from(data, "base64"));

  if (!chunks.length) {
    throw new Error(`TTS V3 returned no audio data (resource=${resourceId}, speaker=${voice.speaker})`);
  }

  return Buffer.concat(chunks);
}

async function synthesizeSpeechV1({ text, voice, speedRatio, volumeRatio }) {
  const appid = requiredEnv("VOLCENGINE_APP_ID");
  const token = requiredEnv("VOLCENGINE_ACCESS_TOKEN");
  const cluster = process.env.VOLCENGINE_CLUSTER || "volcano_tts";

  const payload = {
    app: {
      appid,
      token,
      cluster
    },
    user: {
      uid: "ielts-local-web"
    },
    audio: {
      voice_type: voice.voiceType,
      encoding: "mp3",
      speed_ratio: speedRatio,
      volume_ratio: volumeRatio
    },
    request: {
      reqid: crypto.randomUUID(),
      text,
      text_type: "plain",
      operation: "query",
      with_frontend: 1,
      frontend_type: "unitTson"
    }
  };

  const response = await fetch(TTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer;${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`TTS returned non-JSON response with status ${response.status}`);
  }

  if (!response.ok || body.code !== 3000 || !body.data) {
    const message = body.message || body.error || `TTS request failed with status ${response.status}`;
    throw new Error(message);
  }

  return Buffer.from(body.data, "base64");
}
