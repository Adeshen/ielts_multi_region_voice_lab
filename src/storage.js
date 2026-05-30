import { promises as fs } from "node:fs";
import path from "node:path";

export const dataDir = path.join(process.cwd(), "data");
export const audioDir = path.join(dataDir, "audio");
export const historyPath = path.join(dataDir, "history.json");

export async function ensureStorage() {
  await fs.mkdir(audioDir, { recursive: true });
  try {
    await fs.access(historyPath);
  } catch {
    await fs.writeFile(historyPath, "[]\n", "utf8");
  }
}

export async function readHistory() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(historyPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeHistory(records) {
  await ensureStorage();
  const tempPath = `${historyPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, historyPath);
}

export async function addHistoryRecord(record) {
  const history = await readHistory();
  history.unshift(record);
  await writeHistory(history.slice(0, 100));
}

export async function removeAudioFiles(record) {
  const filenames = new Set(
    (record?.items ?? [])
      .map((item) => item.filename)
      .filter((filename) => typeof filename === "string" && !filename.includes(".."))
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
