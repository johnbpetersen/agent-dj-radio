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
 */
export function normalizePath(path: string): string {
  // Strip /api prefix
  let normalized = path.replace(/^\/api/, '')

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
 * Returns { params, handler } if match found, null otherwise
 */
export function matchRoute(
  routes: Route[],
  method: string,
  path: string
): { handler: RouteHandler; params: Record<string, string> } | null {
  const normalizedPath = normalizePath(path)

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

      return { handler: route.handler, params }
    }
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
