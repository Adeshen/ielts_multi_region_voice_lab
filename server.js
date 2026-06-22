import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import express from "express";
import {
  addHistoryRecord,
  addSpeakingRecord,
  addDictationRecord,
  addVoiceNoteRecord,
  audioDir,
  ensureStorage,
  readDictationRecords,
  readHistory,
  readSpeakingRecords,
  readVoiceNoteRecords,
  recordingDir,
  removeAudioFiles,
  removeDictationRecordFiles,
  removeSpeakingRecordFiles,
  removeVoiceNoteRecordFiles,
  speakingRecordingDir,
  writeDictationRecords,
  writeHistory,
  writeSpeakingRecords,
  writeVoiceNoteRecords
} from "./src/storage.js";
import { transcribeAudioFile } from "./src/volcengineAsr.js";
import { analyzeSpeakingAnswer, improveVoiceNoteExpression, reviewDictationAttempt } from "./src/deepseek.js";
import { compareDictation } from "./src/dictation.js";
import { convertWavToMp3 } from "./src/audioTranscode.js";
import { listVoices, resolveVoiceIds } from "./src/voices.js";
import { synthesizeSpeech, validateCredentials } from "./src/volcengine.js";
import {
  audioObjectExists,
  deleteAudioObject,
  publicAudioUrl,
  readAudioObject,
  saveAudioObject,
  storageMode
} from "./src/audioStore.js";

const app = express();
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(process.cwd(), "public");
const maxTextLength = 2000;
const maxSpeakingPromptLength = 4000;
const maxDictationTextLength = 1000;
const maxRecordingBytes = 25 * 1024 * 1024;
const asrAudioBaseUrl = process.env.VOLCENGINE_ASR_AUDIO_BASE_URL?.replace(/\/+$/, "") || "";
const sitePassword = process.env.SITE_PASSWORD || "";
const siteSessionSecret = process.env.SITE_SESSION_SECRET || sitePassword || "ielts-voice-lab-dev-secret";
const authCookieName = "ielts_voice_lab_auth";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;
const recordingTypes = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/mpeg", "mp3"]
]);

app.use(express.urlencoded({ extended: false }));

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signValue(value) {
  return createHmac("sha256", siteSessionSecret).update(value).digest("hex");
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf("=");
        return separator === -1
          ? [decodeURIComponent(item), ""]
          : [decodeURIComponent(item.slice(0, separator)), decodeURIComponent(item.slice(separator + 1))];
      })
  );
}

function createSessionToken() {
  const expiresAt = Date.now() + sessionMaxAgeSeconds * 1000;
  return `${expiresAt}.${signValue(`session:${expiresAt}`)}`;
}

function isValidSessionToken(token) {
  const [expiresAt, signature] = String(token || "").split(".");
  const expiresAtNumber = Number(expiresAt);
  if (!Number.isFinite(expiresAtNumber) || expiresAtNumber < Date.now() || !signature) {
    return false;
  }
  return safeCompare(signature, signValue(`session:${expiresAt}`));
}

function isSecureRequest(request) {
  return request.secure || request.headers["x-forwarded-proto"] === "https";
}

function sessionCookie(token, request) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  return `${authCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}${secure}`;
}

