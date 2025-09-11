// Fun name generator for ephemeral users
// Generates names in format: {adjective}_{animal}

const ADJECTIVES = [
  'purple', 'dancing', 'sleepy', 'happy', 'bouncy', 'clever', 'swift', 'bright',
  'cosmic', 'electric', 'golden', 'silver', 'crystal', 'mystic', 'neon', 'rainbow',
  'stellar', 'lunar', 'solar', 'windy', 'stormy', 'sunny', 'frosty', 'blazing',
  'gentle', 'fierce', 'calm', 'wild', 'zen', 'spunky', 'zesty', 'mellow',
  'vibrant', 'serene', 'bold', 'shy', 'curious', 'sneaky', 'playful', 'wise',
  'lucky', 'magic', 'sparkly', 'misty', 'dreamy', 'peppy', 'chill', 'funky'
]

const ANIMALS = [
  'raccoon', 'penguin', 'koala', 'fox', 'wolf', 'bear', 'cat', 'dog',
  'owl', 'hawk', 'eagle', 'swan', 'duck', 'whale', 'dolphin', 'octopus',
  'turtle', 'frog', 'butterfly', 'bee', 'ladybug', 'spider', 'crab', 'lobster',
  'rabbit', 'squirrel', 'chipmunk', 'hamster', 'mouse', 'rat', 'ferret', 'otter',
  'deer', 'elk', 'moose', 'buffalo', 'zebra', 'giraffe', 'elephant', 'rhino',
  'lion', 'tiger', 'leopard', 'cheetah', 'panda', 'sloth', 'monkey', 'lemur'
]

/**
 * Generate a fun name in format: adjective_animal
 */
export function generateFunName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  
  return `${adjective}_${animal}`
}

/**
 * Generate multiple fun name suggestions
 * Useful for handling name conflicts
 */
export function generateFunNameSuggestions(count: number = 3): string[] {
  const suggestions = new Set<string>()
  
  // Generate unique suggestions
  while (suggestions.size < count) {
    suggestions.add(generateFunName())
  }
  
  return Array.from(suggestions)
}

/**
 * Generate numbered name variants for handling uniqueness conflicts
 * e.g., "purple_raccoon_01", "purple_raccoon_02"
 */
export function generateNameVariants(baseName: string, count: number = 3): string[] {
  const variants: string[] = []
  
  for (let i = 1; i <= count; i++) {
    const suffix = i.toString().padStart(2, '0')
    variants.push(`${baseName}_${suffix}`)
  }
  
  return variants
}