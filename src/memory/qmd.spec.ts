import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, detect, query, reset, run, search, vsearch } from './qmd';

// ---------------------------------------------------------------------------
// Mock execFileSync from node:child_process
// ---------------------------------------------------------------------------
const mockExec = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExec,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DEFAULT_RUN_OUTPUT = JSON.stringify([{ path: '/tmp/test.md', score: 0.85, snippet: 'hello world' }]);

/** Make detect() succeed; run() returns the given JSON by default. */
function mockDetectSuccess(runOutput = DEFAULT_RUN_OUTPUT): void {
  mockExec.mockImplementation((cmd: string, ..._rest: unknown[]) => {
    if (cmd === 'command') return ''; // detect OK
    return runOutput;
  });
}

/** Make detect() fail (default state). */
function mockDetectFailure(): void {
  mockExec.mockImplementation(() => {
    throw new Error('binary not found');
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function sharedBefore(): void {
  reset();
  configure('qmd'); // restore default binary path
  vi.clearAllMocks();
  mockDetectFailure();
}

function sharedAfter(): void {
  reset();
  configure('qmd');
}

// ===========================================================================
//  detect
// ===========================================================================
describe('detect', () => {
  beforeEach(sharedBefore);
  afterEach(sharedAfter);

  it('returns false when binary is not found', () => {
    configure('/dev/null/nonexistent-qmd-binary');
    expect(detect()).toBe(false);
  });

  it('returns true when binary is found', () => {
    mockDetectSuccess();
    expect(detect()).toBe(true);
  });

  it('caches result and does not re-execute on second call', () => {
    mockDetectSuccess();
    expect(detect()).toBe(true);
    expect(mockExec).toHaveBeenCalledTimes(1);

    // Second call uses cache
    expect(detect()).toBe(true);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('re-detects after reset()', () => {
    mockDetectSuccess();
    expect(detect()).toBe(true);
    reset();

    expect(detect()).toBe(true);
    expect(mockExec).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
//  configure
// ===========================================================================
describe('configure', () => {
  beforeEach(sharedBefore);
  afterEach(sharedAfter);

  it('sets the binary path used by detect', () => {
    mockDetectSuccess();
    configure('/custom/path/qmd');
    detect();

    expect(mockExec).toHaveBeenCalledWith('command', ['-v', '/custom/path/qmd'], { stdio: 'ignore' });
  });

  it('resets cached detection state', () => {
    mockDetectSuccess();
    detect(); // _available = true, cached

    mockDetectFailure();
    configure('/other/qmd'); // must reset _available to null
    expect(detect()).toBe(false);
  });
});

// ===========================================================================
//  reset
// ===========================================================================
describe('reset', () => {
  beforeEach(sharedBefore);
  afterEach(sharedAfter);

  it('clears cached detection, forcing re-detection on next call', () => {
    mockDetectSuccess();
    expect(detect()).toBe(true);

    mockDetectFailure();
    reset();
    expect(detect()).toBe(false);
  });

  it('is safe to call multiple times', () => {
    reset();
    reset();
    reset();

    mockDetectSuccess();
    expect(detect()).toBe(true);
  });
});

// ===========================================================================
//  run
// ===========================================================================
describe('run', () => {
  beforeEach(sharedBefore);
  afterEach(sharedAfter);

  it('returns null when qmd is not detected', () => {
    expect(run(['search', 'test'])).toBeNull();
  });

  it('returns stdout when qmd is detected', () => {
    const output = 'search result data';
    mockDetectSuccess(output);
    expect(run(['search', 'test'])).toBe(output);
  });

  it('returns null when execFileSync throws despite detection', () => {
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === 'command') return '';
      throw new Error('exec failed');
    });
    expect(run(['search', 'test'])).toBeNull();
  });

  it('passes timeout and encoding options', () => {
    mockDetectSuccess('ok');
    run(['foo'], 15_000);

    expect(mockExec).toHaveBeenCalledWith(
      'qmd',
      ['foo'],
      expect.objectContaining({ encoding: 'utf-8', stdio: 'pipe', timeout: 15_000 }),
    );
  });

  it('uses default 30_000 ms timeout when not specified', () => {
    mockDetectSuccess('ok');
    run(['bar']);

    expect(mockExec).toHaveBeenCalledWith(
      'qmd',
      ['bar'],
      expect.objectContaining({ encoding: 'utf-8', stdio: 'pipe', timeout: 30_000 }),
    );
  });
});

// ===========================================================================
//  parseOutput (tested indirectly through search / vsearch / query)
// ===========================================================================
describe('parseOutput (via search)', () => {
  beforeEach(sharedBefore);
  afterEach(sharedAfter);

  it('parses a JSON array with path/score/snippet', () => {
    mockDetectSuccess(
      JSON.stringify([
        { path: '/a.md', score: 0.9, snippet: 'alpha' },
        { path: '/b.md', score: 0.8, snippet: 'beta' },
      ]),
    );
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r).toHaveLength(2);
    expect(r?.[0]?.filePath).toBe('/a.md');
    expect(r?.[0]?.score).toBe(0.9);
    expect(r?.[0]?.snippet).toBe('alpha');
    expect(r?.[1]?.filePath).toBe('/b.md');
    expect(r?.[1]?.score).toBe(0.8);
    expect(r?.[1]?.snippet).toBe('beta');
  });

  it('handles file field name as fallback for path', () => {
    mockDetectSuccess(JSON.stringify([{ file: '/doc.md', score: 0.7, snippet: 'doc content' }]));
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r?.[0]?.filePath).toBe('/doc.md');
  });

  it('handles filePath field name as fallback for path', () => {
    mockDetectSuccess(JSON.stringify([{ filePath: '/note.md', score: 0.6, snippet: 'note content' }]));
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r?.[0]?.filePath).toBe('/note.md');
  });

  it('prefers path over file and filePath', () => {
    mockDetectSuccess(JSON.stringify([{ path: '/winner.md', file: '/loser.md', score: 0.5, snippet: 'x' }]));
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r?.[0]?.filePath).toBe('/winner.md');
  });

  it('handles a single object with results array', () => {
    mockDetectSuccess(
      JSON.stringify({
        results: [
          { path: '/a.md', score: 0.9, snippet: 'a' },
          { path: '/b.md', score: 0.8, snippet: 'b' },
        ],
      }),
    );
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r).toHaveLength(2);
  });

  it('handles empty JSON array', () => {
    mockDetectSuccess('[]');
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r).toHaveLength(0);
  });

  it('returns empty array for invalid JSON', () => {
    mockDetectSuccess('not valid json');
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r).toHaveLength(0);
  });

  it('uses relevance field as fallback for score', () => {
    mockDetectSuccess(JSON.stringify([{ path: '/a.md', relevance: 0.95, snippet: 'rel test' }]));
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r?.[0]?.score).toBe(0.95);
  });

  it('uses content field as fallback for snippet', () => {
    mockDetectSuccess(JSON.stringify([{ path: '/a.md', score: 0.5, content: 'from content field' }]));
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r?.[0]?.snippet).toBe('from content field');
  });

  it('uses text field as fallback for snippet', () => {
    mockDetectSuccess(JSON.stringify([{ path: '/a.md', score: 0.5, text: 'from text field' }]));
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r?.[0]?.snippet).toBe('from text field');
  });

  it('truncates snippet to 200 characters', () => {
    const long = 'x'.repeat(300);
    mockDetectSuccess(JSON.stringify([{ path: '/a.md', score: 0.5, snippet: long }]));
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r?.[0]?.snippet.length).toBe(200);
  });

  it('handles missing fields gracefully', () => {
    mockDetectSuccess(JSON.stringify([{}]));
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r?.[0]?.filePath).toBe('');
    expect(r?.[0]?.score).toBe(0);
    expect(r?.[0]?.snippet).toBe('');
  });

  it('handles null values in fields (?? falls through)', () => {
    mockDetectSuccess(JSON.stringify([{ path: null, score: null, snippet: null }]));
    const r = search('x');
    expect(r).not.toBeNull();
    // nullish coalescing: null ?? fallback = fallback
    expect(r?.[0]?.filePath).toBe(''); // null ?? '' → ''
    expect(r?.[0]?.score).toBe(0); // null ?? 0 → 0
    expect(r?.[0]?.snippet).toBe(''); // null ?? '' → ''
  });

  it('handles results object with no results key', () => {
    mockDetectSuccess(JSON.stringify({ foo: 'bar' }));
    const r = search('x');
    expect(r).not.toBeNull();
    expect(r).toHaveLength(0);
  });
});

