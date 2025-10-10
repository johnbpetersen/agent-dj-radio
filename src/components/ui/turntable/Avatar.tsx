interface AvatarProps {
  name?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  isOnline?: boolean
  isDJ?: boolean
  className?: string
}

const sizeClasses = {
  sm: 'w-8 h-10 text-xs',
  md: 'w-12 h-16 text-sm',
  lg: 'w-16 h-20 text-lg',
  xl: 'w-24 h-28 text-xl'
}

const colorVariants = [
  'from-blue-400 to-blue-600',
  'from-purple-400 to-purple-600',
  'from-pink-400 to-pink-600',
  'from-green-400 to-green-600',
  'from-yellow-400 to-yellow-600',
  'from-red-400 to-red-600',
  'from-indigo-400 to-indigo-600',
  'from-teal-400 to-teal-600'
]

function getInitials(name?: string): string {
  if (!name) return '?'

  const words = name.trim().split(' ')
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

function getColorForName(name?: string): string {
  if (!name) return colorVariants[0]

  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colorVariants[Math.abs(hash) % colorVariants.length]
}

export default function Avatar({
  name,
  size = 'md',
  isOnline = false,
  isDJ = false,
  className = ''
}: AvatarProps) {
  const initials = getInitials(name)
  const colorClass = getColorForName(name)

  return (
    // We add a 'relative' class to the container so we can position the indicators
    <div className={`relative ${className}`}>
      <div
        className={`
          ${sizeClasses[size]}
          rounded-t-full bg-gradient-to-b ${colorClass}
          flex items-center justify-center
          font-bold text-white
          border-b-4 border-black/30
          shadow-lg
          ${isDJ ? 'dj-avatar' : ''}
          transition-all duration-300
        `}
      >
        {initials}
      </div>

      {/* Online indicator - This logic is now restored */}
      {isOnline && (
        <div className="absolute bottom-2 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-gray-800 shadow-sm" />
      )}

      {/* DJ indicator - This logic is now restored */}
      {isDJ && (
        <div className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-xs px-2 py-1 rounded-full font-bold shadow-sm">
          DJ
        </div>
      )}
    </div>
  )
}