function clearSessionCookie(request) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  return `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function isAuthenticated(request) {
  if (!sitePassword) {
    return true;
  }
  return isValidSessionToken(parseCookies(request)[authCookieName]);
}

function safeRedirectPath(value) {
  const nextPath = String(value || "/");
  if (!nextPath.startsWith("/") || nextPath.startsWith("//") || nextPath.includes("\\")) {
    return "/";
  }
  return nextPath;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function signedAudioToken(filename) {
  return signValue(`asr-audio:${filename}`);
}

function hasValidAsrAudioToken(request) {
  const prefix = "/speaking-recordings/";
  if (!request.path.startsWith(prefix)) {
    return false;
  }
  const filename = decodeURIComponent(request.path.slice(prefix.length));
  if (!filename || filename.includes("/") || filename.includes("..")) {
    return false;
  }
  return safeCompare(request.query.asrToken || "", signedAudioToken(filename));
}

function loginPage({ error = false, next = "/" } = {}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign In | IELTS Voice Lab</title>
    <style>
      :root { color-scheme: light; --bg: #f3f4f6; --surface: #ffffff; --ink: #172033; --muted: #667085; --line: #d8dee8; --accent: #0f766e; --danger: #b42318; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: linear-gradient(135deg, rgba(15, 118, 110, 0.12), rgba(190, 72, 38, 0.1)), var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(420px, calc(100% - 32px)); padding: 24px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255, 255, 255, 0.94); box-shadow: 0 18px 45px rgba(23, 32, 51, 0.1); }
      p { margin: 0 0 18px; color: var(--muted); line-height: 1.5; }
      .eyebrow { margin-bottom: 6px; color: var(--accent); font-size: 0.75rem; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
      h1 { margin: 0 0 10px; font-size: 1.8rem; line-height: 1; letter-spacing: 0; }
      label { display: grid; gap: 8px; font-weight: 800; }
      input { width: 100%; min-height: 44px; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font: inherit; }
      input:focus, button:focus-visible { outline: 3px solid rgba(15, 118, 110, 0.25); outline-offset: 2px; }
      button { width: 100%; min-height: 44px; margin-top: 14px; border: 0; border-radius: 8px; background: var(--accent); color: white; font: inherit; font-weight: 800; cursor: pointer; }
      .error { margin-top: 12px; color: var(--danger); font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Protected site</p>
      <h1>IELTS Voice Lab</h1>
      <p>Enter the site password before using TTS, ASR, recordings, or local audio files.</p>
      <form method="post" action="/login">
        <input type="hidden" name="next" value="${escapeHtml(next)}" />
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" autofocus required />
        </label>
        <button type="submit">Unlock</button>
      </form>
      ${error ? '<p class="error">Wrong password. Please try again.</p>' : ""}
    </main>
  </body>
</html>`;
}

app.get(["/login", "/login.html"], (request, response) => {
  if (isAuthenticated(request)) {
    return response.redirect(safeRedirectPath(request.query.next));
  }
  response.setHeader("Cache-Control", "no-store");
  response.type("html").send(loginPage({ error: request.query.error === "1", next: safeRedirectPath(request.query.next) }));
});

app.post("/login", (request, response) => {
  const nextPath = safeRedirectPath(request.body?.next);
  if (!sitePassword || request.body?.password === sitePassword) {
    response.setHeader("Set-Cookie", sessionCookie(createSessionToken(), request));
    return response.redirect(nextPath);
  }
  response.redirect(`/login?error=1&next=${encodeURIComponent(nextPath)}`);
});

app.post("/logout", (request, response) => {
  response.setHeader("Set-Cookie", clearSessionCookie(request));
  response.redirect("/login");
});

app.use((request, response, next) => {
  if (isAuthenticated(request) || hasValidAsrAudioToken(request)) {
    return next();
  }
  if (request.path.startsWith("/api/")) {
    return response.status(401).json({ error: "Please sign in before using this site." });
  }
  response.redirect(`/login?next=${encodeURIComponent(request.originalUrl)}`);
});

app.use(express.json({ limit: "32mb" }));
app.use(express.static(publicDir));
app.get("/audio/:filename", serveAudioObject("audio", audioDir, "audio/mpeg"));
app.get("/recordings/:filename", serveAudioObject("recordings", recordingDir));
app.get("/speaking-recordings/:filename", serveAudioObject("speaking-recordings", speakingRecordingDir));

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

function contentTypeForMimeType(mimeType) {
  return mimeType || "application/octet-stream";
}

function serveAudioObject(category, localDir, fallbackContentType) {
  return async (request, response, next) => {
    try {
      const filename = request.params.filename;
      if (typeof filename !== "string" || filename.includes("/") || filename.includes("..")) {
        return response.status(400).json({ error: "Audio filename is invalid." });
      }

      const object = await readAudioObject({
        category,
        localDir,
        filename,
        range: request.headers.range,
        fallbackContentType
      });

      response.status(object.statusCode);
      Object.entries(object.headers).forEach(([key, value]) => {
        if (value) {
          response.setHeader(key, value);
        }
      });

      await pipeline(object.content, response);
    } catch (error) {
      if (error.code === "ENOENT") {
        return response.status(404).json({ error: "Audio file not found." });
      }
      next(error);
    }
  };
}

