// Identity utilities for computing displayLabel and managing Discord link/unlink

import { supabaseAdmin } from './supabase.js'

export interface DiscordMetadata {
  username: string
  avatarUrl: string | null
}

export interface Identity {
  isDiscordLinked: boolean
  isWalletLinked: boolean
  displayLabel: string
  ephemeralName: string
  avatarUrl: string | null
  userId: string
  discord: DiscordMetadata | null
}

interface UserRecord {
  id: string
  display_name: string
  ephemeral_display_name?: string | null
}

interface UserAccount {
  provider: string
  meta: Record<string, any>
}

/**
 * Resolve display name with deterministic suffix to avoid collisions
 * Checks database for existing names and appends _2, _3, etc.
 *
 * @param baseName - Base name to resolve (e.g., "jbp3")
 * @param excludeUserId - Optional user ID to exclude from collision check (for updates)
 * @returns Resolved name with suffix if needed (e.g., "jbp3_2")
 */
export async function resolveDisplayNameWithSuffix(
  baseName: string,
  excludeUserId?: string
): Promise<string> {
  // Clean base name (strip @ prefix if present)
  const cleanBase = baseName.replace(/^@/, '').trim()

  if (!cleanBase) {
    throw new Error('Base name cannot be empty')
  }

  // Try base name first
  let candidate = cleanBase
  let suffix = 1
  let maxAttempts = 100

  while (maxAttempts > 0) {
    // Check if name exists (excluding current user if specified)
    const query = supabaseAdmin
      .from('users')
      .select('id')
      .eq('display_name', candidate)
      .limit(1)

    if (excludeUserId) {
      query.neq('id', excludeUserId)
    }

    const { data, error } = await query

    if (error) {
      throw error
    }

    // Name is available
    if (!data || data.length === 0) {
      return candidate
    }

    // Try next suffix
    suffix++
    candidate = `${cleanBase}_${suffix}`
    maxAttempts--
  }

  // Fallback with timestamp if all suffixes exhausted
  return `${cleanBase}_${Date.now()}`
}

/**
 * Compute identity payload for session responses
 * Determines displayLabel based on Discord link status
 *
 * @param user - User record from database
 * @param accounts - Array of linked accounts (Discord, wallet)
 * @returns Identity payload with displayLabel, isDiscordLinked, etc.
 */
export async function computeIdentityPayload(
  user: UserRecord,
  accounts: UserAccount[]
): Promise<Identity> {
  const discordAccount = accounts.find(acc => acc.provider === 'discord')
  const isDiscordLinked = !!discordAccount
  const isWalletLinked = accounts.some(acc => acc.provider === 'wallet')

  // Ephemeral name is either stored ephemeral_display_name or current display_name
  const ephemeralName = user.ephemeral_display_name || user.display_name

  let displayLabel: string
  let discord: DiscordMetadata | null = null

  let avatarUrl: string | null = null

  if (isDiscordLinked && discordAccount) {
    // Discord linked: use @username format (current display_name has suffix)
    displayLabel = `@${user.display_name}`

    // Extract Discord metadata
    const username = discordAccount.meta?.username || user.display_name
    avatarUrl = discordAccount.meta?.avatar_url || null

    discord = {
      username,
      avatarUrl
    }
  } else {
    // Not linked: use ephemeral name without @ prefix
    displayLabel = ephemeralName
  }

  return {
    isDiscordLinked,
    isWalletLinked,
    displayLabel,
    ephemeralName,
    avatarUrl,
    userId: user.id,
    discord
  }
}
