/**
 * Human-readable size parsing and formatting utilities.
 *
 * Converts between strings like "500MB" and raw byte counts.
 * Supports B, KB, MB, GB, TB (case-insensitive, powers of 1024).
 *
 * @module
 */

const UNITS: ReadonlyArray<{ suffix: string; multiplier: number }> = [
  { suffix: 'TB', multiplier: 1024 ** 4 },
  { suffix: 'GB', multiplier: 1024 ** 3 },
  { suffix: 'MB', multiplier: 1024 ** 2 },
  { suffix: 'KB', multiplier: 1024 },
  { suffix: 'B', multiplier: 1 },
];

const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB|B)?$/i;

/**
 * Parse a human-readable size string into bytes.
 *
 * @param input - e.g. "500MB", "2GB", "1500KB", "1TB", "512" (bytes)
 * @returns byte count, or null if the format is invalid
 *
 * @example
 * parseSize('500MB')  // => 524288000
 * parseSize('2GB')    // => 2147483648
 * parseSize('128')    // => 128
 * parseSize('xyz')    // => null
 */
const parseSize = (input: string): number | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(SIZE_RE);
  if (!match) return null;

  const value = Number.parseFloat(match[1]!);
  if (!Number.isFinite(value) || value < 0) return null;

  const suffix = (match[2] ?? 'B').toUpperCase();
  const unit = UNITS.find((u) => u.suffix === suffix);
  if (!unit) return null;

  return Math.round(value * unit.multiplier);
};

/**
 * Format a byte count into the largest human-readable unit.
 *
 * @param bytes - Number of bytes
 * @param decimals - Decimal places (default: 1 for fractional, 0 for whole)
 * @returns Formatted string, e.g. "500 MB", "2 GB"
 *
 * @example
 * formatSize(524288000)   // => "500 MB"
 * formatSize(2147483648)  // => "2 GB"
 * formatSize(128)         // => "128 B"
 */
const formatSize = (bytes: number): string => {
  if (bytes <= 0) return '0 B';

  // Find the largest unit that keeps the value >= 1
  const unit = UNITS.find((u) => bytes >= u.multiplier) ?? (UNITS[UNITS.length - 1] as unknown as (typeof UNITS)[0]);
  const value = bytes / unit.multiplier;
  const decimals = value % 1 === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${unit.suffix}`;
};

export { formatSize, parseSize };
