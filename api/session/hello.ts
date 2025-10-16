import type { VercelRequest, VercelResponse } from '@vercel/node'
import realHandler from '../../api_handlers/session/hello'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return await (realHandler as any)(req, res)
}