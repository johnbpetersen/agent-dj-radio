#!/usr/bin/env tsx
/**
 * dev-functions-server.ts
 * Runs your Vercel-style API functions locally on http://localhost:3001
 * Uses your real Supabase env from .env. No mocks, no Vercel CLI.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { parse as parseUrl } from 'url'
import { join, resolve } from 'path'
import { createErrorResponse } from './api/_shared/errors.js'
import { pathToFileURL } from 'url'
import crypto from 'crypto'
import fs from 'fs'
import { glob } from 'glob'
import { serverEnv } from './src/config/env.js'
import { secureHandler, securityConfigs } from './api/_shared/secure-handler.js'

const PORT = 3001
const API_DIR = resolve('./api')
const IS_DEV = serverEnv.STAGE === 'dev'
const IS_DEBUG = serverEnv.LOG_LEVEL === 'debug'

type Handler = (req: any, res: any) => Promise<void> | void

interface RouteEntry {
  path: string
  file: string
  hasHandler: boolean
  exportType: 'default' | 'named' | 'none'
  handler?: Handler
}

const routeRegistry = new Map<string, RouteEntry>()

function log(...args: any[]) {
  console.log('[api]', ...args)
}

function debugLog(...args: any[]) {
  if (IS_DEBUG) {
    console.log('[api]', ...args)
  }
}

// Resolve handler from module with fallback patterns
function resolveHandler(mod: any): { handler: Handler | null; exportType: 'default' | 'named' | 'none' } {
  // Try default export first
  if (typeof mod.default === 'function') {
    return { handler: mod.default, exportType: 'default' }
  }

  // Try named exports
  if (typeof mod.handler === 'function') {
    return { handler: mod.handler, exportType: 'named' }
  }

  if (typeof mod.HANDLER === 'function') {
    return { handler: mod.HANDLER, exportType: 'named' }
  }

  return { handler: null, exportType: 'none' }
}

// Normalize path: api/foo.ts -> /api/foo, api/foo/index.ts -> /api/foo
function normalizeRoutePath(filePath: string): string {
  let route = filePath
    .replace(/\\/g, '/') // normalize windows paths
    .replace(/^api\//, '') // remove api/ prefix
    .replace(/\.(ts|js)$/, '') // remove extension
    .replace(/\/index$/, '') // api/foo/index -> api/foo

  // Ensure leading slash and no trailing slash
  route = '/' + route.replace(/^\/+/, '').replace(/\/+$/, '')

  // Collapse duplicate slashes
  route = route.replace(/\/+/g, '/')

  return `/api${route === '/' ? '' : route}`
}

// Discover all API route files
async function discoverRoutes(): Promise<void> {
  console.log('🔍 Discovering API routes...')

  try {
    // Find all .ts and .js files in api directory
    const files = await glob('api/**/*.{ts,js}', {
      ignore: [
        'api/_shared/**',
        'api/_dev/**', // We'll register _dev/routes explicitly
        '**/*.d.ts',
        '**/*.test.ts',
        '**/__mocks__/**'
      ]
    })

    const entries: RouteEntry[] = []

    for (const file of files) {
      try {
        const normalizedPath = normalizeRoutePath(file)
        const absolutePath = resolve(file)
        const url = pathToFileURL(absolutePath).href

        // Import module and resolve handler
        const mod = await import(url)
        const { handler, exportType } = resolveHandler(mod)

        const entry: RouteEntry = {
          path: normalizedPath,
          file,
          hasHandler: !!handler,
          exportType,
          handler: handler || undefined
        }

        entries.push(entry)
        routeRegistry.set(normalizedPath, entry)

        if (!handler) {
          console.warn(`⚠️  No handler found in ${file} (checked: default, handler, HANDLER)`)
        }

      } catch (error) {
        console.warn(`⚠️  Failed to load ${file}:`, error instanceof Error ? error.message : String(error))
      }
    }

    // Register _dev/routes endpoint explicitly (dev-only)
    if (IS_DEV) {
      const devRoutesEntry: RouteEntry = {
        path: '/api/_dev/routes',
        file: '_dev/routes (internal)',
        hasHandler: true,
        exportType: 'default',
        handler: devRoutesHandler
      }
      entries.push(devRoutesEntry)
      routeRegistry.set('/api/_dev/routes', devRoutesEntry)
    }

    // Log startup table (dev only)
    if (IS_DEV && entries.length > 0) {
      console.log('\n📋 Registered API Routes:')
      console.log('┌─────────────────────────────────────┬──────────────┬─────────────┐')
      console.log('│ Path                                │ Export Type  │ Handler     │')
      console.log('├─────────────────────────────────────┼──────────────┼─────────────┤')

      entries
        .sort((a, b) => a.path.localeCompare(b.path))
        .forEach(entry => {
          const path = entry.path.padEnd(35)
          const exportType = entry.exportType.padEnd(12)
          const hasHandler = entry.hasHandler ? '✅' : '❌'
          console.log(`│ ${path} │ ${exportType} │ ${hasHandler}           │`)
        })

      console.log('└─────────────────────────────────────┴──────────────┴─────────────┘')
      console.log(`\n📊 Total routes: ${entries.length} (${entries.filter(e => e.hasHandler).length} with handlers)\n`)
    }

  } catch (error) {
    console.error('❌ Route discovery failed:', error)
  }
}

