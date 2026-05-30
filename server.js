import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import express from "express";
import {
  addHistoryRecord,
  audioDir,
  ensureStorage,
  readHistory,
  removeAudioFiles,
  writeHistory
} from "./src/storage.js";
import { listVoices, resolveVoiceIds } from "./src/voices.js";
import { synthesizeSpeech, validateCredentials } from "./src/volcengine.js";

const app = express();
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(process.cwd(), "public");
const maxTextLength = 2000;

app.use(express.json({ limit: "64kb" }));
app.use(express.static(publicDir));
app.use("/audio", express.static(audioDir, { fallthrough: false }));

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function publicItemFromVoice({ voice, filename, audioUrl }) {
  return {
    voiceId: voice.id,
    label: voice.label,
    shortLabel: voice.shortLabel,
    region: voice.region,
    gender: voice.gender,
    filename,
    audioUrl
  };
}

app.get("/api/voices", (_request, response) => {
  response.json(listVoices());
});

app.get("/api/history", async (_request, response, next) => {
  try {
    response.json(await readHistory());
  } catch (error) {
    next(error);
  }
});

app.post("/api/tts", async (request, response, next) => {
  try {
    validateCredentials();

    const text = String(request.body?.text ?? "").trim();
    if (!text) {
      return response.status(400).json({ error: "Please enter a sentence before generating audio." });
    }
    if (text.length > maxTextLength) {
      return response.status(400).json({ error: `Text is too long. Keep it under ${maxTextLength} characters.` });
    }

    let voices;
    try {
      voices = resolveVoiceIds(request.body?.voices);
    } catch (error) {
      return response.status(400).json({ error: error.message });
    }

    const speedRatio = clampNumber(request.body?.speedRatio, 1, 0.5, 2);
    const volumeRatio = clampNumber(request.body?.volumeRatio, 1, 0.2, 2);
    const recordId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const items = [];
    const errors = [];

    for (const voice of voices) {
      try {
        const audioBuffer = await synthesizeSpeech({ text, voice, speedRatio, volumeRatio });
        const filename = `${recordId}-${voice.id}.mp3`;
        await fs.writeFile(path.join(audioDir, filename), audioBuffer);
        items.push(publicItemFromVoice({ voice, filename, audioUrl: `/audio/${filename}` }));
      } catch (error) {
        console.error(`TTS failed for ${voice.id} (${voice.speaker || voice.voiceType}):`, error.message);
        errors.push({
          voiceId: voice.id,
          label: voice.label,
          speaker: voice.speaker,
          resourceId: voice.resourceId,
          error: error.message
        });
      }
    }

    if (items.length === 0) {
      return response.status(502).json({
        error: "No audio was generated. Check the TTS credentials, voice presets, and network connection.",
        details: errors
      });
    }

    const record = {
      id: recordId,
      text,
      createdAt,
      speedRatio,
      volumeRatio,
      items,
      errors
    };

    await addHistoryRecord(record);
    response.status(errors.length > 0 ? 207 : 200).json(record);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/history/:id", async (request, response, next) => {
  try {
    const history = await readHistory();
    const record = history.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "History record not found." });
    }

    await removeAudioFiles(record);
    await writeHistory(history.filter((item) => item.id !== record.id));
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.delete("/api/history", async (_request, response, next) => {
  try {
    const history = await readHistory();
    await Promise.all(history.map((record) => removeAudioFiles(record)));
    await writeHistory([]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = error.message?.startsWith("Missing environment variable") ? 500 : 500;
  response.status(status).json({ error: error.message || "Unexpected server error." });
});

await ensureStorage();

app.listen(port, host, () => {
  console.log(`IELTS regional TTS app listening on http://${host}:${port}`);
});
