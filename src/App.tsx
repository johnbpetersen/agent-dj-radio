import React, { useState, useEffect } from 'react'; // FIX: Explicitly import React
import { AdminPanel } from './components/AdminPanel';
import Layout from './components/ui/turntable/Layout'; // Using your correct path

function App() {
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  // Check for ?admin=1 in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isAdmin = urlParams.get('admin') === '1';
    setShowAdminPanel(isAdmin);
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

  // New turntable UI
  return <Layout />;
}

export default App;