// ===========================================================================
//  search
// ===========================================================================
describe('search', () => {
  beforeEach(sharedBefore);
  afterEach(sharedAfter);

  it('returns null for empty query', () => {
    expect(search('')).toBeNull();
    expect(search('   ')).toBeNull();
  });

  it('calls run with correct args and default maxResults', () => {
    mockDetectSuccess(JSON.stringify([{ path: '/a.md', score: 1, snippet: 'x' }]));
    search('test query');

    expect(mockExec).toHaveBeenCalledWith(
      'qmd',
      ['search', 'test query', '--json', '--limit', '5'],
      expect.objectContaining({ encoding: 'utf-8', stdio: 'pipe', timeout: 30_000 }),
    );
  });

  it('calls run with custom maxResults', () => {
    mockDetectSuccess(JSON.stringify([{ path: '/a.md', score: 1, snippet: 'x' }]));
    search('test', 10);

    expect(mockExec).toHaveBeenCalledWith(
      'qmd',
      ['search', 'test', '--json', '--limit', '10'],
      expect.objectContaining({ encoding: 'utf-8', stdio: 'pipe', timeout: 30_000 }),
    );
  });

  it('returns null when detect fails', () => {
    expect(search('test')).toBeNull();
  });

  it('returns parsed results when detect succeeds', () => {
    mockDetectSuccess(JSON.stringify([{ path: '/a.md', score: 0.9, snippet: 'result' }]));
    const r = search('test');
    expect(r).not.toBeNull();
    expect(r).toHaveLength(1);
    expect(r?.[0]?.filePath).toBe('/a.md');
  });
});

