// src/lib/session.ts

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(x: string | null | undefined): x is string {
  return !!x && UUID_RE.test(x);
}

function makeUuidV4(): string {
  // RFC4122 v4
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = Array.from(b, n => n.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let cached: string | null = null;

export function getClientSessionId(): string {
  if (cached) return cached;

  const NEW_KEY = 'x402_client_session_uuid';
  const OLD_KEY = 'x402_client_session_id';

  try {
    // Prefer the new key, but migrate the old one if it happens to be a UUID already
    const existingNew = localStorage.getItem(NEW_KEY);
    if (isUuid(existingNew)) {
      cached = existingNew!;
      return cached;
    }

    const existingOld = localStorage.getItem(OLD_KEY);
    if (isUuid(existingOld)) {
      localStorage.setItem(NEW_KEY, existingOld!);
      localStorage.removeItem(OLD_KEY);
      cached = existingOld!;
      return cached;
    }

    // Generate a fresh UUID v4
    const id = (crypto as any).randomUUID?.() ?? makeUuidV4();
    localStorage.setItem(NEW_KEY, id);
    localStorage.removeItem(OLD_KEY); // clear old hex id if present
    cached = id;
    return id;
  } catch {
    // No localStorage? Generate per-tab UUID
    cached = (crypto as any).randomUUID?.() ?? makeUuidV4();
    return cached;
  }
}
