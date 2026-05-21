/**
 * Tests for the Telegram bot client.
 *
 * All network calls are mocked — no real API calls.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

import { createTelegramClient, sendText, sendDocument, sendChatAction, verifyToken } from './client';
import { splitIntoChunks, truncateCaption } from './chunking';

// ─── Mocks ──────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('./chunking', () => ({
  splitIntoChunks: vi.fn((text: string) => [text]),
  truncateCaption: vi.fn((text: string) => text),
}));

// ─── Helpers ────────────────────────────────────────────────────────

const BOT_TOKEN = 'test:token';
const CHAT_ID = 12345;

const makeOkResponse = <T>(result: T): Response =>
  ({
    ok: true,
    json: async () => ({ ok: true, result }),
  }) as unknown as Response;

const makeErrorResponse = (description: string): Response =>
  ({
    ok: true,
    json: async () => ({ ok: false, description }),
  }) as unknown as Response;

interface CallArgs {
  readonly url: string;
  readonly method: string;
  readonly headers?: Record<string, string>;
  readonly body: unknown;
}

function getCallArgs(callIndex: number): CallArgs {
  const call = mockFetch.mock.calls[callIndex];
  if (!call) throw new Error(`No mock fetch call at index ${callIndex}`);
  const [url, options] = call as [string, RequestInit | undefined];
  return {
    url,
    method: options?.method ?? 'GET',
    headers: options?.headers as Record<string, string> | undefined,
    body: options?.body as unknown,
  };
}

function parseBody(callIndex: number): unknown {
  const body = getCallArgs(callIndex).body;
  return typeof body === 'string' ? JSON.parse(body as string) : body;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('TelegramApiError', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('is returned when the API responds with ok: false', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse('Unauthorized'));

    const result = await Effect.runPromise(verifyToken(BOT_TOKEN));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unauthorized');
  });

  it('is returned for network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await Effect.runPromise(verifyToken(BOT_TOKEN));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network failure');
  });

  it('is returned when fetch throws a non-Error', async () => {
    mockFetch.mockRejectedValueOnce('string error');

    const result = await Effect.runPromise(verifyToken(BOT_TOKEN));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('string error');
  });
});

describe('apiGet (via verifyToken)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('constructs correct Telegram API URL for getMe', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 123, is_bot: true, first_name: 'TestBot' }));

    await Effect.runPromise(verifyToken(BOT_TOKEN));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url } = getCallArgs(0);
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
  });
});

describe('apiPostJson (via sendText)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(splitIntoChunks).mockImplementation((text: string) => [text]);
  });

  it('makes POST request with JSON body', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ message_id: 42, chat: { id: CHAT_ID } }));

    await Effect.runPromise(sendText(BOT_TOKEN, CHAT_ID, 'Hello'));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, method, headers, body } = getCallArgs(0);
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    expect(method).toBe('POST');
    expect(headers).toEqual({ 'Content-Type': 'application/json' });
    expect(body).toEqual(JSON.stringify({ chat_id: CHAT_ID, text: 'Hello' }));
  });

  it('includes reply_parameters when replyToMessageId is set', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ message_id: 43, chat: { id: CHAT_ID } }));

    await Effect.runPromise(sendText(BOT_TOKEN, CHAT_ID, 'Reply text', { replyToMessageId: 99 }));

    const body = parseBody(0) as Record<string, unknown>;
    expect(body.reply_parameters).toEqual({ message_id: 99 });
  });

  it('includes link_preview_options when disablePreview is true', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ message_id: 44, chat: { id: CHAT_ID } }));

    await Effect.runPromise(sendText(BOT_TOKEN, CHAT_ID, 'No preview', { disablePreview: true }));

    const body = parseBody(0) as Record<string, unknown>;
    expect(body.link_preview_options).toEqual({ is_disabled: true });
  });

  it('returns SendResult with ok:true and messageId on success', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ message_id: 42, chat: { id: CHAT_ID } }));

    const result = await Effect.runPromise(sendText(BOT_TOKEN, CHAT_ID, 'Hello'));

    expect(result).toEqual({ ok: true, messageId: 42 });
  });

  it('returns SendResult with ok:false when API returns error', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse('Bot was blocked by the user'));

    const result = await Effect.runPromise(sendText(BOT_TOKEN, CHAT_ID, 'Hello'));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Bot was blocked by the user');
  });

  it('splits long text into multiple chunks', async () => {
    vi.mocked(splitIntoChunks).mockImplementation((_text: string) => ['Chunk 1', 'Chunk 2']);
    mockFetch.mockResolvedValue(makeOkResponse({ message_id: 1, chat: { id: CHAT_ID } }));

    const result = await Effect.runPromise(sendText(BOT_TOKEN, CHAT_ID, 'Long text'));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, messageId: 1 });
  });
});

describe('sendDocument', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(truncateCaption).mockImplementation((text: string) => text);
  });

  it('sends a document via multipart POST', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(Buffer.from('file content'));

    mockFetch.mockResolvedValueOnce(makeOkResponse({ message_id: 50, chat: { id: CHAT_ID } }));

    const result = await Effect.runPromise(sendDocument(BOT_TOKEN, CHAT_ID, '/path/to/file.pdf'));

    expect(result).toEqual({ ok: true, messageId: 50 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, method } = getCallArgs(0);
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`);
    expect(method).toBe('POST');
  });

  it('includes body as FormData', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(Buffer.from('data'));

    mockFetch.mockResolvedValueOnce(makeOkResponse({ message_id: 51, chat: { id: CHAT_ID } }));

    await Effect.runPromise(sendDocument(BOT_TOKEN, CHAT_ID, '/path/to/file.pdf'));

    const { body } = getCallArgs(0);
    expect(body).toBeInstanceOf(FormData);
  });

  it('includes caption when provided', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(Buffer.from('data'));

    mockFetch.mockResolvedValueOnce(makeOkResponse({ message_id: 51, chat: { id: CHAT_ID } }));

    await Effect.runPromise(sendDocument(BOT_TOKEN, CHAT_ID, '/path/to/file.pdf', 'A caption'));

    const { body } = getCallArgs(0);
    const formData = body as FormData;
    expect(formData.get('caption')).toBe('A caption');
  });

  it('handles file read errors gracefully', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('File not found'));

    const result = await Effect.runPromise(sendDocument(BOT_TOKEN, CHAT_ID, '/nonexistent/file.pdf'));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('File not found');
  });
});

describe('verifyToken', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns ok:true with botName on success', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 123, is_bot: true, first_name: 'MyBot' }));

    const result = await Effect.runPromise(verifyToken(BOT_TOKEN));

    expect(result).toEqual({ ok: true, botName: 'MyBot' });
  });

  it('returns ok:false with error on API failure', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse('Not Found'));

    const result = await Effect.runPromise(verifyToken(BOT_TOKEN));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Not Found');
  });
});

describe('sendChatAction', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends typing action by default', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(true));

    await Effect.runPromise(sendChatAction(BOT_TOKEN, CHAT_ID));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, body } = getCallArgs(0);
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`);
    expect(body).toEqual(JSON.stringify({ chat_id: CHAT_ID, action: 'typing' }));
  });

  it('sends specified action', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(true));

    await Effect.runPromise(sendChatAction(BOT_TOKEN, CHAT_ID, 'upload_document'));

    const body = parseBody(0) as Record<string, unknown>;
    expect(body.action).toBe('upload_document');
  });

  it('does not propagate errors (best-effort)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Timeout'));

    const result = await Effect.runPromise(sendChatAction(BOT_TOKEN, CHAT_ID));

    expect(result).toBeUndefined();
  });
});

describe('createTelegramClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(splitIntoChunks).mockImplementation((text: string) => [text]);
  });

  it('returns a client with bound bot token', () => {
    const client = createTelegramClient(BOT_TOKEN);
    expect(client.botToken).toBe(BOT_TOKEN);
    expect(typeof client.sendText).toBe('function');
    expect(typeof client.sendDocument).toBe('function');
    expect(typeof client.sendChatAction).toBe('function');
    expect(typeof client.verifyToken).toBe('function');
  });

  it('sendText wrapper calls underlying sendText with bound token', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ message_id: 100, chat: { id: CHAT_ID } }));

    const client = createTelegramClient(BOT_TOKEN);
    const result = await Effect.runPromise(client.sendText(CHAT_ID, 'Hello from client'));

    expect(result.ok).toBe(true);
    expect(result.messageId).toBe(100);
  });

  it('sendChatAction wrapper calls underlying sendChatAction', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(true));

    const client = createTelegramClient(BOT_TOKEN);
    await Effect.runPromise(client.sendChatAction(CHAT_ID, 'typing'));

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('verifyToken wrapper calls underlying verifyToken', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 1, is_bot: true, first_name: 'TestBot' }));

    const client = createTelegramClient(BOT_TOKEN);
    const result = await Effect.runPromise(client.verifyToken());

    expect(result.ok).toBe(true);
    expect(result.botName).toBe('TestBot');
  });

  it('sendDocument wrapper calls underlying sendDocument', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(Buffer.from('data'));
    mockFetch.mockResolvedValueOnce(makeOkResponse({ message_id: 200, chat: { id: CHAT_ID } }));

    const client = createTelegramClient(BOT_TOKEN);
    const result = await Effect.runPromise(client.sendDocument(CHAT_ID, '/path/to/file.pdf'));

    expect(result.ok).toBe(true);
    expect(result.messageId).toBe(200);
  });
});

describe('sendDocument error paths', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(truncateCaption).mockImplementation((text: string) => text);
  });

  it('handles API error response (ok: false) during document upload', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(Buffer.from('file content'));
    mockFetch.mockResolvedValueOnce(makeErrorResponse('Bad Request: file is too large'));

    const result = await Effect.runPromise(sendDocument(BOT_TOKEN, CHAT_ID, '/path/to/file.pdf'));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('file is too large');
  });

  it('handles fetch rejection during document upload', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(Buffer.from('file content'));
    mockFetch.mockRejectedValueOnce(new Error('Network error during upload'));

    const result = await Effect.runPromise(sendDocument(BOT_TOKEN, CHAT_ID, '/path/to/file.pdf'));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network error during upload');
  });
});
