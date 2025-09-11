// ProfileDrawer component - Allows editing display name and bio for ephemeral users
// Modal/drawer interface for profile management

import { useState, useEffect } from 'react'
import { useEphemeralUser } from '../hooks/useEphemeralUser'

interface ProfileDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export default function ProfileDrawer({ isOpen, onClose }: ProfileDrawerProps) {
  const { user, rename, setBio, loading, error: hookError } = useEphemeralUser()
  
  const [displayName, setDisplayName] = useState('')
  const [bio, setBioLocal] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [isSavingBio, setIsSavingBio] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Update local state when user changes
  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name)
      setBioLocal(user.bio || '')
    }
  }, [user])

  // Clear messages when opening/closing
  useEffect(() => {
    if (isOpen) {
      setError(null)
      setSuccessMessage(null)
    }
  }, [isOpen])

  const handleRename = async () => {
    if (!displayName.trim()) {
      setError('Display name cannot be empty')
      return
    }

    if (displayName.trim() === user?.display_name) {
      setError('Please enter a different name')
      return
    }

    setIsRenaming(true)
    setError(null)
    setSuccessMessage(null)

    const success = await rename(displayName.trim())
    
    if (success) {
      setSuccessMessage('Display name updated successfully!')
    } else {
      // Error is set by the hook
      setError(hookError)
    }
    
    setIsRenaming(false)
  }

  const handleSaveBio = async () => {
    setIsSavingBio(true)
    setError(null)
    setSuccessMessage(null)

    const success = await setBio(bio.trim())
    
    if (success) {
      setSuccessMessage('Bio updated successfully!')
    } else {
      setError(hookError)
    }
    
    setIsSavingBio(false)
  }

  const handleClose = () => {
    setError(null)
    setSuccessMessage(null)
    onClose()
  }

  // Show loading if user data not available
  if (loading || !user) {
    return null
  }

  // Don't render if not open
  if (!isOpen) {
    return null
  }

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={handleClose}
      />
      
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-lg z-50 transform transition-transform duration-300">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-xl font-semibold text-gray-800">Profile</h2>
            <button
              onClick={handleClose}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {/* Messages */}
            {(error || successMessage) && (
              <div className="mb-6">
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-red-800 text-sm">{error}</p>
                  </div>
                )}
                {successMessage && (
                  <div className="bg-green-50 border border-green-200 rounded-md p-3">
                    <p className="text-green-800 text-sm">{successMessage}</p>
                  </div>
                )}
              </div>
            )}

            {/* Display Name Section */}
            <div className="mb-8">
              <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
                Display Name
              </label>
              <div className="flex space-x-2">
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={30}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your display name"
                />
                <button
                  onClick={handleRename}
                  disabled={isRenaming || displayName.trim() === user.display_name}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {isRenaming ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {displayName.length}/30 characters
              </p>
            </div>

            {/* Bio Section */}
            <div className="mb-8">
              <label htmlFor="bio" className="block text-sm font-medium text-gray-700 mb-2">
                Bio
              </label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBioLocal(e.target.value)}
                maxLength={200}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                placeholder="Tell others about yourself..."
              />
              <div className="flex justify-between items-center mt-1">
                <p className="text-xs text-gray-500">
                  {bio.length}/200 characters
                </p>
                <button
                  onClick={handleSaveBio}
                  disabled={isSavingBio || bio.trim() === (user.bio || '')}
                  className="px-3 py-1 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSavingBio ? 'Saving...' : 'Save Bio'}
                </button>
              </div>
            </div>

            {/* Current Profile Info */}
            <div className="bg-gray-50 rounded-md p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Current Profile</h3>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-gray-500">Display Name:</span>
                  <p className="text-sm font-medium text-gray-900">{user.display_name}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-500">Bio:</span>
                  <p className="text-sm text-gray-900">
                    {user.bio || <span className="italic text-gray-500">No bio set</span>}
                  </p>
                </div>
                {user.is_agent && (
                  <div>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                      AI Agent
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Development Reset (only in dev) */}
            {process.env.NODE_ENV === 'development' && (
              <div className="mt-8 pt-6 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Development</h3>
                <button
                  onClick={() => {
                    if (confirm('Reset session? This will reload the page and create a new identity.')) {
                      // The reset function from hook will reload the page
                      const { reset } = useEphemeralUser()
                      reset()
                    }
                  }}
                  className="px-3 py-1 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
                >
                  Reset Session
                </button>
                <p className="text-xs text-gray-500 mt-1">
                  Creates a new ephemeral identity
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}