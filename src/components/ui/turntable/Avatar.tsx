interface AvatarProps {
  name?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  isOnline?: boolean
  isDJ?: boolean
  className?: string
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-12 h-12 text-sm', 
  lg: 'w-16 h-16 text-lg',
  xl: 'w-20 h-20 text-xl'
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
    <div className={`relative ${className}`}>
      <div 
        className={`
          ${sizeClasses[size]} 
          rounded-full 
          bg-gradient-to-br ${colorClass}
          flex items-center justify-center
          font-bold text-white
          border-2 border-white/20
          shadow-lg
          ${isDJ ? 'dj-avatar' : ''}
          transition-all duration-300
        `}
      >
        {initials}
      </div>
      
      {/* Online indicator */}
      {isOnline && (
        <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-white/20 shadow-sm"></div>
      )}
      
      {/* DJ indicator */}
      {isDJ && (
        <div className="absolute -top-1 -right-1 bg-yellow-400 text-yellow-900 text-xs px-1 py-0.5 rounded-full font-bold shadow-sm">
          DJ
        </div>
      )}
    </div>
  )
}