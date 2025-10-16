import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cid = req.headers['x-request-id'] || crypto.randomUUID()
  try {
    const mod = await import('../../api_handlers/station/state')
    const realHandler = (mod as any).default || mod
    return await realHandler(req, res)
  } catch (err: any) {
    console.error('[shim:/api/station/state] import failed', { cid, err: err?.stack || String(err) })
    // Return safe degraded payload so UI can still boot
    return res.status(200).json({
      degraded: true,
      error_code: 'IMPORT_FAILED_STATION_STATE',
      cid
    })
  }
}