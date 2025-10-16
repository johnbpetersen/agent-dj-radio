// Minimal zero-dependency router for catch-all API function
// Supports dynamic params like /users/:id/avatar

import type { VercelRequest, VercelResponse } from '@vercel/node'

export interface RouteMatch {
  params: Record<string, string>
}

export type RouteHandler = (req: VercelRequest, res: VercelResponse) => Promise<void>

export interface Route {
  method: string
  pattern: string
  handler: RouteHandler
}

/**
 * Convert a route pattern to a regex and extract param names
 * Example: "/users/:id/avatar" -> { regex: /^\/users\/([^/]+)\/avatar$/, params: ['id'] }
 */
function patternToRegex(pattern: string): { regex: RegExp; params: string[] } {
  const params: string[] = []

  // Escape special regex chars except :param
  const regexStr = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, paramName) => {
      params.push(paramName)
      return '([^/]+)' // Match anything except /
    })

  return {
    regex: new RegExp(`^${regexStr}$`),
    params
  }
}

/**
 * Normalize path: strip leading /api, normalize trailing slash
 * - Strips only ONE leading /api prefix (avoid double-stripping)
 * - Removes trailing slash (except for root /)
 * - Handles query strings by extracting pathname only
 */
export function normalizePath(path: string): string {
  // Extract pathname (strip query string and hash)
  let normalized = path.split('?')[0].split('#')[0]

  // Strip exactly ONE /api prefix (avoid double-stripping like /api/api/foo)
  if (normalized.startsWith('/api/')) {
    normalized = normalized.slice(4) // Remove "/api" (4 chars)
  } else if (normalized === '/api') {
    normalized = '/'
  }

  // Ensure leading slash
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }

  // Strip trailing slash (except for root /)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

/**
 * Match a path against route patterns
 * Returns { handler, params, matchedRoute } if match found, null otherwise
 */
export function matchRoute(
  routes: Route[],
  method: string,
  path: string,
  options?: { debug?: boolean; correlationId?: string }
): { handler: RouteHandler; params: Record<string, string>; matchedRoute?: Route } | null {
  const rawPath = path
  const normalizedPath = normalizePath(path)

  // Dev-only logging
  const isDev = process.env.NODE_ENV !== 'production'
  if (isDev && options?.debug) {
    console.info(`[Router ${options.correlationId || 'N/A'}] method=${method} rawPath=${rawPath} normalizedPath=${normalizedPath}`)
  }

  for (const route of routes) {
    // Check method first (cheap)
    if (route.method !== method) {
      continue
    }

    // Check pattern match
    const { regex, params: paramNames } = patternToRegex(route.pattern)
    const match = normalizedPath.match(regex)

    if (match) {
      // Extract params from regex groups
      const params: Record<string, string> = {}
      for (let i = 0; i < paramNames.length; i++) {
        params[paramNames[i]] = match[i + 1]
      }

      if (isDev && options?.debug) {
        console.info(`[Router ${options.correlationId || 'N/A'}] ✓ matched pattern=${route.pattern} handler=${route.handler.name || 'anonymous'}`)
      }

      return { handler: route.handler, params, matchedRoute: route }
    }
  }

  if (isDev && options?.debug) {
    console.warn(`[Router ${options.correlationId || 'N/A'}] ✗ no match found`)
  }

  return null
}

/**
 * Find all routes matching a path (any method) for 405 responses
 */
export function findMatchingMethods(routes: Route[], path: string): string[] {
  const normalizedPath = normalizePath(path)
  const methods: string[] = []

  for (const route of routes) {
    const { regex } = patternToRegex(route.pattern)
    if (normalizedPath.match(regex)) {
      methods.push(route.method)
    }
  }

  return methods
}

/**
 * Get route metadata for debugging (dev only)
 */
export function getRouteMetadata(routes: Route[]): Array<{
  method: string
  pattern: string
  regex: string
  handlerName: string
}> {
  return routes.map(route => {
    const { regex } = patternToRegex(route.pattern)
    return {
      method: route.method,
      pattern: route.pattern,
      regex: regex.toString(),
      handlerName: route.handler.name || 'anonymous'
    }
  })
}
