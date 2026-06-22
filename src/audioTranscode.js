import { spawn } from "node:child_process";

const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

export async function convertWavToMp3(buffer, { kbps = 96 } = {}) {
  return runFfmpeg(buffer, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "wav",
    "-i",
    "pipe:0",
    "-vn",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    `${kbps}k`,
    "-f",
    "mp3",
    "pipe:1"
  ]);
}

function runFfmpeg(inputBuffer, args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(ffmpegPath, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdout = [];
    const stderr = [];
    const settleReject = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        const missingFfmpegError = new Error(`ffmpeg was not found. Install ffmpeg or set FFMPEG_PATH. Tried: ${ffmpegPath}`);
        missingFfmpegError.code = "FFMPEG_NOT_FOUND";
        settleReject(missingFfmpegError);
        return;
      }
      settleReject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(`ffmpeg failed with exit code ${code}.${detail ? ` ${detail}` : ""}`));
    });

    child.stdin.end(inputBuffer);
  });
}