function parseRecordingUpload(dataUrl) {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/i.exec(String(dataUrl ?? ""));
  if (!match) {
    return { error: "Recording upload is invalid." };
  }

  const mimeType = match[1].toLowerCase();
  const extension = recordingTypes.get(mimeType);
  if (!extension) {
    return { error: "Recording format is not supported by this browser." };
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    return { error: "Recording is empty." };
  }
  if (buffer.byteLength > maxRecordingBytes) {
    return { error: "Recording is too large. Keep it under 25 MB." };
  }

  return { buffer, extension, mimeType };
}

async function optimizeRecordingUpload(parsed) {
  if (parsed.mimeType !== "audio/wav") {
    return parsed;
  }

  let buffer;
  try {
    buffer = await convertWavToMp3(parsed.buffer);
  } catch (error) {
    if (error.code === "FFMPEG_NOT_FOUND") {
      error.statusCode = 500;
      error.message = "ffmpeg is not installed on this server. Install ffmpeg or set FFMPEG_PATH before saving WAV recordings as MP3.";
      throw error;
    }
    const transcodeError = new Error(`Could not convert the WAV recording to MP3. ${error.message}`);
    transcodeError.statusCode = 400;
    throw transcodeError;
  }

  return {
    buffer,
    extension: "mp3",
    mimeType: "audio/mpeg",
    originalExtension: parsed.extension,
    originalMimeType: parsed.mimeType,
    optimizedFrom: "wav"
  };
}

