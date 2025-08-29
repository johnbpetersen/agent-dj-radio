// Pricing logic for track submissions

export const DURATION_OPTIONS = [60, 90, 120] as const
export type DurationOption = typeof DURATION_OPTIONS[number]

// Base price per second (in USD)
const BASE_PRICE_PER_SECOND = 0.05

// Duration multipliers
const DURATION_MULTIPLIERS: Record<DurationOption, number> = {
  60: 1.0,    // $3.00 base
  90: 0.95,   // $4.28 (slight discount)
  120: 0.90,  // $5.40 (better discount)
}

export function calculatePrice(durationSeconds: number): number {
  if (!DURATION_OPTIONS.includes(durationSeconds as DurationOption)) {
    throw new Error(`Invalid duration. Must be one of: ${DURATION_OPTIONS.join(', ')}`)
  }

  const multiplier = DURATION_MULTIPLIERS[durationSeconds as DurationOption]
  const basePrice = durationSeconds * BASE_PRICE_PER_SECOND
  const result = basePrice * multiplier
  return Number(result.toFixed(2))
}

export function validateDuration(duration: number): duration is DurationOption {
  return DURATION_OPTIONS.includes(duration as DurationOption)
}