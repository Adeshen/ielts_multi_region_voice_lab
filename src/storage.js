import { promises as fs } from "node:fs";
import path from "node:path";

export const dataDir = path.join(process.cwd(), "data");
export const audioDir = path.join(dataDir, "audio");
export const recordingDir = path.join(dataDir, "recordings");
export const speakingRecordingDir = path.join(dataDir, "speaking-recordings");
export const historyPath = path.join(dataDir, "history.json");
export const speakingHistoryPath = path.join(dataDir, "speaking-history.json");
export const dictationHistoryPath = path.join(dataDir, "dictation-history.json");

export async function ensureStorage() {
  await fs.mkdir(audioDir, { recursive: true });
  await fs.mkdir(recordingDir, { recursive: true });
  await fs.mkdir(speakingRecordingDir, { recursive: true });
  await ensureJsonArrayFile(historyPath);
  await ensureJsonArrayFile(speakingHistoryPath);
  await ensureJsonArrayFile(dictationHistoryPath);
}

async function ensureJsonArrayFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "[]\n", "utf8");
  }
}

async function readJsonArray(filePath) {
  await ensureStorage();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJsonArray(filePath, records) {
  await ensureStorage();
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function readHistory() {
  return readJsonArray(historyPath);
}

export async function writeHistory(records) {
  await writeJsonArray(historyPath, records);
}

export async function readSpeakingRecords() {
  return readJsonArray(speakingHistoryPath);
}

export async function writeSpeakingRecords(records) {
  await writeJsonArray(speakingHistoryPath, records);
}

export async function readDictationRecords() {
  return readJsonArray(dictationHistoryPath);
}

export async function writeDictationRecords(records) {
  await writeJsonArray(dictationHistoryPath, records);
}

export async function addHistoryRecord(record) {
  const history = await readHistory();
  history.unshift(record);
  await writeHistory(history.slice(0, 100));
}

export async function addSpeakingRecord(record) {
  const records = await readSpeakingRecords();
  records.unshift(record);
  await writeSpeakingRecords(records.slice(0, 100));
}

export async function addDictationRecord(record) {
  const records = await readDictationRecords();
  records.unshift(record);
  await writeDictationRecords(records.slice(0, 100));
}

export async function removeAudioFiles(record) {
  const audioFilenames = new Set(
    (record?.items ?? [])
      .map((item) => item.filename)
      .filter((filename) => typeof filename === "string" && !filename.includes(".."))
  );
  const recordingFilenames = new Set(
    (record?.recordings ?? [])
      .map((item) => item.filename)
      .filter((filename) => typeof filename === "string" && !filename.includes(".."))
  );

  const deletions = [
    ...[...audioFilenames].map((filename) => ({ dir: audioDir, filename })),
    ...[...recordingFilenames].map((filename) => ({ dir: recordingDir, filename }))
  ];

  await Promise.all(
    deletions.map(async ({ dir, filename }) => {
      try {
        await fs.unlink(path.join(dir, filename));
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    })
  );
}

export async function removeSpeakingRecordFiles(record) {
  const filenames = new Set(
    (record?.recordings ?? [])
      .map((item) => item.filename)
      .filter((filename) => typeof filename === "string" && !filename.includes(".."))
  );

  await Promise.all(
    [...filenames].map(async (filename) => {
      try {
        await fs.unlink(path.join(speakingRecordingDir, filename));
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    })
  );
}

export async function removeDictationRecordFiles(record) {
  const filenames = new Set(
    [record?.filename].filter((filename) => typeof filename === "string" && !filename.includes(".."))
  );

  await Promise.all(
    [...filenames].map(async (filename) => {
      try {
        await fs.unlink(path.join(audioDir, filename));
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    })
  );
}
