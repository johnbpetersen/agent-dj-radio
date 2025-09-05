#!/usr/bin/env node

/**
 * Development API server that runs Vercel functions locally
 * Serves API endpoints at http://localhost:3001/api/*
 */

import { createServer } from 'http'
import { parse } from 'url'
import { readFile } from 'fs/promises'
import { resolve, join } from 'path'

// Load environment variables from .env manually
async function loadEnvFile() {
  try {
    const envContent = await readFile('.env', 'utf8')
    envContent.split('\n').forEach(line => {
      const [key, value] = line.split('=')
      if (key && value) {
        process.env[key.trim()] = value.trim()
      }
    })
  } catch (error) {
    console.log('No .env file found or error reading it:', error.message)
  }
}

// Load env vars before starting server
await loadEnvFile()

const PORT = 3001
const API_DIR = resolve('./api')

// Helper to load and execute a Vercel function
async function loadVercelFunction(functionPath) {
  try {
    // Use dynamic import to load the function
    const module = await import(`file://${functionPath}`)
    return module.default
  } catch (error) {
    console.error(`Failed to load function ${functionPath}:`, error.message)
    return null
  }
}

// Convert file path to API route
function pathToRoute(filePath) {
  return filePath
    .replace(API_DIR, '')
    .replace(/\\/g, '/')
    .replace(/\.ts$/, '')
    .replace(/\/index$/, '')
}

// Mock Vercel request/response objects
function createMockReq(req, body) {
  return {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: body,
    query: parse(req.url, true).query,
    cookies: {} // Could parse from headers if needed
  }
}

function createMockRes(res) {
  const mockRes = {
    status: (code) => {
      res.statusCode = code
      return mockRes
    },
    json: (data) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(data))
    },
    send: (data) => {
      res.end(data)
    },
    setHeader: (name, value) => {
      res.setHeader(name, value)
    }
  }
  return mockRes
}

const server = createServer(async (req, res) => {
  // Enable CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  
  if (req.method === 'OPTIONS') {
    res.statusCode = 200
    res.end()
    return
  }

  const { pathname } = parse(req.url)
  
  // Only handle /api/* routes
  if (!pathname.startsWith('/api/')) {
    res.statusCode = 404
    res.end('Not Found')
    return
  }

  console.log(`${req.method} ${pathname}`)

  try {
    // Convert API route to file path
    const apiPath = pathname.replace('/api', '')
    const possiblePaths = [
      join(API_DIR, `${apiPath}.ts`),
      join(API_DIR, `${apiPath}/index.ts`)
    ]

    let functionHandler = null
    let functionPath = null

    for (const path of possiblePaths) {
      try {
        functionHandler = await loadVercelFunction(path)
        if (functionHandler) {
          functionPath = path
          break
        }
      } catch (error) {
        // Try next path
        continue
      }
    }

    if (!functionHandler) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'API endpoint not found' }))
      return
    }

    // Read request body
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
    })
    
    req.on('end', async () => {
      try {
        // Parse JSON body if present
        let parsedBody = body
        if (body && req.headers['content-type']?.includes('application/json')) {
          parsedBody = JSON.parse(body)
        }

        // Create mock Vercel request/response objects
        const mockReq = createMockReq(req, parsedBody)
        const mockRes = createMockRes(res)

        // Execute the function
        await functionHandler(mockReq, mockRes)
        
      } catch (error) {
        console.error(`Error executing ${functionPath}:`, error)
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ 
          error: 'Internal server error',
          message: error.message 
        }))
      }
    })

  } catch (error) {
    console.error('Server error:', error)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ 
      error: 'Internal server error',
      message: error.message 
    }))
  }
})

server.listen(PORT, () => {
  console.log(`🚀 Dev API server running on http://localhost:${PORT}`)
  console.log(`📁 Serving functions from: ${API_DIR}`)
  console.log(`🔗 API endpoints available at: http://localhost:${PORT}/api/*`)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down dev API server...')
  server.close(() => {
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down dev API server...')
  server.close(() => {
    process.exit(0)
  })
})