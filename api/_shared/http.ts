// api/_shared/http.ts

function htmlEscape(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeRedirect(res: any, to: string) {
  const escaped = htmlEscape(to);
  const html = `<!doctype html>
<title>Redirecting…</title>
<meta http-equiv="refresh" content="0;url=${escaped}">
<p>Redirecting to <a href="${escaped}">${escaped}</a>…</p>
<script>
  try {
    // Prefer replace() so back button doesn't land on the callback.
    window.location.replace(${JSON.stringify(to)});
  } catch (e) {
    window.location.href = ${JSON.stringify(to)};
  }
</script>`;

  // ✅ Preferred in this dev runtime: express-style status().send(HTML)
  try {
    if (typeof res.status === 'function' && typeof res.send === 'function') {
      console.log('[safeRedirect] HTML via res.status().send to', to);
      return res.status(200).send(html);
    }
  } catch (e) {
    console.warn('[safeRedirect] status().send HTML failed', e);
  }

  // Fallback: set header + end (node http style)
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

  // Fallback: 302 writeHead
  try {
    if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
      console.log('[safeRedirect] writeHead(302) to', to);
      res.writeHead(302, { Location: to });
      return res.end();
    }
  } catch (e) {
    console.warn('[safeRedirect] writeHead(302) failed', e);
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
