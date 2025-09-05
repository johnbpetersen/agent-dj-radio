export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  const u = new URL(req.url)
  const target = u.searchParams.get('url')
  
  if (!target) {
    return new Response('Missing url parameter', { status: 400 })
  }

  try {
    // Forward the range header if present
    const range = req.headers.get('range') ?? undefined
    const headers: Record<string, string> = {}
    
    if (range) {
      headers.range = range
    }

    console.log(`🎵 Proxying audio request: ${target}${range ? ` (Range: ${range})` : ''}`)

    // Fetch from upstream
    const upstream = await fetch(target, {
      headers,
      cache: 'no-store', // Don't cache to ensure fresh range requests
    })

    // Mirror headers and add permissive CORS
    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.set('access-control-allow-origin', '*')
    responseHeaders.set('access-control-allow-methods', 'GET, HEAD, OPTIONS')
    responseHeaders.set('access-control-allow-headers', 'Range')

    console.log(`🎵 Upstream response: ${upstream.status} ${upstream.statusText}`)

    return new Response(upstream.body, { 
      status: upstream.status, 
      statusText: upstream.statusText,
      headers: responseHeaders 
    })

  } catch (error) {
    console.error('🎵 Audio proxy error:', error)
    return new Response(`Proxy error: ${error instanceof Error ? error.message : 'Unknown error'}`, { 
      status: 500 
    })
  }
}