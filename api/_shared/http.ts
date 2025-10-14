// api/_shared/http.ts

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

export function safeRedirect(res: any, to: string, options: SafeRedirectOptions = {}) {
  const { force302 = true } = options // Default to 302 for OAuth flows

  // Strategy 1: Pure 302 redirect (preferred for OAuth)
  if (force302) {
    // Try writeHead first (Node.js standard)
    try {
      if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
        console.log('[safeRedirect] 302 via writeHead to', to);
        res.writeHead(302, { Location: to });
        return res.end();
      }
    } catch (e) {
      console.warn('[safeRedirect] writeHead(302) failed', e);
    }

    // Try statusCode + setHeader (alternative Node.js style)
    try {
      if (typeof res.setHeader === 'function' && typeof res.end === 'function') {
        console.log('[safeRedirect] 302 via setHeader to', to);
        res.statusCode = 302;
        res.setHeader('Location', to);
        return res.end();
      }
    } catch (e) {
      console.warn('[safeRedirect] setHeader(302) failed', e);
    }

    // Try status().redirect() (Express-style)
    try {
      if (typeof res.redirect === 'function') {
        console.log('[safeRedirect] 302 via res.redirect to', to);
        return res.redirect(302, to);
      }
    } catch (e) {
      console.warn('[safeRedirect] res.redirect(302) failed', e);
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
      console.log('[safeRedirect] HTML via res.status().send to', to);
      return res.status(200).send(html);
    }
  } catch (e) {
    console.warn('[safeRedirect] status().send HTML failed', e);
  }

  // Try setHeader + end (Node.js http style)
  try {
    if (typeof res.setHeader === 'function' && typeof res.end === 'function') {
      console.log('[safeRedirect] HTML via setHeader+end to', to);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }
  } catch (e) {
    console.warn('[safeRedirect] setHeader+end HTML failed', e);
  }

  // Last resort: JSON (client can handle)
  try {
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      console.log('[safeRedirect] JSON fallback to', to);
      return res.status(200).json({ ok: true, redirectUrl: to });
    }
  } catch (e) {
    console.warn('[safeRedirect] JSON fallback failed', e);
  }

  console.warn('[safeRedirect] all strategies failed; response may hang');
}
