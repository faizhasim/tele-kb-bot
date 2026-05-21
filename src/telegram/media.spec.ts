/**
 * Tests for the Telegram media utilities.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanupFile, cleanupTempDir, downloadTelegramFile, getExtension, mimeToExtension } from './media';

// ─── Hoisted Mocks ───────────────────────────────────────────────────

const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());
const mockRandomUUID = vi.hoisted(() => vi.fn().mockReturnValue('test-uuid-123'));
const mockFetch = vi.hoisted(() => vi.fn());
const mockBunWrite = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

vi.mock('node:fs', () => ({
  unlinkSync: mockUnlinkSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
}));

vi.mock('node:crypto', () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock('../logger', () => ({
  getLogger: () => mockLogger,
}));

// ─── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal('Bun', { write: mockBunWrite });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── cleanupFile ────────────────────────────────────────────────────

describe('cleanupFile', () => {
  it('removes file from filesystem', () => {
    cleanupFile('/tmp/test/file.txt');
    expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/test/file.txt');
  });

  it('handles non-existent file gracefully', () => {
    mockUnlinkSync.mockImplementationOnce(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => cleanupFile('/tmp/test/missing.txt')).not.toThrow();
  });

  it('handles permission error gracefully', () => {
    mockUnlinkSync.mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => cleanupFile('/tmp/test/restricted.txt')).not.toThrow();
  });
});

// ─── mimeToExtension ────────────────────────────────────────────────

describe('mimeToExtension', () => {
  it('returns .jpg for image/jpeg', () => {
    expect(mimeToExtension('image/jpeg')).toBe('.jpg');
  });

  it('returns .png for image/png', () => {
    expect(mimeToExtension('image/png')).toBe('.png');
  });

  it('returns .gif for image/gif', () => {
    expect(mimeToExtension('image/gif')).toBe('.gif');
  });

  it('returns .pdf for application/pdf', () => {
    expect(mimeToExtension('application/pdf')).toBe('.pdf');
  });

  it('returns .mp3 for audio/mpeg', () => {
    expect(mimeToExtension('audio/mpeg')).toBe('.mp3');
  });

  it('returns .bin for unknown MIME types', () => {
    expect(mimeToExtension('application/octet-stream')).toBe('.bin');
  });
});

// ─── getExtension ───────────────────────────────────────────────────

describe('getExtension', () => {
  it('returns extension from filename', () => {
    expect(getExtension('photo.jpg')).toBe('.jpg');
  });

  it('handles multiple dots', () => {
    expect(getExtension('archive.tar.gz')).toBe('.gz');
  });

  it('returns .bin for no extension', () => {
    expect(getExtension('Makefile')).toBe('.bin');
  });

  it('is case-insensitive', () => {
    expect(getExtension('Photo.JPG')).toBe('.jpg');
  });

  it('handles hidden files with extension', () => {
    expect(getExtension('.eslintrc.json')).toBe('.json');
  });
});

// ─── downloadTelegramFile ───────────────────────────────────────────

describe('downloadTelegramFile', () => {
  const testUrl = 'https://api.telegram.org/file/bot123/photo.jpg';
  const testExt = '.jpg';
  const testTempDir = '/tmp/telegram-tmp';
  const expectedPath = '/tmp/telegram-tmp/test-uuid-123.jpg';
  const mockArrayBuffer = new ArrayBuffer(8);

  const buildOkResponse = (contentLength?: string) => ({
    ok: true,
    status: 200,
    headers: {
      get: vi.fn((name: string) => {
        if (name === 'content-length') return contentLength ?? '1000';
        return null;
      }),
    },
    arrayBuffer: vi.fn().mockResolvedValue(mockArrayBuffer),
  });

  beforeEach(() => {
    mockBunWrite.mockResolvedValue(undefined);
  });

  it('downloads file and returns correct path', async () => {
    mockFetch.mockResolvedValueOnce(buildOkResponse('5000'));

    const result = await downloadTelegramFile(testUrl, testExt, testTempDir);

    expect(result).toBe(expectedPath);
    expect(mockMkdirSync).toHaveBeenCalledWith(testTempDir, {
      recursive: true,
      mode: 0o700,
    });
    expect(mockFetch).toHaveBeenCalledWith(testUrl);
    expect(mockBunWrite).toHaveBeenCalledWith(expectedPath, expect.any(Buffer));
    expect(mockLogger.debug).toHaveBeenCalledWith({ filePath: expectedPath, size: 8 }, 'Downloaded Telegram file');
  });

  it('returns undefined on HTTP error', async () => {
    const errResponse = {
      ok: false,
      status: 403,
      headers: { get: vi.fn() },
      arrayBuffer: vi.fn(),
    };
    mockFetch.mockResolvedValueOnce(errResponse);

    const result = await downloadTelegramFile(testUrl, testExt, testTempDir);

    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith({ url: testUrl, status: 403 }, 'Failed to download Telegram file');
  });

  it('returns undefined when file exceeds max download size', async () => {
    // MAX_DOWNLOAD_SIZE = 20MB = 20971520 bytes
    mockFetch.mockResolvedValueOnce(buildOkResponse('30000000'));

    const result = await downloadTelegramFile(testUrl, testExt, testTempDir);

    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith({ url: testUrl, size: '30000000' }, 'File exceeds max download size');
  });

  it('returns undefined when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await downloadTelegramFile(testUrl, testExt, testTempDir);

    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error), url: testUrl },
      'Failed to download Telegram file',
    );
  });

  it('returns undefined when Bun.write fails', async () => {
    mockFetch.mockResolvedValueOnce(buildOkResponse('1000'));
    mockBunWrite.mockRejectedValueOnce(new Error('Disk full'));

    const result = await downloadTelegramFile(testUrl, testExt, testTempDir);

    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('handles missing content-length header', async () => {
    mockFetch.mockResolvedValueOnce(buildOkResponse(undefined));

    const result = await downloadTelegramFile(testUrl, testExt, testTempDir);

    // Missing content-length should pass through and download normally
    expect(result).toBe(expectedPath);
    expect(mockBunWrite).toHaveBeenCalledWith(expectedPath, expect.any(Buffer));
  });
});

// ─── cleanupTempDir ─────────────────────────────────────────────────

describe('cleanupTempDir', () => {
  it('handles non-existent directory gracefully (outer catch)', () => {
    expect(() => cleanupTempDir('/tmp/nonexistent-tele-kb-test-dir')).not.toThrow();
  });
});
