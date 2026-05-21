/**
 * Tests for the Telegram message handler.
 *
 * Tests isUserAllowed (exported) and the internal buildPrompt / downloadMediaFiles
 * functions through the public handleMessage API.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { handleMessage, isUserAllowed } from './handler';

// ─── Hoisted Mocks ───────────────────────────────────────────────────

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

const mockCleanupFile = vi.hoisted(() => vi.fn());
const mockDownloadTelegramFile = vi.hoisted(() => vi.fn());
const mockStreamStop = vi.hoisted(() => vi.fn());
const mockStartStreaming = vi.hoisted(() => vi.fn().mockReturnValue({ stop: mockStreamStop }));
const mockMkdirSync = vi.hoisted(() => vi.fn());

vi.mock('../logger', () => ({ getLogger: () => mockLogger }));
vi.mock('./media', () => ({ cleanupFile: mockCleanupFile, downloadTelegramFile: mockDownloadTelegramFile }));
vi.mock('./streaming', () => ({ startStreaming: mockStartStreaming }));
vi.mock('node:fs', () => ({ mkdirSync: mockMkdirSync }));

// ─── Fixtures ───────────────────────────────────────────────────────

const defaultConfig = {
  telegram: { bot_token: 'test:token', allowed_user_ids: [] },
  llm: { provider: 'test', model: 'test', reasoning: 'low' },
  memory: {
    enabled: false,
    mode: 'ephemeral' as const,
    auto_inject: false,
    search: { max_results: 3, mode: 'keyword' as const },
    cache: { max_entries: 100, max_size_bytes: 1_048_576 },
    qmd: { enabled: false, binary_path: '/dev/null' },
  },
  bot: { max_attachments_per_turn: 10, streaming_preview: true, text_chunk_size: 4_096 },
  vault_directories: [],
};

const defaultConfigDir = '/tmp/test-config';
const defaultTempDir = `${defaultConfigDir}/telegram-tmp`;

const createMockClient = () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getFileUrl: vi.fn().mockResolvedValue('https://api.telegram.org/file/test/file.bin'),
  sendChatAction: vi.fn().mockResolvedValue(undefined),
  botToken: 'test:token',
});

const createMockSession = () => ({
  prompt: vi.fn().mockResolvedValue('response text'),
});

const createMockSessionRegistry = (session = createMockSession()) => ({
  getOrCreate: vi.fn().mockResolvedValue(session),
});

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── isUserAllowed ──────────────────────────────────────────────────

describe('isUserAllowed', () => {
  it('returns true when allowed_user_ids is empty (allow all)', () => {
    const config = { ...defaultConfig, telegram: { ...defaultConfig.telegram, allowed_user_ids: [] } };
    expect(isUserAllowed(42, config)).toBe(true);
    expect(isUserAllowed(999, config)).toBe(true);
    expect(isUserAllowed(0, config)).toBe(true);
  });

  it('returns true when userId is in allowed list', () => {
    const config = { ...defaultConfig, telegram: { ...defaultConfig.telegram, allowed_user_ids: [100, 200, 300] } };
    expect(isUserAllowed(100, config)).toBe(true);
    expect(isUserAllowed(200, config)).toBe(true);
    expect(isUserAllowed(300, config)).toBe(true);
  });

  it('returns false when userId is not in allowed list', () => {
    const config = { ...defaultConfig, telegram: { ...defaultConfig.telegram, allowed_user_ids: [100, 200] } };
    expect(isUserAllowed(42, config)).toBe(false);
    expect(isUserAllowed(101, config)).toBe(false);
    expect(isUserAllowed(0, config)).toBe(false);
  });
});

// ─── buildPrompt (tested through handleMessage) ──────────────────────

describe('buildPrompt (through handleMessage)', () => {
  it('simple text message returns just the text', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);

    await handleMessage(
      { type: 'text', text: 'hello', chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // buildPrompt('hello', []) → 'hello'
    // prompt arg: '[telegram-kb] hello'
    expect(session.prompt).toHaveBeenCalledWith('[telegram-kb] hello');
  });

  it('text + file paths appends attachment count note', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    mockDownloadTelegramFile.mockResolvedValue(`${defaultTempDir}/uuid.jpg`);

    await handleMessage(
      { type: 'text', text: 'hello with file', fileIds: ['f1'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // buildPrompt('hello with file', [tempDir/uuid.jpg]) →
    //   'hello with file\n[Attached 1 file(s)]'
    // attachmentsSection: '\n\nAttachments:\n- /tmp/test-config/telegram-tmp/uuid.jpg'
    // prompt arg: '[telegram-kb] hello with file\n[Attached 1 file(s)]\n\nAttachments:\n- /tmp/test-config/telegram-tmp/uuid.jpg'
    expect(session.prompt).toHaveBeenCalledWith(
      '[telegram-kb] hello with file\n[Attached 1 file(s)]\n\nAttachments:\n- /tmp/test-config/telegram-tmp/uuid.jpg',
    );
  });

  it('photo type adds photo note', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    mockDownloadTelegramFile.mockResolvedValue(`${defaultTempDir}/uuid.jpg`);

    await handleMessage(
      { type: 'photo', text: 'nice pic', fileIds: ['f1'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // buildPrompt adds '[User sent a photo]' for photo type
    expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('[User sent a photo]'));
    // The prompt should contain all parts
    const callArg = (session.prompt as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callArg).toContain('nice pic');
    expect(callArg).toContain('[Attached 1 file(s)]');
    expect(callArg).toContain('[User sent a photo]');
    expect(callArg).toContain('[telegram-kb]');
  });

  it('voice type adds voice note', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    mockDownloadTelegramFile.mockResolvedValue(`${defaultTempDir}/uuid.bin`);

    await handleMessage(
      { type: 'voice', fileIds: ['f1'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    const callArg = (session.prompt as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callArg).toContain('[Attached 1 file(s)]');
    expect(callArg).toContain('[User sent a voice message (audio file attached)]');
    expect(callArg).toContain('[telegram-kb]');
  });

  it('document without text adds document note', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    mockDownloadTelegramFile.mockResolvedValue(`${defaultTempDir}/uuid.bin`);

    await handleMessage(
      { type: 'document', fileIds: ['f1'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    const callArg = (session.prompt as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callArg).toContain('[Attached 1 file(s)]');
    expect(callArg).toContain('[User sent a file]');
    // Should NOT have text content
    expect(callArg).not.toContain('undefined');
  });

  it('empty message with no text/fileIds returns empty', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);

    await handleMessage(
      { type: 'text', chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // buildPrompt returns '' (empty string)
    // prompt arg: '[telegram-kb] '  (prefix with trailing space)
    expect(session.prompt).toHaveBeenCalledWith('[telegram-kb] ');
  });
});

// ─── handleMessage ──────────────────────────────────────────────────

describe('handleMessage', () => {
  it('unauthorized user returns early (does not call session)', async () => {
    const config = { ...defaultConfig, telegram: { ...defaultConfig.telegram, allowed_user_ids: [42] } };
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);

    await handleMessage(
      { type: 'text', text: 'hello', chatId: 123, userId: 999, messageId: 1 },
      { config, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // Should not have created a session or started streaming
    expect(sessionRegistry.getOrCreate).not.toHaveBeenCalled();
    expect(mockStartStreaming).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
    // Logger should have the debug message
    expect(mockLogger.debug).toHaveBeenCalledWith({ userId: 999 }, 'Ignoring message from unauthorized user');
  });

  it('calls downloadMediaFiles when message has fileIds', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    mockDownloadTelegramFile.mockResolvedValue(`${defaultTempDir}/uuid.jpg`);

    await handleMessage(
      { type: 'text', text: 'with file', fileIds: ['f1', 'f2'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // temp dir should have been created
    expect(mockMkdirSync).toHaveBeenCalledWith(defaultTempDir, { recursive: true, mode: 0o700 });
    // getFileUrl called for each fileId
    expect(client.getFileUrl).toHaveBeenCalledTimes(2);
    expect(client.getFileUrl).toHaveBeenCalledWith('f1');
    expect(client.getFileUrl).toHaveBeenCalledWith('f2');
    // downloadTelegramFile called for each file
    expect(mockDownloadTelegramFile).toHaveBeenCalledTimes(2);
    // cleanup should happen for downloaded files
    expect(mockCleanupFile).toHaveBeenCalledTimes(2);
  });

  it('no session registry responds with stub message', async () => {
    const client = createMockClient();

    await handleMessage(
      { type: 'text', text: 'hello bot', chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry: undefined },
    );

    expect(client.sendMessage).toHaveBeenCalledWith(
      123,
      expect.stringContaining('Received: text message — "hello bot"'),
    );
    // No streaming or session should be involved
    expect(mockStartStreaming).not.toHaveBeenCalled();
  });

  it('creates session, sends prompt, stops streaming on success', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);

    await handleMessage(
      { type: 'text', text: 'hello', chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // Session should have been created/retrieved
    expect(sessionRegistry.getOrCreate).toHaveBeenCalledWith(123);
    // Streaming should have been started for this chat
    expect(mockStartStreaming).toHaveBeenCalledWith(client, 123);
    // Session should have received the prompt
    expect(session.prompt).toHaveBeenCalledWith('[telegram-kb] hello');
    // Streaming should have been stopped
    expect(mockStreamStop).toHaveBeenCalled();
  });

  it('catches errors, logs, and sends error message', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    const testError = new Error('Processing failed');
    session.prompt.mockRejectedValue(testError);

    await handleMessage(
      { type: 'text', text: 'hello', chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // Streaming should have been stopped (in catch block)
    expect(mockStreamStop).toHaveBeenCalled();
    // Error should have been logged
    expect(mockLogger.error).toHaveBeenCalledWith({ err: testError, chatId: 123 }, 'Error processing message');
    // Error message should be sent to the chat
    expect(client.sendMessage).toHaveBeenCalledWith(123, 'Sorry, an error occurred while processing your message.');
  });

  it('cleans up temp files in finally block', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    const file1 = `${defaultTempDir}/file1.jpg`;
    const file2 = `${defaultTempDir}/file2.jpg`;
    mockDownloadTelegramFile.mockResolvedValueOnce(file1).mockResolvedValueOnce(file2);

    await handleMessage(
      { type: 'text', text: 'two files', fileIds: ['f1', 'f2'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // Both files should be cleaned up regardless of success
    expect(mockCleanupFile).toHaveBeenCalledTimes(2);
    expect(mockCleanupFile).toHaveBeenCalledWith(file1);
    expect(mockCleanupFile).toHaveBeenCalledWith(file2);
  });

  it('cleans up temp files in finally block even on error', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    const file1 = `${defaultTempDir}/file1.jpg`;
    mockDownloadTelegramFile.mockResolvedValue(file1);
    session.prompt.mockRejectedValue(new Error('fail'));

    await handleMessage(
      { type: 'text', text: 'crash', fileIds: ['f1'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // Cleanup should still happen in finally even when error occurs
    expect(mockCleanupFile).toHaveBeenCalledWith(file1);
  });

  it('calls startStreaming before session call', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);

    await handleMessage(
      { type: 'text', text: 'order test', chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // In the code: streaming = startStreaming(...) happens BEFORE
    // session = sessionRegistry.getOrCreate(...)
    // So startStreaming should be called before getOrCreate
    const startCallIndex = mockStartStreaming.mock.invocationCallOrder[0];
    const getOrCreateCallIndex = sessionRegistry.getOrCreate.mock.invocationCallOrder[0];
    expect(startCallIndex).toBeLessThan(getOrCreateCallIndex);
  });
});

// ─── downloadMediaFiles (tested through handleMessage) ───────────────

describe('downloadMediaFiles (through handleMessage)', () => {
  it('returns empty array when no fileIds (no download calls)', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);

    await handleMessage(
      { type: 'text', text: 'no media', chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // No file operations
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(client.getFileUrl).not.toHaveBeenCalled();
    expect(mockDownloadTelegramFile).not.toHaveBeenCalled();
    // No cleanup needed
    expect(mockCleanupFile).not.toHaveBeenCalled();
  });

  it('creates temp dir with correct path', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    mockDownloadTelegramFile.mockResolvedValue(`${defaultTempDir}/uuid.bin`);

    await handleMessage(
      { type: 'text', text: 'with file', fileIds: ['f1'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    expect(mockMkdirSync).toHaveBeenCalledWith(defaultTempDir, { recursive: true, mode: 0o700 });
  });

  it('downloads each file and returns paths', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    const path1 = `${defaultTempDir}/uuid-1.jpg`;
    const path2 = `${defaultTempDir}/uuid-2.jpg`;
    mockDownloadTelegramFile.mockResolvedValueOnce(path1).mockResolvedValueOnce(path2);

    await handleMessage(
      { type: 'text', text: 'two files', fileIds: ['f1', 'f2'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    expect(client.getFileUrl).toHaveBeenCalledTimes(2);
    expect(mockDownloadTelegramFile).toHaveBeenCalledTimes(2);
    // Verify downloadTelegramFile is called with the right extension for non-photo type
    expect(mockDownloadTelegramFile).toHaveBeenCalledWith(
      'https://api.telegram.org/file/test/file.bin',
      '.bin',
      defaultTempDir,
    );
    // Both paths should be cleaned up
    expect(mockCleanupFile).toHaveBeenCalledWith(path1);
    expect(mockCleanupFile).toHaveBeenCalledWith(path2);
  });

  it('downloads photo files with .jpg extension', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    mockDownloadTelegramFile.mockResolvedValue(`${defaultTempDir}/uuid.jpg`);

    await handleMessage(
      { type: 'photo', text: 'photo', fileIds: ['f1'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // Photo type should use .jpg extension
    expect(mockDownloadTelegramFile).toHaveBeenCalledWith(expect.any(String), '.jpg', defaultTempDir);
  });

  it('skips files where getFileUrl returns null', async () => {
    const client = createMockClient();
    const session = createMockSession();
    const sessionRegistry = createMockSessionRegistry(session);
    // First file has no URL, second does
    client.getFileUrl.mockResolvedValueOnce(null).mockResolvedValueOnce('https://api.telegram.org/file/test/file2.bin');
    mockDownloadTelegramFile.mockResolvedValue(`${defaultTempDir}/uuid-2.bin`);

    await handleMessage(
      { type: 'text', text: 'partial', fileIds: ['f1', 'f2'], chatId: 123, userId: 123, messageId: 1 },
      { config: defaultConfig, configDir: defaultConfigDir, client, sessionRegistry },
    );

    // downloadTelegramFile should only be called for the second file
    expect(mockDownloadTelegramFile).toHaveBeenCalledTimes(1);
    // Only the one downloaded file should be cleaned up
    expect(mockCleanupFile).toHaveBeenCalledTimes(1);
  });
});
