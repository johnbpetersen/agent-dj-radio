import { useState, useEffect } from 'react'
import { useEphemeralUser } from '../hooks/useEphemeralUser'

interface ProfileDrawerProps {
  isOpen: boolean
  onClose: () => void
}

// This component is now styled for our dark, immersive theme.
export default function ProfileDrawer({ isOpen, onClose }: ProfileDrawerProps) {
  const { user, rename, setBio, loading, error: hookError } = useEphemeralUser()
  
  const [displayName, setDisplayName] = useState('')
  const [bioText, setBioText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name)
      setBioText(user.bio || '')
    }
  }, [user])

  useEffect(() => {
    if (isOpen) {
      setError(null)
      setSuccessMessage(null)
    }
  }, [isOpen])

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    setSuccessMessage(null)

    let success = true
    if (displayName.trim() !== user?.display_name) {
      success = await rename(displayName.trim())
    }
    if (success && bioText.trim() !== (user?.bio || '')) {
      success = await setBio(bioText.trim())
    }

    if (success) {
      setSuccessMessage('Profile saved successfully!')
      setTimeout(() => {
        setSuccessMessage(null)
        onClose()
      }, 1500)
    } else {
      setError(hookError || 'An unknown error occurred.')
    }

    setIsSaving(false)
  }
  
  if (!isOpen) return null

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      
      <div className="fixed right-0 top-0 h-full w-96 bg-gray-900/80 backdrop-blur-md shadow-lg z-50 text-white flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-semibold">Edit Profile</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {loading || !user ? (
             <div className="text-center text-white/60">Loading Profile...</div>
          ) : (
            <>
              <div>
                <label htmlFor="displayName" className="block text-sm font-medium text-white/80 mb-2">Display Name</label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={30}
                  className="w-full px-3 py-2 bg-black/30 border border-white/20 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="bio" className="block text-sm font-medium text-white/80 mb-2">Bio</label>
                <textarea
                  id="bio"
                  value={bioText}
                  onChange={(e) => setBioText(e.target.value)}
                  maxLength={200}
                  rows={4}
                  className="w-full px-3 py-2 bg-black/30 border border-white/20 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {error && <div className="bg-red-500/20 text-red-300 text-sm p-3 rounded-md">{error}</div>}
              {successMessage && <div className="bg-green-500/20 text-green-300 text-sm p-3 rounded-md">{successMessage}</div>}
            </>
          )}
        </div>

        <div className="p-6 border-t border-white/10">
          <button
            onClick={handleSave}
            disabled={isSaving || loading || !user}
            className="w-full px-4 py-3 bg-blue-500 text-white font-bold rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}