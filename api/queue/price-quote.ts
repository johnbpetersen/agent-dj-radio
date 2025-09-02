import type { VercelRequest, VercelResponse } from '@vercel/node'
import { calculatePrice, validateDuration } from '../../src/server/pricing'
import { secureHandler, securityConfigs } from '../_shared/secure-handler'
import type { PriceQuoteRequest, PriceQuoteResponse } from '../../src/types'

async function priceQuoteHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { duration_seconds }: PriceQuoteRequest = req.body

    if (!duration_seconds || !validateDuration(duration_seconds)) {
      return res.status(400).json({ 
        error: 'Invalid duration. Must be 60, 90, or 120 seconds.' 
      })
    }

    const price_usd = calculatePrice(duration_seconds)

    const response: PriceQuoteResponse = {
      price_usd,
      duration_seconds
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Price quote error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

export default secureHandler(priceQuoteHandler, securityConfigs.user)