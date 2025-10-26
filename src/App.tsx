import { useState, useEffect } from 'react'
import { AdminPanel } from './components/AdminPanel';
import { AccountLinkingCard } from './components/AccountLinkingCard';
import Layout from './components/ui/turntable/Layout'; // Using your correct path

function App() {
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [callbackMessage, setCallbackMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Check for query params in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isAdmin = urlParams.get('admin') === '1';
    const isAccount = urlParams.get('account') === '1';
    const discordLinked = urlParams.get('discord_linked') === '1';
    const discordError = urlParams.get('discord_error');

    setShowAdminPanel(isAdmin);
    setShowAccountPanel(isAccount);

    // Handle Discord OAuth callback
    if (discordLinked) {
      setCallbackMessage({ type: 'success', text: 'Discord linked successfully!' });
      // Clean up URL
      urlParams.delete('discord_linked');
      const newUrl = `${window.location.pathname}${urlParams.toString() ? '?' + urlParams.toString() : ''}`;
      window.history.replaceState({}, '', newUrl);
      // Auto-clear message after 5 seconds
      setTimeout(() => setCallbackMessage(null), 5000);
    } else if (discordError) {
      setCallbackMessage({ type: 'error', text: `Discord error: ${discordError}` });
      // Clean up URL
      urlParams.delete('discord_error');
      const newUrl = `${window.location.pathname}${urlParams.toString() ? '?' + urlParams.toString() : ''}`;
      window.history.replaceState({}, '', newUrl);
      // Auto-clear message after 10 seconds
      setTimeout(() => setCallbackMessage(null), 10000);
    }
  }, []);

  // Admin panel view
  if (showAdminPanel) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-6">
            <button
              onClick={() => {
                setShowAdminPanel(false);
                // Remove ?admin=1 from URL
                const url = new URL(window.location.href);
                url.searchParams.delete('admin');
                window.history.replaceState({}, '', url.toString());
              }}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              ← Back to Radio
            </button>
          </div>

          <AdminPanel />
        </div>
      </div>
    );
  }

  // Account panel view
  if (showAccountPanel) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-6">
            <button
              onClick={() => {
                setShowAccountPanel(false);
                // Remove ?account=1 from URL
                const url = new URL(window.location.href);
                url.searchParams.delete('account');
                window.history.replaceState({}, '', url.toString());
              }}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              ← Back to Radio
            </button>
          </div>

          {/* Callback message banner */}
          {callbackMessage && (
            <div className={`mb-6 p-4 rounded ${
              callbackMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {callbackMessage.text}
            </div>
          )}

          <AccountLinkingCard />
        </div>
      </div>
    );
  }

  // New turntable UI
  return (
    <>
      {/* Callback message banner (overlay on main UI) */}
      {callbackMessage && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded shadow-lg ${
          callbackMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {callbackMessage.text}
        </div>
      )}
      <Layout />
    </>
  );
}

export default App;