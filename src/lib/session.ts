// src/lib/session.ts
let cachedId: string | null = null;

function genId() {
  // 128-bit random in hex; stable enough for a browser session id
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function getClientSessionId(): string {
  if (cachedId) return cachedId;
  try {
    const k = 'x402_client_session_id';
    const existing = localStorage.getItem(k);
    if (existing && existing.length > 0) {
      cachedId = existing;
      return cachedId;
    }
    const id = genId();
    localStorage.setItem(k, id);
    cachedId = id;
    return id;
  } catch {
    // no localStorage? fallback per-tab
    cachedId = genId();
    return cachedId;
  }
}
