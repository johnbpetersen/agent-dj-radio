// api/_shared/http.ts

import { logger } from '../../src/lib/logger.js'

function htmlEscape(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

interface SafeRedirectOptions {
  force302?: boolean // If true, prioritize 302 over HTML
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeRedirect(res: any, to: string, options: SafeRedirectOptions = {}) {
  const { force302 = true } = options // Default to 302 for OAuth flows

  // Strategy 1: Pure 302 redirect (preferred for OAuth)
  if (force302) {
    // Try Vercel/Express style first: status().setHeader().end()
    try {
      if (typeof res.status === 'function' && typeof res.setHeader === 'function' && typeof res.end === 'function') {
        logger.debug('safeRedirect: 302 via status().setHeader().end()', { to })
        res.status(302)
        res.setHeader('Location', to)
        return res.end()
      }
    } catch (e) {
      logger.warn('safeRedirect: status().setHeader().end() failed', { error: String(e) })
    }

    // Try writeHead (Node.js standard)
    try {
      if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
        logger.debug('safeRedirect: 302 via writeHead', { to })
        res.writeHead(302, { Location: to })
        return res.end()
      }
    } catch (e) {
      logger.warn('safeRedirect: writeHead(302) failed', { error: String(e) })
    }

    // Try statusCode + setHeader (alternative Node.js style)
    try {
      if (typeof res.setHeader === 'function' && typeof res.end === 'function') {
        logger.debug('safeRedirect: 302 via statusCode + setHeader', { to })
        res.statusCode = 302
        res.setHeader('Location', to)
        return res.end()
      }
    } catch (e) {
      logger.warn('safeRedirect: setHeader(302) failed', { error: String(e) })
    }

    // Try status().redirect() (Express-style)
    try {
      if (typeof res.redirect === 'function') {
        logger.debug('safeRedirect: 302 via res.redirect', { to })
        return res.redirect(302, to)
      }
    } catch (e) {
      logger.warn('safeRedirect: res.redirect(302) failed', { error: String(e) })
    }
  }

  // Strategy 2: HTML interstitial (fallback or when force302=false)
  const escaped = htmlEscape(to);
  const html = `<!doctype html>
<title>Redirecting…</title>
<meta http-equiv="refresh" content="0;url=${escaped}">
<p>Redirecting to <a href="${escaped}">${escaped}</a>…</p>
<script>
  try {
    window.location.replace(${JSON.stringify(to)});
  } catch (e) {
    window.location.href = ${JSON.stringify(to)};
  }
</script>`;

  // Try status().send() (Express/Vercel style)
  try {
    if (typeof res.status === 'function' && typeof res.send === 'function') {
      logger.debug('safeRedirect: HTML via res.status().send()', { to })
      return res.status(200).send(html)
    }
  } catch (e) {
    logger.warn('safeRedirect: status().send HTML failed', { error: String(e) })
  }

  // Try setHeader + end (Node.js http style)
  try {
    if (typeof res.setHeader === 'function' && typeof res.end === 'function') {
      logger.debug('safeRedirect: HTML via setHeader+end', { to })
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.end(html)
    }
  } catch (e) {
    logger.warn('safeRedirect: setHeader+end HTML failed', { error: String(e) })
  }

  // Last resort: JSON (client can handle)
  try {
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      logger.warn('safeRedirect: falling back to JSON response', { to })
      return res.status(200).json({ ok: true, redirectUrl: to })
    }
  } catch (e) {
    logger.error('safeRedirect: JSON fallback failed', { error: String(e) })
  }

  logger.error('safeRedirect: all strategies failed; response may hang', { to })
}
