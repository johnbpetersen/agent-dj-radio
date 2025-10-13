// HTTP response helpers
// Safe redirect that works across different Node.js-like runtimes

/**
 * HTML-escape a string for safe use in HTML attributes and content
 */
function htmlEscape(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Safely redirect to a URL, trying multiple methods to ensure compatibility
 * Prefers HTML+JS redirect (200) over 302 for better compatibility with OAuth flows
 * @param res - Response object (VercelResponse or similar)
 * @param to - Target URL to redirect to
 */
export function safeRedirect(res: any, to: string): void {
  try {
    // Preferred in this dev runtime: force a 200 HTML with JS redirect.
    const escaped = htmlEscape(to)
    const html = `<!doctype html>
<title>Redirecting…</title>
<meta http-equiv="refresh" content="0;url=${escaped}">
<p>Redirecting to <a href="${escaped}">${escaped}</a>…</p>
<script>
  try {
    // Use replace so back button doesn't return to the OAuth callback.
    window.location.replace(${JSON.stringify(to)});
  } catch (e) {
    window.location.href = ${JSON.stringify(to)};
  }
</script>`

    if (typeof res.setHeader === 'function') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (typeof res.end === 'function') {
        console.log('[safeRedirect] sent HTML redirect 200 to', to)
        return res.end(html)
      }
    }
  } catch (e) {
    console.warn('[safeRedirect] HTML redirect failed, will try alternatives', e)
  }

  // Fallback 1: Node-style 302
  try {
    if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
      console.log('[safeRedirect] fallback writeHead(302) to', to)
      res.writeHead(302, { Location: to })
      return res.end()
    }
  } catch (e) {
    console.warn('[safeRedirect] writeHead fallback failed', e)
  }

  // Fallback 2: Non-chained header set
  try {
    if (typeof res.setHeader === 'function' && typeof res.end === 'function') {
      console.log('[safeRedirect] fallback setHeader(302) to', to)
      res.statusCode = 302
      res.setHeader('Location', to)
      return res.end()
    }
  } catch (e) {
    console.warn('[safeRedirect] setHeader fallback failed', e)
  }

  // Final fallback: JSON so the client can decide what to do.
  try {
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      console.log('[safeRedirect] final JSON fallback to', to)
      return res.status(200).json({ ok: true, redirectUrl: to })
    }
  } catch (e) {
    console.warn('[safeRedirect] JSON fallback failed', e)
  }

  // Absolute last resort: do nothing (avoid throwing).
  console.warn('[safeRedirect] all strategies failed; response may hang')
}
