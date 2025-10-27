// api/_shared/display-name.ts
// Helpers for computing preferred display name (Discord handle > ephemeral name)

import { supabaseAdmin } from './supabase.js'
import { logger } from '../../src/lib/logger.js'

/**
 * Format Discord handle from user_accounts meta
 * Prefers global_name, falls back to username#discriminator or username
 */
export function formatDiscordHandle(meta: any): string {
  if (!meta) return ''

  // Prefer global_name (Discord's new display name system)
  if (typeof meta.global_name === 'string' && meta.global_name.trim()) {
    return meta.global_name.trim()
  }

  // Legacy: username#discriminator (if discriminator !== '0')
  if (typeof meta.username === 'string' && meta.username.trim()) {
    const username = meta.username.trim()
    const discriminator = meta.discriminator

    if (typeof discriminator === 'string' && discriminator !== '0' && discriminator.trim()) {
      return `${username}#${discriminator}`
    }

    // New system: discriminator is '0', just return username
    return username
  }

  return ''
}

/**
 * Get preferred display name for a user
 * Prefers Discord handle if linked, falls back to ephemeral display_name
 */
export async function getPreferredDisplayName(userId: string): Promise<string> {
  try {
    // Check for Discord account link
    const { data: account, error: accountError } = await supabaseAdmin
      .from('user_accounts')
      .select('meta')
      .eq('user_id', userId)
      .eq('provider', 'discord')
      .limit(1)
      .single()

    if (!accountError && account?.meta) {
      const discordHandle = formatDiscordHandle(account.meta)
      if (discordHandle) {
        return discordHandle
      }
    }

    // Fallback: ephemeral display_name from users table
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('display_name')
      .eq('id', userId)
      .single()

    if (userError || !user?.display_name) {
      logger.warn('No display name found for user', { userId })
      return 'anon'
    }

    return user.display_name
  } catch (error) {
    logger.error('Failed to get preferred display name', { userId }, error as Error)
    return 'anon'
  }
}
