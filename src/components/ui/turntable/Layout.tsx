import { useState, useEffect } from 'react'
import { useStation } from '../../../hooks/useStation'
import TopNav from './TopNav'
import Stage from './Stage'
import ReactionBar from './ReactionBar'
import QueuePanel from './QueuePanel'
import AudienceWall from './AudienceWall'
import SubmitForm from '../../SubmitForm'

export default function Layout() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [showSubmitForm, setShowSubmitForm] = useState(false)
  const { currentTrack, playheadSeconds, queue, isLoading, error, refetch } = useStation()

  // Set up a temporary user ID for reactions if we don't have one
  // This mimics the behavior from the original App component
  useEffect(() => {
    if (!currentUserId) {
      // Generate a temporary ID - in a real app this would come from auth
      const tempId = `temp-${Math.random().toString(36).substr(2, 9)}`
      setCurrentUserId(tempId)
    }
  }, [currentUserId])

  const handleSubmitSuccess = () => {
    setShowSubmitForm(false)
    refetch()
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="text-red-400 text-5xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-white mb-4">Connection Error</h2>
          <p className="text-white/70 mb-6">{error}</p>
          <button
            onClick={refetch}
            className="
              bg-gradient-to-r from-blue-500 to-purple-600 
              hover:from-blue-600 hover:to-purple-700
              text-white font-bold px-6 py-3 rounded-xl
              shadow-lg border border-white/20
              transition-all duration-200
            "
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Submit Form Modal */}
      {showSubmitForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-card p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Queue a Track</h2>
              <button
                onClick={() => setShowSubmitForm(false)}
                className="text-white/60 hover:text-white p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <SubmitForm onSubmitSuccess={handleSubmitSuccess} />
          </div>
        </div>
      )}

      {/* Main Layout */}
      <div className="flex flex-col min-h-screen">
        {/* Top Navigation */}
        <TopNav 
          onQueueTrack={() => setShowSubmitForm(true)}
          className="sticky top-0 z-40"
        />
        
        {/* Main Content Area */}
        <div className="flex-1 p-4 md:p-6">
          {/* Desktop Layout: 3-column */}
          <div className="hidden lg:grid lg:grid-cols-12 gap-6 h-full">
            {/* Left Sidebar - Audience Wall */}
            <div className="col-span-3">
              <AudienceWall 
                queue={queue}
                currentTrack={currentTrack}
                className="h-full"
              />
            </div>
            
            {/* Center - Main Stage */}
            <div className="col-span-6 space-y-6">
              <Stage 
                track={currentTrack}
                playheadSeconds={playheadSeconds}
                isLoading={isLoading}
              />
              
              <ReactionBar
                track={currentTrack}
                userId={currentUserId}
                onReactionSuccess={refetch}
              />
            </div>
            
            {/* Right Sidebar - Queue Panel */}
            <div className="col-span-3">
              <QueuePanel 
                queue={queue}
                isLoading={isLoading}
                className="h-full"
              />
            </div>
          </div>
          
          {/* Tablet Layout: 2-column */}
          <div className="hidden md:grid lg:hidden md:grid-cols-8 gap-6">
            {/* Left - Stage + Reactions */}
            <div className="col-span-5 space-y-6">
              <Stage 
                track={currentTrack}
                playheadSeconds={playheadSeconds}
                isLoading={isLoading}
              />
              
              <ReactionBar
                track={currentTrack}
                userId={currentUserId}
                onReactionSuccess={refetch}
              />
            </div>
            
            {/* Right - Queue + Audience */}
            <div className="col-span-3 space-y-6">
              <QueuePanel 
                queue={queue}
                isLoading={isLoading}
              />
              
              <AudienceWall 
                queue={queue}
                currentTrack={currentTrack}
              />
            </div>
          </div>
          
          {/* Mobile Layout: Stacked */}
          <div className="md:hidden space-y-6">
            {/* Stage - Hero section */}
            <Stage 
              track={currentTrack}
              playheadSeconds={playheadSeconds}
              isLoading={isLoading}
            />
            
            {/* Reaction Bar */}
            <ReactionBar
              track={currentTrack}
              userId={currentUserId}
              onReactionSuccess={refetch}
            />
            
            {/* Queue Panel - Collapsible */}
            <QueuePanel 
              queue={queue}
              isLoading={isLoading}
            />
            
            {/* Audience Wall - Bottom */}
            <AudienceWall 
              queue={queue}
              currentTrack={currentTrack}
            />
          </div>
        </div>
        
        {/* Footer */}
        <footer className="glass-card-dark mt-8">
          <div className="px-6 py-4 text-center">
            <div className="text-white/40 text-sm">
              <p>Agent DJ Radio - Powered by AI ✨</p>
              {currentUserId && (
                <p className="mt-1 text-xs">
                  Session ID: {currentUserId.slice(-8)}
                </p>
              )}
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}