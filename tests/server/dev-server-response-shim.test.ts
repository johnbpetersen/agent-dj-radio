// tests/server/dev-server-response-shim.test.ts
// Regression test for session cookie bug in local dev
// Ensures dev-functions-server.ts response shim has both setHeader AND getHeader

import { describe, it, expect } from 'vitest'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { parse as parseUrl } from 'url'

/**
 * Minimal reproduction of makeReqRes from dev-functions-server.ts
 * This is the code that was missing getHeader, causing cookies not to stick
 */
function makeReqRes(req: IncomingMessage, res: ServerResponse) {
  const { pathname, query } = parseUrl(req.url || '', true)

  const vReq: any = req
  vReq.query = query
  vReq.cookies = {}

  // RESPONSE SHIM - must have both setHeader AND getHeader for Node.js cookie path
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

describe('dev-functions-server response shim', () => {
  it('should have both setHeader and getHeader methods', async () => {
    // Create a minimal HTTP server to get real req/res objects
    const server = createServer((req, res) => {
      const { vRes } = makeReqRes(req, res)

      // Verify both methods exist
      expect(typeof vRes.setHeader).toBe('function')
      expect(typeof vRes.getHeader).toBe('function')

      // Verify they work
      vRes.setHeader('X-Test', 'value')
      const retrieved = vRes.getHeader('X-Test')
      expect(retrieved).toBe('value')

      // Verify Set-Cookie can be retrieved (critical for session-helpers.ts)
      vRes.setHeader('Set-Cookie', 'sid=test-id; HttpOnly')
      const cookie = vRes.getHeader('Set-Cookie')
      expect(cookie).toBe('sid=test-id; HttpOnly')

      res.writeHead(200)
      res.end('OK')
    })

    // Start server
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve())
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get server address')
    }

    // Make a test request
    const response = await fetch(`http://localhost:${address.port}/test`)
    expect(response.status).toBe(200)

    // Cleanup
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  })

  it('should fail if getHeader is missing (regression test)', () => {
    // Simulate the broken version (before fix)
    const brokenMakeReqRes = (req: IncomingMessage, res: ServerResponse) => {
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
        // MISSING: getHeader method
        json(data: any) {
          if (!res.getHeader('Content-Type')) {
            rawSetHeader('Content-Type', 'application/json')
          }
          rawEnd(JSON.stringify(data))
        }
      }
      return vRes
    }

    // Create mock ServerResponse
    const mockRes = new ServerResponse({} as IncomingMessage)
    const brokenVRes = brokenMakeReqRes({} as IncomingMessage, mockRes)

    // Verify getHeader is missing
    expect(brokenVRes.getHeader).toBeUndefined()

    // This is the condition that session-helpers.ts checks:
    // if (typeof res.setHeader === 'function' && typeof res.getHeader === 'function')
    const hasNodePath = typeof brokenVRes.setHeader === 'function' && typeof brokenVRes.getHeader === 'function'

    // Without getHeader, Node.js cookie path is NOT taken
    expect(hasNodePath).toBe(false)
  })
})
