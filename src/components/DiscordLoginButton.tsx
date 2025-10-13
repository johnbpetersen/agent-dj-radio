import { apiFetch } from '../lib/api';

export default function DiscordLoginButton() {
  const start = async () => {
    try {
      const res = await apiFetch('/api/auth/discord/start', { method: 'POST' });
      // backend should return { redirectUrl } (or { url })
      const json = await res.json();
      const redirectUrl = json.redirectUrl || json.url;
      if (!res.ok || !redirectUrl) {
        console.error('Discord start failed:', json);
        alert(json?.message || 'Failed to start Discord login');
        return;
      }
      window.location.href = redirectUrl;
    } catch (e) {
      console.error('Discord start error', e);
      alert('Could not start Discord login');
    }
  };

  return (
    <button
      onClick={start}
      className="bg-[#5865F2] hover:brightness-110 text-white px-4 py-2 rounded-md"
      title="Sign in with Discord"
    >
      Sign in with Discord
    </button>
  );
}
