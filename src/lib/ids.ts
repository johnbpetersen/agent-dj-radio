/**
 * Safely shortens an ID for logging/debugging purposes.
 *
 * Handles non-string values gracefully by converting to string first.
 * Never use this for security-sensitive comparisons - only for display.
 *
 * @param x - Any value (typically a session ID, user ID, etc.)
 * @param n - Number of characters to keep (default 8). If negative, takes from end.
 * @returns Shortened string safe for logging
 *
 * @example
 * shortId('abc123-def456-ghi789', 8) // 'abc123-d' (first 8)
 * shortId('abc123-def456-ghi789', -6) // 'hi789' (last 6)
 * shortId(null, 8) // ''
 * shortId(undefined, 8) // ''
 * shortId({ id: '123' }, 8) // '[object ' (object stringified)
 */
export function shortId(x: unknown, n = 8): string {
  const s = typeof x === 'string' ? x : String(x ?? '')
  return s.slice(n < 0 ? n : 0, n < 0 ? undefined : n)
}
