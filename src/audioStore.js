import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { TosClient } from "@volcengine/tos-sdk";

const tosBucket = process.env.TOS_BUCKET || "";
const tosRegion = process.env.TOS_REGION || "cn-beijing";
const tosEndpoint = process.env.TOS_ENDPOINT || `tos-${tosRegion}.volces.com`;
const tosAccessKeyId = process.env.TOS_ACCESS_KEY_ID || "";
const tosAccessKeySecret = process.env.TOS_ACCESS_KEY_SECRET || "";
const tosPrefix = normalizePrefix(process.env.TOS_PREFIX || "ielts-voice-lab");

let tosClient;

export function isTosEnabled() {
  return Boolean(tosBucket && tosRegion && tosEndpoint && tosAccessKeyId && tosAccessKeySecret);
}

export function storageMode() {
  return isTosEnabled() ? "tos" : "local";
}

function normalizePrefix(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function assertSafeFilename(filename) {
  if (typeof filename !== "string" || !filename || filename.includes("/") || filename.includes("..")) {
    throw new Error("Audio filename is invalid.");
  }
}

function objectKey(category, filename) {
  assertSafeFilename(filename);
  const cleanCategory = normalizePrefix(category);
  const parts = [tosPrefix, cleanCategory, filename].filter(Boolean);
  return parts.join("/");
}

function client() {
  if (!isTosEnabled()) {
    return null;
  }
  if (!tosClient) {
    tosClient = new TosClient({
      accessKeyId: tosAccessKeyId,
      accessKeySecret: tosAccessKeySecret,
      region: tosRegion,
      endpoint: tosEndpoint,
      bucket: tosBucket,
      requestTimeout: 120000
    });
  }
  return tosClient;
}

export function publicAudioUrl(category, filename) {
  assertSafeFilename(filename);
  return `/${normalizePrefix(category)}/${encodeURIComponent(filename)}`;
}

export async function saveAudioObject({ category, localDir, filename, buffer, contentType }) {
  assertSafeFilename(filename);

  if (isTosEnabled()) {
    await client().putObject({
      bucket: tosBucket,
      key: objectKey(category, filename),
      body: buffer,
      contentType
    });
    return {
      storage: "tos",
      key: objectKey(category, filename),
      bucket: tosBucket
    };
  }

  await fs.writeFile(path.join(localDir, filename), buffer);
  return {
    storage: "local",
    path: path.join(localDir, filename)
  };
}

export async function deleteAudioObject({ category, localDir, filename }) {
  assertSafeFilename(filename);

  const deletions = [
    fs.unlink(path.join(localDir, filename)).catch((error) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    })
  ];

  if (isTosEnabled()) {
    deletions.push(
      client()
        .deleteObject({
          bucket: tosBucket,
          key: objectKey(category, filename)
        })
        .catch((error) => {
          if (!isNotFoundError(error)) {
            throw error;
          }
        })
    );
  }

  await Promise.all(deletions);
}

export async function audioObjectExists({ category, localDir, filename }) {
  assertSafeFilename(filename);

  if (isTosEnabled()) {
    try {
      await client().headObject({
        bucket: tosBucket,
        key: objectKey(category, filename)
      });
      return true;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  try {
    await fs.access(path.join(localDir, filename));
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return false;
  }
}

export async function readAudioObject({ category, localDir, filename, range, fallbackContentType }) {
  assertSafeFilename(filename);

  if (isTosEnabled()) {
    try {
      const result = await client().getObjectV2({
        bucket: tosBucket,
        key: objectKey(category, filename),
        dataType: "stream",
        range
      });
      return objectResponseFromTos(result, fallbackContentType);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  return readLocalAudioObject({ localDir, filename, range, fallbackContentType });
}

function objectResponseFromTos(result, fallbackContentType) {
  const headers = result.headers || {};
  const content = result.data?.content;
  return {
    statusCode: result.statusCode || 200,
      content: content && typeof content.pipe === "function" ? content : Readable.from(content ?? []),
    headers: {
      "accept-ranges": "bytes",
      "cache-control": headers["cache-control"] || "private, max-age=3600",
      "content-length": headers["content-length"],
      "content-range": headers["content-range"],
      "content-type": headers["content-type"] || fallbackContentType || "application/octet-stream",
      etag: headers.etag,
      "last-modified": headers["last-modified"]
    }
  };
}

async function readLocalAudioObject({ localDir, filename, range, fallbackContentType }) {
  const filePath = path.join(localDir, filename);
  const stat = await fs.stat(filePath);
  const parsedRange = parseRange(range, stat.size);

  if (range && !parsedRange) {
    return {
      statusCode: 416,
      content: Readable.from([]),
      headers: {
        "content-range": `bytes */${stat.size}`,
        "content-length": "0"
      }
    };
  }

  const start = parsedRange?.start ?? 0;
  const end = parsedRange?.end ?? stat.size - 1;
  const contentLength = end - start + 1;
  return {
    statusCode: parsedRange ? 206 : 200,
    content: createReadStream(filePath, { start, end }),
    headers: {
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      "content-length": String(contentLength),
      "content-range": parsedRange ? `bytes ${start}-${end}/${stat.size}` : undefined,
      "content-type": fallbackContentType || "application/octet-stream",
      "last-modified": stat.mtime.toUTCString()
    }
  };
}

function parseRange(range, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range || ""));
  if (!match) {
    return null;
  }

  let start;
  let end;
  if (match[1] === "" && match[2] === "") {
    return null;
  }
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

function isNotFoundError(error) {
  return (
    error?.statusCode === 404 ||
    error?.status === 404 ||
    error?.response?.status === 404 ||
    error?.code === "NoSuchKey" ||
    error?.Code === "NoSuchKey" ||
    error?.name === "NoSuchKey"
  );
}
