// Helper utilities for mocking Supabase query chains in tests
// Solves the problem of brittle nested .eq() mocks by providing a self-referencing chain

import { vi } from 'vitest'

type SingleResult<T> = Promise<{ data: T | null; error: any | null }>

/**
 * Creates a chainable Supabase query mock that supports any number of .eq() calls
 *
 * @example
 * const oauthStateRow = { id: 'state-uuid', session_id: 'session-uuid', ... }
 * const { select } = makeSelectEqSingle({ data: oauthStateRow, error: null })
 *
 * // Can be used for .select().eq().eq().single() or .select().eq().single()
 * vi.spyOn(supabaseAdmin, 'from').mockReturnValue({ select } as any)
 */
export function makeSelectEqSingle<T>(
  result: { data: T | null; error: any | null } | SingleResult<T>
) {
  const single = vi.fn().mockResolvedValue(result as any)

  // Self-referencing chain object - .eq() returns itself so you can call .eq().eq().eq()...
  const chain: any = {
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    gt: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    single,
  }

  // select returns the chain so test code can do: .select(...).eq(...).eq(...).single()
  const select = vi.fn(() => chain)

  // For convenience, also expose insert/update/delete that resolve to result if you need them later
  const insert = vi.fn().mockResolvedValue(result as any)
  const update = vi.fn(() => chain)
  const _delete = vi.fn(() => chain)

  return { select, chain, fns: { single, insert, update, delete: _delete } }
}

/**
 * Helper to set up table-specific mocks on supabaseAdmin.from()
 *
 * @example
 * const fromSpy = vi.spyOn(supabaseAdmin, 'from' as any)
 * mockFromForTable(fromSpy, 'oauth_states', { select: oauthSelect })
 */
export function mockFromForTable(
  spy: any,
  table: string,
  impl: any
) {
  const existingImpl = spy.getMockImplementation()

  spy.mockImplementation((t: string) => {
    if (t === table) return impl
    if (existingImpl) return existingImpl(t)
    throw new Error(`Unexpected table in test mock: ${t}`)
  })
}