// Dev-only introspection handler
async function devRoutesHandler(req: any, res: any): Promise<void> {
  if (!IS_DEV) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const routes = Array.from(routeRegistry.values())
    .map(entry => ({
      path: entry.path,
      file: entry.file,
      hasHandler: entry.hasHandler,
      exportType: entry.exportType
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  res.status(200).json({ routes })
}

// Wrap dev routes handler with secureHandler for consistent error handling
const secureDevRoutesHandler = secureHandler(devRoutesHandler, securityConfigs.public)

async function loadFunctionForPath(pathname: string): Promise<Handler | null> {
  // Check registry first for exact match
  const entry = routeRegistry.get(pathname)
  if (entry?.handler) {
    return entry.handler
  }

  // Check for catch-all handler ([...all].ts)
  const catchAllEntry = routeRegistry.get('/api/[...all]')
  if (catchAllEntry?.handler) {
    return catchAllEntry.handler
  }

  // Fallback to original discovery for dynamic routes or missed patterns
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
      const { handler } = resolveHandler(mod)
      if (handler) return handler
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
  const rawGetHeader = res.getHeader.bind(res)
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
    getHeader(name: string) {
      return rawGetHeader(name)
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
        const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID()
        const errorResponse = createErrorResponse(
          new Error('API endpoint not found'),
          requestId,
          { route: pathname, method: req.method || 'UNKNOWN', path: pathname }
        )
        res.statusCode = errorResponse.status
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('X-Request-Id', requestId)
        return res.end(JSON.stringify(errorResponse.body))
      }

      const { vReq, vRes } = makeReqRes(req, res)
      debugLog(req.method, pathname)
      await Promise.resolve(fn(vReq, vRes))
    } catch (err: any) {
      console.error('[api] handler error:', err)
      const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID()
      const errorResponse = createErrorResponse(
        err,
        requestId,
        { route: pathname, method: req.method || 'UNKNOWN', path: pathname }
      )
      res.statusCode = errorResponse.status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('X-Request-Id', requestId)
      res.end(JSON.stringify(errorResponse.body))
    }
  })
})

server.listen(PORT, async () => {
  console.log(`🚀 Functions DEV server on http://localhost:${PORT}`)
  console.log(`🔗 All /api/* routes are served from your local ./api directory`)

  // Discover routes on startup
  await discoverRoutes()

  if (IS_DEV) {
    console.log(`🔍 Route introspection available at http://localhost:${PORT}/api/_dev/routes`)
  }
})