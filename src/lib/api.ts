// src/lib/api.ts
import { getClientSessionId } from './session';

export async function apiFetch(input: string, init: RequestInit = {}) {
  const sessionId = getClientSessionId();
  const headers = new Headers(init.headers || {});
  if (!headers.has('X-Session-Id')) headers.set('X-Session-Id', sessionId);
  if (!headers.has('content-type') && init.body && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }

  const res = await fetch(input, {
    ...init,
    credentials: 'include',
    headers,
  });

  return res;
}

export interface WhoAmIResponse {
  userId: string
  displayName: string
  ephemeral: boolean
  kind: 'human' | 'agent'
  banned: boolean
  createdAt: string
  sessionId?: string // Only present when DEBUG_AUTH=1
}

export async function getWhoAmI(): Promise<WhoAmIResponse> {
  const response = await apiFetch('/api/session/whoami', {
    method: 'GET'
  })

  if (!response.ok) {
    throw new Error(`Failed to get identity: ${response.status}`)
  }

  return response.json()
}
