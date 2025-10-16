// tests/api/_shared/url-helpers.test.ts
import { describe, test, expect, beforeEach } from 'vitest'
import { computePublicOrigin, computeRedirectUri } from '../../../api/_shared/url-helpers.js'
import type { VercelRequest } from '@vercel/node'

describe('computePublicOrigin', () => {
  test('production with x-forwarded-proto and host', () => {
    const req = {
      headers: {
        'x-forwarded-proto': 'https',
        host: 'agent-dj-radio.vercel.app'
      }
    } as unknown as VercelRequest

    const origin = computePublicOrigin(req)
    expect(origin).toBe('https://agent-dj-radio.vercel.app')
  })

  test('handles comma-separated x-forwarded-proto (uses first)', () => {
    const req = {
      headers: {
        'x-forwarded-proto': 'https,http',
        host: 'agent-dj-radio.vercel.app'
      }
    } as unknown as VercelRequest

    const origin = computePublicOrigin(req)
    expect(origin).toBe('https://agent-dj-radio.vercel.app')
  })

  test('local dev without x-forwarded-proto (localhost)', () => {
    const req = {
      headers: {
        host: 'localhost:3001'
      }
    } as unknown as VercelRequest

    const origin = computePublicOrigin(req)
    expect(origin).toBe('http://localhost:3001')
  })

  test('local dev with 127.0.0.1', () => {
    const req = {
      headers: {
        host: '127.0.0.1:3001'
      }
    } as unknown as VercelRequest

    const origin = computePublicOrigin(req)
    expect(origin).toBe('http://127.0.0.1:3001')
  })

  test('throws on missing host header', () => {
    const req = {
      headers: {}
    } as unknown as VercelRequest

    expect(() => computePublicOrigin(req)).toThrow('Unable to determine public origin')
  })

  test('uses VITE_SITE_URL fallback in dev when no host', () => {
    const originalEnv = process.env.NODE_ENV
    const originalSiteUrl = process.env.VITE_SITE_URL

    process.env.NODE_ENV = 'development'
    process.env.VITE_SITE_URL = 'http://localhost:5173'

    const req = {
      headers: {}
    } as unknown as VercelRequest

    const origin = computePublicOrigin(req)
    expect(origin).toBe('http://localhost:5173')

    // Restore
    process.env.NODE_ENV = originalEnv
    process.env.VITE_SITE_URL = originalSiteUrl
  })
})

describe('computeRedirectUri', () => {
  test('returns full callback URL in production', () => {
    const req = {
      headers: {
        'x-forwarded-proto': 'https',
        host: 'agent-dj-radio.vercel.app'
      }
    } as unknown as VercelRequest

    const redirectUri = computeRedirectUri(req, '/api/auth/discord/callback')
    expect(redirectUri).toBe('https://agent-dj-radio.vercel.app/api/auth/discord/callback')
  })

  test('returns full callback URL in dev', () => {
    const req = {
      headers: {
        host: 'localhost:3001'
      }
    } as unknown as VercelRequest

    const redirectUri = computeRedirectUri(req, '/api/auth/discord/callback')
    expect(redirectUri).toBe('http://localhost:3001/api/auth/discord/callback')
  })

  test('handles path with leading slash', () => {
    const req = {
      headers: {
        'x-forwarded-proto': 'https',
        host: 'example.com'
      }
    } as unknown as VercelRequest

    const redirectUri = computeRedirectUri(req, '/api/callback')
    expect(redirectUri).toBe('https://example.com/api/callback')
  })

  test('handles path without leading slash', () => {
    const req = {
      headers: {
        'x-forwarded-proto': 'https',
        host: 'example.com'
      }
    } as unknown as VercelRequest

    const redirectUri = computeRedirectUri(req, 'api/callback')
    expect(redirectUri).toBe('https://example.com/api/callback')
  })
})
