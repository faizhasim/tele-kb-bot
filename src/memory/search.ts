/**
 * Pure-TypeScript BM25 search for tele-kb-bot.
 *
 * Zero external dependencies. Tokenizes by whitespace + punctuation.
 * Returns ranked results with score, file path, and snippet.
 *
 * @module
 */

import type { SearchResult } from './types';

// ─── BM25 Constants ─────────────────────────────────────────────────

const K1 = 1.5; // term saturation
const B = 0.75; // length normalization

interface InternalDoc {
  readonly path: string;
  readonly content: string;
  readonly tokenCounts: Map<string, number>;
  readonly length: number;
}

interface IndexState {
  readonly docs: ReadonlyArray<InternalDoc>;
  readonly avgDocLen: number;
  readonly docCount: number;
}

// ─── Tokenizer ──────────────────────────────────────────────────────

const TOKENIZE_RE = /[^a-zA-Z0-9_-]+/;

const tokenize = (text: string): Array<string> =>
  text
    .toLowerCase()
    .split(TOKENIZE_RE)
    .filter((t) => t.length > 0);

// ─── IDF ────────────────────────────────────────────────────────────

const idf = (term: string, state: IndexState): number => {
  let df = 0;
  for (const doc of state.docs) {
    if (doc.tokenCounts.has(term)) df++;
  }
  if (df === 0) return 0;
  return Math.log((state.docCount - df + 0.5) / (df + 0.5) + 1);
};

// ─── BM25 Score ─────────────────────────────────────────────────────

const scoreDoc = (doc: InternalDoc, queryTokens: Array<string>, state: IndexState): number => {
  let score = 0;
  for (const term of queryTokens) {
    const tf = doc.tokenCounts.get(term) ?? 0;
    if (tf === 0) continue;
    const idfVal = idf(term, state);
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + (B * doc.length) / state.avgDocLen);
    score += idfVal * (numerator / denominator);
  }
  return score;
};

// ─── Snippet ────────────────────────────────────────────────────────

const CONTEXT_CHARS = 80;

const snippet = (content: string, query: string): string => {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return content.substring(0, CONTEXT_CHARS * 2);
  const start = Math.max(0, idx - CONTEXT_CHARS);
  const end = Math.min(content.length, idx + query.length + CONTEXT_CHARS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return prefix + content.substring(start, end).replace(/\n/g, ' ').trim() + suffix;
};

// ─── Index ──────────────────────────────────────────────────────────

/**
 * Build an in-memory BM25 index from documents.
 */
const indexDocuments = (docs: Array<{ readonly path: string; readonly content: string }>): IndexState => {
  const indexed: Array<InternalDoc> = docs.map((d) => {
    const tokens = tokenize(d.content);
    const tokenMap = new Map<string, number>();
    for (const t of tokens) {
      tokenMap.set(t, (tokenMap.get(t) ?? 0) + 1);
    }
    return {
      path: d.path,
      content: d.content,
      tokenCounts: tokenMap,
      length: tokens.length,
    };
  });

  const totalLen = indexed.reduce((sum, d) => sum + d.length, 0);
  const avgDocLen = indexed.length > 0 ? totalLen / indexed.length : 1;

  return { docs: indexed, avgDocLen, docCount: indexed.length };
};

/**
 * Search the index for a query.
 * Returns top N results ranked by BM25 score.
 */
const search = (state: IndexState, query: string, maxResults = 5): ReadonlyArray<SearchResult> => {
  if (state.docs.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored = state.docs.map((doc) => ({
    doc,
    score: scoreDoc(doc, queryTokens, state),
  }));

  const nonZero = scored.filter((s) => s.score > 0);
  nonZero.sort((a, b) => b.score - a.score);

  return nonZero.slice(0, maxResults).map(({ doc, score }) => ({
    filePath: doc.path,
    score: Math.round(score * 100) / 100,
    snippet: snippet(doc.content, query),
  }));
};

export type { IndexState };
export { indexDocuments, search, tokenize };