// ===========================================================================
//  vsearch
// ===========================================================================
describe('vsearch', () => {
  beforeEach(sharedBefore);
  afterEach(sharedAfter);

  it('calls run with correct args and 60s timeout', () => {
    mockDetectSuccess();
    vsearch('vector query', 3);

    expect(mockExec).toHaveBeenCalledWith(
      'qmd',
      ['vsearch', 'vector query', '--json', '--limit', '3'],
      expect.objectContaining({ encoding: 'utf-8', stdio: 'pipe', timeout: 60_000 }),
    );
  });

  it('returns null when not detected', () => {
    expect(vsearch('test', 5)).toBeNull();
  });

  it('returns parsed results when detected', () => {
    mockDetectSuccess(JSON.stringify([{ path: '/v.md', score: 0.7, snippet: 'vector result' }]));
    const r = vsearch('test', 5);
    expect(r).not.toBeNull();
    expect(r).toHaveLength(1);
    expect(r?.[0]?.filePath).toBe('/v.md');
  });

  it('uses default maxResults of 5', () => {
    mockDetectSuccess();
    vsearch('q');

    expect(mockExec).toHaveBeenCalledWith(
      'qmd',
      ['vsearch', 'q', '--json', '--limit', '5'],
      expect.objectContaining({ encoding: 'utf-8', stdio: 'pipe', timeout: 60_000 }),
    );
  });
});

// ===========================================================================
//  query
// ===========================================================================
describe('query', () => {
  beforeEach(sharedBefore);
  afterEach(sharedAfter);

  it('calls run with correct args and 60s timeout', () => {
    mockDetectSuccess();
    query('hybrid query', 7);

    expect(mockExec).toHaveBeenCalledWith(
      'qmd',
      ['query', 'hybrid query', '--json', '--limit', '7'],
      expect.objectContaining({ encoding: 'utf-8', stdio: 'pipe', timeout: 60_000 }),
    );
  });

  it('returns null when not detected', () => {
    expect(query('test', 5)).toBeNull();
  });

  it('returns parsed results when detected', () => {
    mockDetectSuccess(JSON.stringify([{ path: '/h.md', score: 0.6, snippet: 'hybrid result' }]));
    const r = query('test', 5);
    expect(r).not.toBeNull();
    expect(r).toHaveLength(1);
    expect(r?.[0]?.filePath).toBe('/h.md');
  });

  it('uses default maxResults of 5', () => {
    mockDetectSuccess();
    query('q');

    expect(mockExec).toHaveBeenCalledWith(
      'qmd',
      ['query', 'q', '--json', '--limit', '5'],
      expect.objectContaining({ encoding: 'utf-8', stdio: 'pipe', timeout: 60_000 }),
    );
  });
});
