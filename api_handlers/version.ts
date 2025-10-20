// api/version.ts
// Version information endpoint

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { serverEnv } from '../src/config/env.js'
import { secureHandler, securityConfigs } from './_shared/secure-handler.js'

interface VersionResponse {
  version: string
  stage: string
  buildTimeIso: string
}

async function versionHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Only GET allowed
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const response: VersionResponse = {
    version: process.env.GIT_SHA || 'dev',
    stage: serverEnv.STAGE,
    buildTimeIso: process.env.BUILD_TIME || new Date().toISOString()
  }

  res.status(200).json(response)
}

export default secureHandler(versionHandler, securityConfigs.public)
