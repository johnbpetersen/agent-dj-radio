// api/_shared/payments/facilitator/transport.ts
// HTTP transport for facilitator API calls
// Handles timeouts, headers, and network errors

/**
 * HTTP POST to facilitator endpoint with timeout and standard headers
 *
 * @param url - Full URL to POST to (including path)
 * @param payload - JSON payload to send
 * @param timeoutMs - Request timeout in milliseconds (default 10s)
 * @returns Response object
 * @throws Error on network failure or timeout
 */
export async function postToFacilitator(
  url: string,
  payload: Record<string, any>,
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'accept': 'application/json',
        'user-agent': 'agent-dj-radio/1.0 (+x402)'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    clearTimeout(timeout)
    return response
  } catch (error: any) {
    clearTimeout(timeout)

    // Map network errors to user-friendly messages
    if (error.name === 'AbortError') {
      throw new Error(`Facilitator request timeout after ${timeoutMs}ms`)
    }

    if (error.message?.includes('fetch failed')) {
      throw new Error(`Facilitator network error: ${error.message}`)
    }

    throw error
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