function speakingTitleFromPrompt(prompt) {
  const firstLine = prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || "Speaking prompt";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function publicSpeakingRecordingUrl(filename) {
  if (!asrAudioBaseUrl) {
    return "";
  }
  const token = signedAudioToken(filename);
  return `${asrAudioBaseUrl}/speaking-recordings/${encodeURIComponent(filename)}?asrToken=${token}`;
}

app.get("/api/voices", (_request, response) => {
  response.json(listVoices());
});

app.get("/api/storage", (_request, response) => {
  response.json({ mode: storageMode() });
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
        await saveAudioObject({
          category: "audio",
          localDir: audioDir,
          filename,
          buffer: audioBuffer,
          contentType: "audio/mpeg"
        });
        items.push(publicItemFromVoice({ voice, filename, audioUrl: publicAudioUrl("audio", filename) }));
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

app.post("/api/history/:id/recordings", async (request, response, next) => {
  try {
    const history = await readHistory();
    const record = history.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "History record not found." });
    }

    const uploaded = parseRecordingUpload(request.body?.dataUrl);
    if (uploaded.error) {
      return response.status(400).json({ error: uploaded.error });
    }
    const parsed = await optimizeRecordingUpload(uploaded);

    const recordingId = crypto.randomUUID();
    const filename = `${record.id}-${recordingId}.${parsed.extension}`;
    await saveAudioObject({
      category: "recordings",
      localDir: recordingDir,
      filename,
      buffer: parsed.buffer,
      contentType: contentTypeForMimeType(parsed.mimeType)
    });

    const recording = {
      id: recordingId,
      filename,
      audioUrl: publicAudioUrl("recordings", filename),
      mimeType: parsed.mimeType,
      originalMimeType: parsed.originalMimeType,
      optimizedFrom: parsed.optimizedFrom,
      createdAt: new Date().toISOString()
    };

    record.recordings = [recording, ...(record.recordings ?? [])];
    await writeHistory(history);
    response.status(201).json(recording);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/history/:id/recordings/:recordingId", async (request, response, next) => {
  try {
    const history = await readHistory();
    const record = history.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "History record not found." });
    }

    const recording = (record.recordings ?? []).find((item) => item.id === request.params.recordingId);
    if (!recording) {
      return response.status(404).json({ error: "Recording not found." });
    }

    if (typeof recording.filename === "string" && !recording.filename.includes("..")) {
      await deleteAudioObject({
        category: "recordings",
        localDir: recordingDir,
        filename: recording.filename
      });
    }

    record.recordings = (record.recordings ?? []).filter((item) => item.id !== recording.id);
    await writeHistory(history);
    response.status(204).end();
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

app.get("/api/dictation", async (_request, response, next) => {
  try {
    response.json(await readDictationRecords());
  } catch (error) {
    next(error);
  }
});

app.post("/api/dictation", async (request, response, next) => {
  try {
    validateCredentials();

    const sourceText = String(request.body?.sourceText ?? "").trim();
    if (!sourceText) {
      return response.status(400).json({ error: "Please enter a sentence before starting dictation." });
    }
    if (sourceText.length > maxDictationTextLength) {
      return response.status(400).json({
        error: `Dictation text is too long. Keep it under ${maxDictationTextLength} characters.`
      });
    }

    let voice;
    try {
      voice = resolveVoiceIds([request.body?.voiceId || "uk_female"])[0];
    } catch (error) {
      return response.status(400).json({ error: error.message });
    }

    const speedRatio = clampNumber(request.body?.speedRatio, 0.9, 0.5, 1.5);
    const volumeRatio = clampNumber(request.body?.volumeRatio, 1, 0.2, 2);
    const recordId = crypto.randomUUID();
    const audioBuffer = await synthesizeSpeech({ text: sourceText, voice, speedRatio, volumeRatio });
    const filename = `${recordId}-dictation-${voice.id}.mp3`;
    await saveAudioObject({
      category: "audio",
      localDir: audioDir,
      filename,
      buffer: audioBuffer,
      contentType: "audio/mpeg"
    });

    const record = {
      id: recordId,
      sourceText,
      createdAt: new Date().toISOString(),
      speedRatio,
      volumeRatio,
      filename,
      audioUrl: publicAudioUrl("audio", filename),
      voice: publicItemFromVoice({ voice, filename, audioUrl: publicAudioUrl("audio", filename) }),
      attempts: []
    };

    await addDictationRecord(record);
    response.status(201).json(record);
  } catch (error) {
    next(error);
  }
});

app.post("/api/dictation/from-history", async (request, response, next) => {
  try {
    const history = await readHistory();
    const sourceRecord = history.find((item) => item.id === request.body?.historyId);
    if (!sourceRecord) {
      return response.status(404).json({ error: "TTS history record not found." });
    }

    const sourceItem = (sourceRecord.items ?? []).find((item) => item.voiceId === request.body?.voiceId);
    if (!sourceItem) {
      return response.status(404).json({ error: "Selected history audio was not found." });
    }
    if (typeof sourceItem.filename !== "string" || sourceItem.filename.includes("..")) {
      return response.status(400).json({ error: "Selected history audio cannot be reused." });
    }

    const records = await readDictationRecords();
    const existing = records.find((record) => record.sourceHistoryId === sourceRecord.id && record.sourceVoiceId === sourceItem.voiceId);
    if (existing) {
      return response.json(existing);
    }

    const record = {
      id: crypto.randomUUID(),
      sourceText: sourceRecord.text,
      createdAt: new Date().toISOString(),
      speedRatio: sourceRecord.speedRatio ?? 1,
      volumeRatio: sourceRecord.volumeRatio ?? 1,
      filename: sourceItem.filename,
      audioUrl: sourceItem.audioUrl,
      voice: {
        voiceId: sourceItem.voiceId,
        label: sourceItem.label,
        shortLabel: sourceItem.shortLabel,
        region: sourceItem.region,
        gender: sourceItem.gender
      },
      source: "tts-history",
      sourceHistoryId: sourceRecord.id,
      sourceVoiceId: sourceItem.voiceId,
      ownsAudioFile: false,
      attempts: []
    };

    await addDictationRecord(record);
    response.status(201).json(record);
  } catch (error) {
    next(error);
  }
});

app.post("/api/dictation/:id/check", async (request, response, next) => {
  try {
    const records = await readDictationRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Dictation record not found." });
    }

    const userText = String(request.body?.userText ?? "").trim();
    if (!userText) {
      return response.status(400).json({ error: "Type what you heard before checking the answer." });
    }
    if (userText.length > maxDictationTextLength) {
      return response.status(400).json({ error: `Your answer is too long. Keep it under ${maxDictationTextLength} characters.` });
    }

    const result = compareDictation(record.sourceText, userText);
    const attempt = {
      id: crypto.randomUUID(),
      userText,
      createdAt: new Date().toISOString(),
      ...result
    };

    record.attempts = [attempt, ...(record.attempts ?? [])].slice(0, 20);
    await writeDictationRecords(records);
    response.json({ record, attempt });
  } catch (error) {
    next(error);
  }
});

