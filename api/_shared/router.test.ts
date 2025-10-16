// Unit tests for router path normalization and matching
import { describe, it, expect } from 'vitest'
import { normalizePath, matchRoute, findMatchingMethods, type Route } from './router.js'

describe('normalizePath', () => {
  it('should strip leading /api prefix', () => {
    expect(normalizePath('/api/station/state')).toBe('/station/state')
  })

  it('should strip exactly one /api prefix (avoid double-stripping)', () => {
    expect(normalizePath('/api/api/station/state')).toBe('/api/station/state')
  })

  it('should handle /api root path', () => {
    expect(normalizePath('/api')).toBe('/')
    expect(normalizePath('/api/')).toBe('/')
  })

  it('should remove trailing slash', () => {
    expect(normalizePath('/api/station/state/')).toBe('/station/state')
  })

  it('should preserve root / without removing it', () => {
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('/api/')).toBe('/')
  })

  it('should handle query strings', () => {
    expect(normalizePath('/api/station/state?foo=bar')).toBe('/station/state')
  })

  it('should handle hash fragments', () => {
    expect(normalizePath('/api/station/state#section')).toBe('/station/state')
  })

  it('should ensure leading slash if missing', () => {
    expect(normalizePath('station/state')).toBe('/station/state')
  })

  it('should handle paths without /api prefix', () => {
    expect(normalizePath('/station/state')).toBe('/station/state')
  })
})

describe('matchRoute', () => {
  const mockHandler = async () => {}

  const routes: Route[] = [
    { method: 'GET', pattern: '/health', handler: mockHandler },
    { method: 'GET', pattern: '/station/state', handler: mockHandler },
    { method: 'POST', pattern: '/queue/submit', handler: mockHandler },
    { method: 'GET', pattern: '/users/:id', handler: mockHandler },
    { method: 'GET', pattern: '/users/:id/avatar', handler: mockHandler },
    { method: 'GET', pattern: '/admin/track/:id', handler: mockHandler },
  ]

  it('should match exact static routes', () => {
    const match = matchRoute(routes, 'GET', '/api/health')
    expect(match).not.toBeNull()
    expect(match?.params).toEqual({})
  })

  it('should match routes with /api prefix stripped', () => {
    const match = matchRoute(routes, 'GET', '/api/station/state')
    expect(match).not.toBeNull()
    expect(match?.params).toEqual({})
  })

  it('should match routes without /api prefix', () => {
    const match = matchRoute(routes, 'GET', '/station/state')
    expect(match).not.toBeNull()
  })

  it('should return null for non-existent routes', () => {
    const match = matchRoute(routes, 'GET', '/api/nonexistent')
    expect(match).toBeNull()
  })

  it('should return null for wrong method', () => {
    const match = matchRoute(routes, 'POST', '/api/station/state')
    expect(match).toBeNull()
  })

  it('should match dynamic param routes', () => {
    const match = matchRoute(routes, 'GET', '/api/users/123')
    expect(match).not.toBeNull()
    expect(match?.params).toEqual({ id: '123' })
  })

  it('should match dynamic param routes with specific paths first', () => {
    // /users/:id/avatar should match before /users/:id
    const match = matchRoute(routes, 'GET', '/api/users/456/avatar')
    expect(match).not.toBeNull()
    expect(match?.params).toEqual({ id: '456' })
  })

  it('should extract multiple params', () => {
    const match = matchRoute(routes, 'GET', '/api/admin/track/abc-123')
    expect(match).not.toBeNull()
    expect(match?.params).toEqual({ id: 'abc-123' })
  })

  it('should handle trailing slashes', () => {
    const match = matchRoute(routes, 'GET', '/api/health/')
    expect(match).not.toBeNull()
  })

  it('should handle query strings', () => {
    const match = matchRoute(routes, 'GET', '/api/health?status=ok')
    expect(match).not.toBeNull()
  })
})

describe('findMatchingMethods', () => {
  const mockHandler = async () => {}

  const routes: Route[] = [
    { method: 'GET', pattern: '/station/state', handler: mockHandler },
    { method: 'POST', pattern: '/queue/submit', handler: mockHandler },
    { method: 'GET', pattern: '/users/:id', handler: mockHandler },
    { method: 'PATCH', pattern: '/users/:id', handler: mockHandler },
    { method: 'PUT', pattern: '/users/:id', handler: mockHandler },
    { method: 'GET', pattern: '/station/advance', handler: mockHandler },
    { method: 'POST', pattern: '/station/advance', handler: mockHandler },
  ]

  it('should find single method for path', () => {
    const methods = findMatchingMethods(routes, '/api/station/state')
    expect(methods).toEqual(['GET'])
  })

  it('should find multiple methods for same path', () => {
    const methods = findMatchingMethods(routes, '/api/users/123')
    expect(methods).toContain('GET')
    expect(methods).toContain('PATCH')
    expect(methods).toContain('PUT')
    expect(methods).toHaveLength(3)
  })

  it('should find multiple methods for station/advance', () => {
    const methods = findMatchingMethods(routes, '/api/station/advance')
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toHaveLength(2)
  })

  it('should return empty array for non-existent path', () => {
    const methods = findMatchingMethods(routes, '/api/nonexistent')
    expect(methods).toEqual([])
  })

  it('should handle paths with trailing slash', () => {
    const methods = findMatchingMethods(routes, '/api/station/state/')
    expect(methods).toEqual(['GET'])
  })
})

describe('Multi-method route matching', () => {
  const mockHandler = async () => {}

  const routes: Route[] = [
    { method: 'GET', pattern: '/station/advance', handler: mockHandler },
    { method: 'POST', pattern: '/station/advance', handler: mockHandler },
    { method: 'GET', pattern: '/auth/discord/start', handler: mockHandler },
  ]

  it('should match GET /station/advance', () => {
    const match = matchRoute(routes, 'GET', '/api/station/advance')
    expect(match).not.toBeNull()
    expect(match?.params).toEqual({})
  })

  it('should match POST /station/advance', () => {
    const match = matchRoute(routes, 'POST', '/api/station/advance')
    expect(match).not.toBeNull()
    expect(match?.params).toEqual({})
  })

  it('should return null for PUT /station/advance', () => {
    const match = matchRoute(routes, 'PUT', '/api/station/advance')
    expect(match).toBeNull()
  })

  it('should match GET /auth/discord/start', () => {
    const match = matchRoute(routes, 'GET', '/api/auth/discord/start')
    expect(match).not.toBeNull()
    expect(match?.params).toEqual({})
  })

  it('should return null for POST /auth/discord/start', () => {
    const match = matchRoute(routes, 'POST', '/api/auth/discord/start')
    expect(match).toBeNull()
  })
})
