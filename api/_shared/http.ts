// HTTP response helpers
// Safe redirect that works across different Node.js-like runtimes

/**
 * Safely redirect to a URL, trying multiple methods to ensure compatibility
 * @param res - Response object (VercelResponse or similar)
 * @param to - Target URL to redirect to
 */
export function safeRedirect(res: any, to: string): void {
  // 1) Try writeHead + end (Node style)
  try {
    if (typeof res.writeHead === 'function') {
      res.writeHead(302, { Location: to })
      if (typeof res.end === 'function') res.end()
      return
    }
  } catch {}

  // 2) Try non-chained statusCode + setHeader + end
  try {
    if (typeof res.setHeader === 'function') {
      res.statusCode = 302
      res.setHeader('Location', to)
      if (typeof res.end === 'function') res.end()
      return
    }
  } catch {}

  // 3) Fallback to tiny HTML redirect (works in almost any runtime)
  const html = `<!doctype html><meta http-equiv="refresh" content="0;url=${to}"><a href="${to}">Continue</a>`
  try {
    if (typeof res.status === 'function' && typeof res.send === 'function') {
      res.status(200).send(html)
      return
    }
  } catch {}
  try {
    if (typeof res.setHeader === 'function') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (typeof res.end === 'function') {
        res.end(html)
        return
      }
    }
  } catch {}

  // 4) Absolute last resort: JSON the redirect, so we at least don't 500
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(200).json({ ok: true, redirectUrl: to })
    return
  }
}
