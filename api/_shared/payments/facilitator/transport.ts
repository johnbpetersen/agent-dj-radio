// api/_shared/payments/facilitator/transport.ts
// HTTP transport for facilitator API calls
// Handles timeouts, headers, and network errors

/**
 * Structured result from facilitator HTTP call
 */
export interface FacilitatorHttpResult {
  ok: boolean
  status?: number
  text: string
  error?: string
  durationMs: number
}

/**
 * HTTP POST to facilitator endpoint with timeout and standard headers
 * Always returns a structured result, never throws
 *
 * @param url - Full URL to POST to (including path)
 * @param payload - JSON payload to send
 * @param timeoutMs - Request timeout in milliseconds (default 10s)
 * @returns Structured result with status, text, and timing
 */
export async function postToFacilitator(
  url: string,
  payload: Record<string, any>,
  timeoutMs = 10000
): Promise<FacilitatorHttpResult> {
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'accept': 'application/json',
        'user-agent': 'agent-dj-radio/1.0 (+x402)'
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'follow' // Follow redirects (e.g., x402.org -> www.x402.org)
    })

    clearTimeout(timeout)

    // Read response text (always safe)
    const text = await res.text()

    return {
      ok: res.ok,
      status: res.status,
      text,
      durationMs: Date.now() - started
    }
  } catch (error: any) {
    clearTimeout(timeout)

    // Map errors to structured result (no throw)
    let errorMessage = error?.message ?? String(error)

    if (error.name === 'AbortError') {
      errorMessage = `Request timeout after ${timeoutMs}ms`
    } else if (error.message?.includes('fetch failed')) {
      errorMessage = `Network error: ${error.message}`
    }

    return {
      ok: false,
      status: undefined,
      text: '',
      error: errorMessage,
      durationMs: Date.now() - started
    }
  }
}

/**
 * Join base URL with path safely (handles trailing slashes)
 *
 * @param base - Base URL (e.g., "https://x402.org/facilitator")
 * @param path - Path to append (e.g., "verify" or "/verify")
 * @returns Full URL
 */
export function joinUrl(base: string, path: string): string {
  const baseUrl = new URL(base)

  // Ensure base pathname ends with /
  if (!baseUrl.pathname.endsWith('/')) {
    baseUrl.pathname += '/'
  }

  // Remove leading / from path
  const relativePath = path.replace(/^\//, '')

  // Resolve relative path
  const result = new URL(relativePath, baseUrl)
  return result.toString()
}
