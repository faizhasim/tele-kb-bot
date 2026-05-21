/**
 * Telegram media downloader for tele-kb-bot.
 *
 * Downloads photos, documents, and voice messages from Telegram
 * to <config_dir>/telegram-tmp/ and cleans up after processing.
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getLogger } from "../logger";

/** Maximum download file size in bytes (20 MB). */
const MAX_DOWNLOAD_SIZE = 20 * 1024 * 1024;

/**
 * Download a file from Telegram to the temp directory.
 *
 * @param url - The file download URL
 * @param ext - File extension (e.g., ".jpg", ".pdf")
 * @param tempDir - Temp directory to save to
 * @returns Local file path, or undefined if download failed
 */
export async function downloadTelegramFile(url: string, ext: string, tempDir: string): Promise<string | undefined> {
  const log = getLogger();
  const fileName = `${randomUUID()}${ext}`;
  const filePath = join(tempDir, fileName);

  try {
    mkdirSync(tempDir, { recursive: true, mode: 0o700 });

    const response = await fetch(url);

    if (!response.ok) {
      log.warn({ url, status: response.status }, "Failed to download Telegram file");
      return undefined;
    }

    // Check content length
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_SIZE) {
      log.warn({ url, size: contentLength }, "File exceeds max download size");
      return undefined;
    }

    // Stream to file using Bun's write
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Write using Bun.write for performance
    await Bun.write(filePath, buffer);

    log.debug({ filePath, size: buffer.length }, "Downloaded Telegram file");
    return filePath;
  } catch (err) {
    log.warn({ err, url }, "Failed to download Telegram file");
    return undefined;
  }
}

/**
 * Determine file extension from MIME type.
 */
export function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "application/json": ".json",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "video/mp4": ".mp4",
    "application/zip": ".zip",
    "application/gzip": ".gz",
  };
  return map[mimeType] ?? ".bin";
}

/**
 * Get file extension from a file name.
 */
export function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex > 0) {
    return fileName.substring(dotIndex).toLowerCase();
  }
  return ".bin";
}

/**
 * Delete a downloaded temp file.
 */
export function cleanupFile(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // File may already be deleted — ignore
  }
}

/**
 * Clean up all files in a temp directory.
 */
export function cleanupTempDir(tempDir: string): void {
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(tempDir);
    for (const file of files) {
      try {
        unlinkSync(join(tempDir, file));
      } catch {
        // ignore individual failures
      }
    }
  } catch {
    // Directory may not exist — ignore
  }
}
