import React from 'react';

export default function DiscordLoginButton() {
  return (
    <button
      onClick={() => (window.location.href = '/api/auth/discord/start')}
      className="px-3 py-1 rounded bg-[#5865F2] text-white hover:opacity-90 text-sm"
      aria-label="Sign in with Discord"
    >
      Sign in with Discord
    </button>
  );
}
