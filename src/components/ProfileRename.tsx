// ProfileRename - Inline form for renaming display name

import { useState } from 'react'
import { useIdentity } from '../hooks/useIdentity'
import { X } from 'lucide-react'

interface ProfileRenameProps {
  onClose: () => void
}

// Client-side validation matching server rules
const DISPLAY_NAME_REGEX = /^[a-z0-9_]{3,24}$/

function validateDisplayName(name: string): string | null {
  if (!name || name.length === 0) {
    return 'Display name is required'
  }
  if (name !== name.trim()) {
    return 'Display name cannot contain leading or trailing whitespace'
  }
  if (name.length < 3) {
    return 'Display name must be at least 3 characters'
  }
  if (name.length > 24) {
    return 'Display name must be at most 24 characters'
  }
  if (!DISPLAY_NAME_REGEX.test(name)) {
    return 'Display name can only contain lowercase letters, numbers, and underscores'
  }
  return null
}

export default function ProfileRename({ onClose }: ProfileRenameProps) {
  const { identity, renaming, rename } = useIdentity()
  const [newName, setNewName] = useState(identity?.displayName || '')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Client-side validation
    const validationError = validateDisplayName(newName)
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      await rename(newName)
      onClose()
    } catch (err) {
      // Handle server errors with status/code from CTO's nit
      if (err instanceof Error) {
        const status = (err as any).status
        const code = (err as any).code

        if (status === 409 || code === 'CONFLICT') {
          setError('Name already taken')
        } else if (status === 403 || code === 'FORBIDDEN') {
          setError('User is banned')
        } else {
          setError(err.message || 'Failed to rename')
        }
      } else {
        setError('Failed to rename')
      }
    }
  }

  return (
    <div className="bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg p-4 shadow-xl w-80">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white/90">Change Display Name</h3>
        <button
          onClick={onClose}
          className="text-white/50 hover:text-white/90 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label htmlFor="displayName" className="block text-xs text-white/60 mb-1">
            New display name
          </label>
          <input
            id="displayName"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={renaming}
            className="w-full bg-black/30 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
            placeholder="cosmic_dolphin"
          />
          <div className="mt-1 text-xs text-white/40">
            3-24 characters, lowercase, numbers, underscores only
          </div>
        </div>

        {error && (
          <div className="mb-3 text-xs text-red-300 bg-red-500/20 px-3 py-2 rounded">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={renaming || !newName || newName === identity?.displayName}
            className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {renaming ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={renaming}
            className="bg-white/10 hover:bg-white/20 disabled:bg-white/5 text-white/90 px-4 py-2 rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
