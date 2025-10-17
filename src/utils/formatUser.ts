// User display name formatting utilities

export interface UserInfo {
  display_name?: string | null
  id?: string | null
}

/**
 * Format a user's display name for showing in the UI with @ prefix if appropriate
 * @param user - User object with display_name
 * @returns Display name with @ prefix or "Guest" fallback
 *
 * Examples:
 * - "jbp3" → "@jbp3"
 * - Ephemeral: "purple_raccoon" → "@purple_raccoon"
 * - Numeric suffix: "jbp3_2" → "@jbp3_2"
 * - Guest/null: null → "Guest"
 */
export function displayHandle(user: UserInfo | null | undefined): string {
  if (!user?.display_name) {
    return 'Guest'
  }

  // Add @ prefix if not already present
  return user.display_name.startsWith('@')
    ? user.display_name
    : `@${user.display_name}`
}

/**
 * Get fallback name for generating letter avatars (without @ prefix)
 * Used as seed for deterministic color generation
 *
 * @param user - User object with display_name
 * @returns Clean name for avatar generation
 *
 * Examples:
 * - "jbp3" → "jbp3"
 * - "@jbp3" → "jbp3"
 * - "jbp3_2" → "jbp3_2"
 * - null → "Guest"
 */
export function fallbackName(user: UserInfo | null | undefined): string {
  if (!user?.display_name) {
    return 'Guest'
  }

  // Strip @ prefix if present
  return user.display_name.replace(/^@/, '')
}

/**
 * Generate deterministic color from string (for letter avatars)
 * Uses simple hash to pick from a palette of pleasant colors
 *
 * @param seed - String to generate color from (typically display name)
 * @returns Hex color code
 */
export function getAvatarColor(seed: string): string {
  // Palette of distinct, readable colors for dark backgrounds
  const palette = [
    '#FF6B6B', // coral red
    '#4ECDC4', // turquoise
    '#45B7D1', // sky blue
    '#FFA07A', // light salmon
    '#98D8C8', // mint
    '#F7DC6F', // warm yellow
    '#BB8FCE', // lavender
    '#85C1E2', // powder blue
    '#F8B739', // amber
    '#52B788', // green
    '#EF476F', // rose
    '#06FFA5', // neon green
  ]

  // Simple string hash
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }

  // Pick color from palette
  const index = Math.abs(hash) % palette.length
  return palette[index]
}

/**
 * Get initials from display name for letter avatar
 * @param name - Display name
 * @returns 1-2 letter initials
 *
 * Examples:
 * - "purple_raccoon" → "PR"
 * - "jbp3" → "J"
 * - "John Doe" → "JD"
 * - "Guest" → "?"
 */
export function getInitials(name: string): string {
  if (!name || name === 'Guest') {
    return '?'
  }

  // Handle underscore-separated names (e.g., purple_raccoon)
  if (name.includes('_')) {
    const parts = name.split('_').filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
  }

  // Handle space-separated names
  if (name.includes(' ')) {
    const parts = name.split(' ').filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
  }

  // Single word - take first letter
  return name[0]?.toUpperCase() || '?'
}
