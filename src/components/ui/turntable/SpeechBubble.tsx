// This is a new component for displaying the chat message bubble.
// It includes a little "tail" to point towards the avatar.
interface SpeechBubbleProps {
    message: string
    className?: string
  }
  
  export default function SpeechBubble({ message, className = '' }: SpeechBubbleProps) {
    return (
      <div
        className={`relative bg-gray-900/80 text-white text-sm px-3 py-2 rounded-lg shadow-lg animate-bounce-in ${className}`}
        style={{ animation: 'bounce-in 0.5s ease-out' }} // Re-using your bounce-in animation
      >
        {message}
        {/* The speech bubble tail */}
        <div className="absolute left-1/2 -bottom-2 w-0 h-0 border-l-8 border-l-transparent border-r-8 border-r-transparent border-t-8 border-t-gray-900/80" />
      </div>
    )
  }