app.post("/api/dictation/:id/attempts/:attemptId/review", async (request, response, next) => {
  try {
    const records = await readDictationRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Dictation record not found." });
    }

    const attempt = (record.attempts ?? []).find((item) => item.id === request.params.attemptId);
    if (!attempt) {
      return response.status(404).json({ error: "Dictation attempt not found." });
    }

    const aiReview = await reviewDictationAttempt({
      sourceText: record.sourceText,
      userText: attempt.userText,
      deterministicResult: {
        score: attempt.score,
        operations: attempt.operations,
        mistakes: attempt.mistakes,
        missingFunctionWords: attempt.missingFunctionWords,
        coreVocabulary: attempt.coreVocabulary
      }
    });

    attempt.aiReview = {
      ...aiReview,
      provider: "deepseek",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      createdAt: new Date().toISOString()
    };
    await writeDictationRecords(records);
    response.json({ record, attempt, aiReview: attempt.aiReview });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/dictation/:id", async (request, response, next) => {
  try {
    const records = await readDictationRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Dictation record not found." });
    }

    await removeDictationRecordFiles(record);
    await writeDictationRecords(records.filter((item) => item.id !== record.id));
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.delete("/api/dictation", async (_request, response, next) => {
  try {
    const records = await readDictationRecords();
    await Promise.all(records.map((record) => removeDictationRecordFiles(record)));
    await writeDictationRecords([]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/voice-notes", async (_request, response, next) => {
  try {
    response.json(await readVoiceNoteRecords());
  } catch (error) {
    next(error);
  }
});

app.post("/api/voice-notes", async (request, response, next) => {
  try {
    const uploaded = parseRecordingUpload(request.body?.dataUrl);
    if (uploaded.error) {
      return response.status(400).json({ error: uploaded.error });
    }
    const parsed = await optimizeRecordingUpload(uploaded);

    const recordId = crypto.randomUUID();
    const filename = `voice-note-${recordId}.${parsed.extension}`;
    await saveAudioObject({
      category: "speaking-recordings",
      localDir: speakingRecordingDir,
      filename,
      buffer: parsed.buffer,
      contentType: contentTypeForMimeType(parsed.mimeType)
    });

    const record = {
      id: recordId,
      title: String(request.body?.title ?? "").trim().slice(0, 80) || "Voice note",
      filename,
      audioUrl: publicAudioUrl("speaking-recordings", filename),
      mimeType: parsed.mimeType,
      originalMimeType: parsed.originalMimeType,
      optimizedFrom: parsed.optimizedFrom,
      createdAt: new Date().toISOString()
    };

    await addVoiceNoteRecord(record);
    response.status(201).json(record);
  } catch (error) {
    next(error);
  }
});

app.post("/api/voice-notes/:id/transcribe", async (request, response, next) => {
  try {
    const records = await readVoiceNoteRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Voice note not found." });
    }
    if (typeof record.filename !== "string" || record.filename.includes("..")) {
      return response.status(400).json({ error: "Voice note filename is invalid." });
    }
    if (!asrAudioBaseUrl) {
      return response.status(400).json({
        error:
          "VOLCENGINE_ASR_AUDIO_BASE_URL is not configured. Volcengine recording-file ASR needs a public URL for the audio file."
      });
    }

    if (!(await audioObjectExists({ category: "speaking-recordings", localDir: speakingRecordingDir, filename: record.filename }))) {
      return response.status(404).json({ error: "Voice note audio file not found." });
    }
    const transcription = await transcribeAudioFile({
      audioUrl: publicSpeakingRecordingUrl(record.filename),
      filename: record.filename,
      prompt: record.title
    });

    record.transcript = transcription.text;
    record.transcription = {
      provider: transcription.provider,
      model: transcription.model,
      segments: transcription.segments ?? [],
      timing: transcription.timing ?? null,
      createdAt: new Date().toISOString()
    };
    await writeVoiceNoteRecords(records);
    response.json({ record, transcript: transcription.text });
  } catch (error) {
    next(error);
  }
});

app.post("/api/voice-notes/:id/analyze", async (request, response, next) => {
  try {
    const records = await readVoiceNoteRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Voice note not found." });
    }

    const transcript = String(request.body?.transcript ?? record.transcript ?? "").trim();
    if (!transcript) {
      return response.status(400).json({ error: "Transcribe the voice note before improving the expression." });
    }
    if (transcript.length > maxSpeakingPromptLength) {
      return response.status(400).json({ error: `Transcript is too long. Keep it under ${maxSpeakingPromptLength} characters.` });
    }

    const expressionAnalysis = await improveVoiceNoteExpression({
      title: record.title,
      transcript,
      asrTiming: record.transcription
        ? {
            segments: record.transcription.segments ?? [],
            timing: record.transcription.timing ?? null
          }
        : null
    });

    record.transcript = transcript;
    record.expressionAnalysis = {
      ...expressionAnalysis,
      provider: "deepseek",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      createdAt: new Date().toISOString()
    };
    await writeVoiceNoteRecords(records);
    response.json({ record, expressionAnalysis: record.expressionAnalysis });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/voice-notes/:id", async (request, response, next) => {
  try {
    const records = await readVoiceNoteRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Voice note not found." });
    }

    await removeVoiceNoteRecordFiles(record);
    await writeVoiceNoteRecords(records.filter((item) => item.id !== record.id));
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.delete("/api/voice-notes", async (_request, response, next) => {
  try {
    const records = await readVoiceNoteRecords();
    await Promise.all(records.map((record) => removeVoiceNoteRecordFiles(record)));
    await writeVoiceNoteRecords([]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/speaking", async (_request, response, next) => {
  try {
    response.json(await readSpeakingRecords());
  } catch (error) {
    next(error);
  }
});

app.post("/api/speaking", async (request, response, next) => {
  try {
    const prompt = String(request.body?.prompt ?? "").trim();
    if (!prompt) {
      return response.status(400).json({ error: "Please enter a speaking prompt before saving." });
    }
    if (prompt.length > maxSpeakingPromptLength) {
      return response.status(400).json({ error: `Prompt is too long. Keep it under ${maxSpeakingPromptLength} characters.` });
    }

    const record = {
      id: crypto.randomUUID(),
      title: speakingTitleFromPrompt(prompt),
      prompt,
      createdAt: new Date().toISOString(),
      recordings: []
    };

    await addSpeakingRecord(record);
    response.status(201).json(record);
  } catch (error) {
    next(error);
  }
});

app.post("/api/speaking/:id/recordings", async (request, response, next) => {
  try {
    const records = await readSpeakingRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Speaking prompt not found." });
    }

    const uploaded = parseRecordingUpload(request.body?.dataUrl);
    if (uploaded.error) {
      return response.status(400).json({ error: uploaded.error });
    }
    const parsed = await optimizeRecordingUpload(uploaded);

    const recordingId = crypto.randomUUID();
    const filename = `${record.id}-${recordingId}.${parsed.extension}`;
    await saveAudioObject({
      category: "speaking-recordings",
      localDir: speakingRecordingDir,
      filename,
      buffer: parsed.buffer,
      contentType: contentTypeForMimeType(parsed.mimeType)
    });

    const recording = {
      id: recordingId,
      filename,
      audioUrl: publicAudioUrl("speaking-recordings", filename),
      mimeType: parsed.mimeType,
      originalMimeType: parsed.originalMimeType,
      optimizedFrom: parsed.optimizedFrom,
      createdAt: new Date().toISOString()
    };

    record.recordings = [recording, ...(record.recordings ?? [])];
    await writeSpeakingRecords(records);
    response.status(201).json(recording);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/speaking/:id/recordings/:recordingId", async (request, response, next) => {
  try {
    const records = await readSpeakingRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Speaking prompt not found." });
    }

    const recording = (record.recordings ?? []).find((item) => item.id === request.params.recordingId);
    if (!recording) {
      return response.status(404).json({ error: "Recording not found." });
    }

    if (typeof recording.filename === "string" && !recording.filename.includes("..")) {
      await deleteAudioObject({
        category: "speaking-recordings",
        localDir: speakingRecordingDir,
        filename: recording.filename
      });
    }

    record.recordings = (record.recordings ?? []).filter((item) => item.id !== recording.id);
    await writeSpeakingRecords(records);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/speaking/:id/recordings/:recordingId/transcribe", async (request, response, next) => {
  try {
    const records = await readSpeakingRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Speaking prompt not found." });
    }

    const recording = (record.recordings ?? []).find((item) => item.id === request.params.recordingId);
    if (!recording) {
      return response.status(404).json({ error: "Recording not found." });
    }
    if (typeof recording.filename !== "string" || recording.filename.includes("..")) {
      return response.status(400).json({ error: "Recording filename is invalid." });
    }
    if (!asrAudioBaseUrl) {
      return response.status(400).json({
        error:
          "VOLCENGINE_ASR_AUDIO_BASE_URL is not configured. Volcengine recording-file ASR needs a public URL for the audio file, so expose this app with a public HTTPS tunnel first."
      });
    }
    if (!/\.(wav|mp3|ogg|raw)$/i.test(recording.filename)) {
      return response.status(400).json({
        error: "This recording format is not supported by Volcengine ASR. Please create a new recording; new speaking recordings are saved as MP3."
      });
    }

    if (!(await audioObjectExists({ category: "speaking-recordings", localDir: speakingRecordingDir, filename: recording.filename }))) {
      return response.status(404).json({ error: "Recording audio file not found." });
    }
    const transcription = await transcribeAudioFile({
      audioUrl: publicSpeakingRecordingUrl(recording.filename),
      filename: recording.filename,
      prompt: record.prompt
    });

    recording.transcript = transcription.text;
    recording.transcription = {
      provider: transcription.provider,
      model: transcription.model,
      segments: transcription.segments ?? [],
      timing: transcription.timing ?? null,
      createdAt: new Date().toISOString()
    };
    await writeSpeakingRecords(records);
    response.json({ recording, transcript: transcription.text });
  } catch (error) {
    next(error);
  }
});

app.post("/api/speaking/:id/recordings/:recordingId/analyze", async (request, response, next) => {
  try {
    const records = await readSpeakingRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Speaking prompt not found." });
    }

    const recording = (record.recordings ?? []).find((item) => item.id === request.params.recordingId);
    if (!recording) {
      return response.status(404).json({ error: "Recording not found." });
    }

    const transcript = String(request.body?.transcript ?? "").trim();
    if (!transcript) {
      return response.status(400).json({ error: "Please enter the transcript of your spoken answer before analyzing." });
    }
    if (transcript.length > maxSpeakingPromptLength) {
      return response.status(400).json({ error: `Transcript is too long. Keep it under ${maxSpeakingPromptLength} characters.` });
    }

    const analysis = await analyzeSpeakingAnswer({
      prompt: record.prompt,
      transcript,
      asrTiming: recording.transcription
        ? {
            segments: recording.transcription.segments ?? [],
            timing: recording.transcription.timing ?? null
          }
        : null
    });

    recording.transcript = transcript;
    recording.analysis = analysis;
    recording.analyzedAt = new Date().toISOString();
    await writeSpeakingRecords(records);
    response.json({ recording, analysis });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/speaking/:id", async (request, response, next) => {
  try {
    const records = await readSpeakingRecords();
    const record = records.find((item) => item.id === request.params.id);
    if (!record) {
      return response.status(404).json({ error: "Speaking prompt not found." });
    }

    await removeSpeakingRecordFiles(record);
    await writeSpeakingRecords(records.filter((item) => item.id !== record.id));
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.delete("/api/speaking", async (_request, response, next) => {
  try {
    const records = await readSpeakingRecords();
    await Promise.all(records.map((record) => removeSpeakingRecordFiles(record)));
    await writeSpeakingRecords([]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  response.status(status).json({ error: error.message || "Unexpected server error." });
});

await ensureStorage();

app.listen(port, host, () => {
  console.log(`IELTS regional TTS app listening on http://${host}:${port}`);
});
