// API client for authentication and account linking

export type WhoAmI = {
  userId: string
  ephemeral: boolean
  displayName?: string
}

export type UnlinkResult = {
  unlinked: boolean
  alreadyUnlinked: boolean
  remainingAccounts: number
  ephemeral: boolean
}

/**
 * Fetch current session/user info
 */
export async function getWhoami(): Promise<WhoAmI> {
  const r = await fetch('/api/session/whoami', {
    headers: { Accept: 'application/json' }
  })
  if (!r.ok) throw new Error(`whoami failed: ${r.status}`)
  return r.json()
}

/**
 * Unlink Discord account from current user
 */
export async function unlinkDiscord(): Promise<UnlinkResult> {
  const r = await fetch('/api/auth/discord/unlink', {
    method: 'POST',
    headers: { Accept: 'application/json' }
  })
  if (!r.ok) throw new Error(`unlink failed: ${r.status}`)
  return r.json()
}
