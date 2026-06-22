import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { convertWavToMp3 } from "../src/audioTranscode.js";
import { publicAudioUrl, saveAudioObject, storageMode } from "../src/audioStore.js";

const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");
const speakingRecordingDir = path.join(dataDir, "speaking-recordings");
const speakingHistoryPath = path.join(dataDir, "speaking-history.json");
const voiceNotesHistoryPath = path.join(dataDir, "voice-notes-history.json");

const migrations = [
  {
    name: "speaking",
    filePath: speakingHistoryPath,
    getItems(record) {
      return Array.isArray(record.recordings) ? record.recordings : [];
    }
  },
  {
    name: "voice-notes",
    filePath: voiceNotesHistoryPath,
    getItems(record) {
      return record ? [record] : [];
    }
  }
];

let convertedCount = 0;
let uploadedCount = 0;
let updatedCount = 0;
let skippedMissingCount = 0;

for (const migration of migrations) {
  const records = await readJsonArray(migration.filePath);
  let changed = false;

  for (const record of records) {
    for (const item of migration.getItems(record)) {
      if (!item?.filename || !item.filename.toLowerCase().endsWith(".wav")) {
        continue;
      }

      const result = await migrateRecordingItem(item);
      if (result.changed) {
        changed = true;
        updatedCount += 1;
      }
    }
  }

  if (changed) {
    await backupJson(migration.filePath);
    await fs.writeFile(migration.filePath, `${JSON.stringify(records, null, 2)}\n`);
  }
}

console.log(
  JSON.stringify(
    {
      storage: storageMode(),
      convertedCount,
      uploadedCount,
      updatedCount,
      skippedMissingCount
    },
    null,
    2
  )
);

async function readJsonArray(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function backupJson(filePath) {
  const content = await fs.readFile(filePath);
  const backupPath = `${filePath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.writeFile(backupPath, content);
}

async function migrateRecordingItem(item) {
  const wavFilename = item.filename;
  const mp3Filename = wavFilename.replace(/\.wav$/i, ".mp3");
  const wavPath = path.join(speakingRecordingDir, wavFilename);
  const mp3Path = path.join(speakingRecordingDir, mp3Filename);

  let mp3Buffer;
  try {
    mp3Buffer = await fs.readFile(mp3Path);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    let wavBuffer;
    try {
      wavBuffer = await fs.readFile(wavPath);
    } catch (readError) {
      if (readError.code === "ENOENT") {
        console.warn(`Skipping missing WAV file: ${wavFilename}`);
        skippedMissingCount += 1;
        return { changed: false };
      }
      throw readError;
    }

    mp3Buffer = await convertWavToMp3(wavBuffer);
    await fs.writeFile(mp3Path, mp3Buffer);
    convertedCount += 1;
  }

  await saveAudioObject({
    category: "speaking-recordings",
    localDir: speakingRecordingDir,
    filename: mp3Filename,
    buffer: mp3Buffer,
    contentType: "audio/mpeg"
  });
  uploadedCount += 1;

  item.originalFilename = item.originalFilename || wavFilename;
  item.originalMimeType = item.originalMimeType || item.mimeType || "audio/wav";
  item.filename = mp3Filename;
  item.audioUrl = publicAudioUrl("speaking-recordings", mp3Filename);
  item.mimeType = "audio/mpeg";
  item.optimizedFrom = "wav";

  return { changed: true };
}
