import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cid = req.headers['x-request-id'] || crypto.randomUUID()
  try {
    const mod = await import('../../../api_handlers/auth/discord/start')
    const realHandler = (mod as any).default || mod
    return await realHandler(req, res)
  } catch (err: any) {
    console.error('[shim:/api/auth/discord/start] import failed', { cid, err: err?.stack || String(err) })
    return res.status(400).json({ error: { code: 'IMPORT_FAILED_DISCORD_START', message: 'Discord auth unavailable' }, cid })
  }
}