// Minimal profanity filter for ephemeral user content
// Simple word list approach for display names and chat messages

// Minimal list of obvious inappropriate words
const PROFANITY_LIST = [
  'fuck', 'shit', 'ass', 'damn', 'bitch', 'cunt', 'dick', 'pussy',
  'whore', 'slut', 'fag', 'faggot', 'retard', 'nigger', 'nazi',
  'kill', 'die', 'suicide', 'murder', 'rape', 'porn', 'sex'
]

/**
 * Check if text contains obvious profanity
 * Case-insensitive matching of whole words
 */
export function containsProfanity(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false
  }
  
  // Convert to lowercase and split into words
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace non-word chars with spaces
    .split(/\s+/) // Split on whitespace
    .filter(word => word.length > 0)
  
  // Check each word against profanity list
  return words.some(word => PROFANITY_LIST.includes(word))
}

/**
 * Get a cleaned version of text with profanity replaced by asterisks
 * Mainly for debugging/logging purposes
 */
export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    return text
  }
  
  let sanitized = text.toLowerCase()
  
  // Replace each profane word with asterisks
  PROFANITY_LIST.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi')
    const replacement = '*'.repeat(word.length)
    sanitized = sanitized.replace(regex, replacement)
  })
  
  return sanitized
}

/**
 * Validate display name for appropriateness
 * Returns null if valid, error message if invalid
 */
export function validateDisplayName(displayName: string): string | null {
  if (!displayName || typeof displayName !== 'string') {
    return 'Display name is required'
  }
  
  const trimmed = displayName.trim()
  
  if (trimmed.length === 0) {
    return 'Display name cannot be empty'
  }
  
  if (trimmed.length > 30) {
    return 'Display name too long (max 30 characters)'
  }
  
  if (containsProfanity(trimmed)) {
    return 'Display name contains inappropriate content'
  }
  
  // Check for obvious spam patterns
  if (/(.)\1{4,}/.test(trimmed)) { // More than 4 repeated characters
    return 'Display name contains too many repeated characters'
  }
  
  return null // Valid
}

/**
 * Validate chat message for appropriateness
 * Returns null if valid, error message if invalid
 */
export function validateChatMessage(message: string): string | null {
  if (!message || typeof message !== 'string') {
    return 'Message is required'
  }
  
  const trimmed = message.trim()
  
  if (trimmed.length === 0) {
    return 'Message cannot be empty'
  }
  
  if (trimmed.length > 200) {
    return 'Message too long (max 200 characters)'
  }
  
  if (containsProfanity(trimmed)) {
    return 'Message contains inappropriate content'
  }
  
  return null // Valid
}