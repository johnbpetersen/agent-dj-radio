#!/usr/bin/env tsx
/**
 * dev-functions-server.ts
 * Runs your Vercel-style API functions locally on http://localhost:3001
 * Uses your real Supabase env from .env. No mocks, no Vercel CLI.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { parse as parseUrl } from 'url'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'

const PORT = 3001
const API_DIR = resolve('./api')

type Handler = (req: any, res: any) => Promise<void> | void

function log(...args: any[]) {
  console.log('[api]', ...args)
}

async function loadFunctionForPath(pathname: string): Promise<Handler | null> {
  // Map /api/foo/bar -> api/foo/bar.(ts|js) or api/foo/bar/index.(ts|js)
  const route = pathname.replace(/^\/api\/?/, '')
  if (!route) return null

  const candidates = [
    join(API_DIR, `${route}.ts`),
    join(API_DIR, `${route}/index.ts`),
    join(API_DIR, `${route}.js`),
    join(API_DIR, `${route}/index.js`)
  ]

  for (const abs of candidates) {
    try {
      const url = pathToFileURL(abs).href
      const mod = await import(url)
      const fn: Handler | undefined = mod.default
      if (typeof fn === 'function') return fn
    } catch {
      // try next candidate
    }
  }
  return null
}

function makeReqRes(req: IncomingMessage, res: ServerResponse) {
  const { pathname, query } = parseUrl(req.url || '', true)

  // ---- REQUEST SHIM ----
  const vReq: any = req
  vReq.query = query
  vReq.cookies = {} // add cookie parsing if needed

  // ---- RESPONSE SHIM (do NOT mutate res; keep originals bound) ----
  const rawSetHeader = res.setHeader.bind(res)
  const rawEnd = res.end.bind(res)
  const vRes: any = {
    status(code: number) {
      res.statusCode = code
      return vRes
    },
    setHeader(name: string, value: any) {
      rawSetHeader(name, value)
      return vRes
    },
    json(data: any) {
      if (!res.getHeader('Content-Type')) {
        rawSetHeader('Content-Type', 'application/json')
      }
      rawEnd(JSON.stringify(data))
    },
    send(data: any) {
      if (typeof data === 'object' && !Buffer.isBuffer(data)) {
        if (!res.getHeader('Content-Type')) {
          rawSetHeader('Content-Type', 'application/json')
        }
        rawEnd(JSON.stringify(data))
      } else {
        rawEnd(data)
      }
    },
    get headersSent() {
      return res.headersSent
    }
  }

  return { pathname, vReq, vRes }
}

function sendCORS(res: ServerResponse, origin?: string) {
  if (origin && origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin')
  res.setHeader('Access-Control-Max-Age', '86400')
}

const server = createServer(async (req, res) => {
  const { pathname } = parseUrl(req.url || '', true)
  sendCORS(res, req.headers.origin as string | undefined)

  if (req.method === 'OPTIONS') {
    res.statusCode = 200
    return res.end()
  }

  if (!pathname?.startsWith('/api/')) {
    res.statusCode = 404
    return res.end('Not Found')
  }

  // Buffer JSON body if present
  const chunks: Buffer[] = []
  req.on('data', c => chunks.push(c))
  req.on('end', async () => {
    const bodyStr = Buffer.concat(chunks).toString('utf8')
    const ctype = (req.headers['content-type'] || '') as string
    let body: any = bodyStr
    if (bodyStr && ctype.includes('application/json')) {
      try { body = JSON.parse(bodyStr) } catch {}
    }
    ;(req as any).body = body

    try {
      const fn = await loadFunctionForPath(pathname)
      if (!fn) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify({ error: 'API endpoint not found' }))
      }

      const { vReq, vRes } = makeReqRes(req, res)
      log(req.method, pathname)
      await Promise.resolve(fn(vReq, vRes))
    } catch (err: any) {
      console.error('[api] handler error:', err)
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Internal server error', message: err?.message }))
    }
  })
})

server.listen(PORT, () => {
  console.log(`🚀 Functions DEV server on http://localhost:${PORT}`)
  console.log(`🔗 All /api/* routes are served from your local ./api directory`)
})