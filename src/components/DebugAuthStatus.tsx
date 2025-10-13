import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

type SessionHello = {
  isDiscordLinked?: boolean
  isWalletLinked?: boolean
  user?: { id?: string; name?: string } | null
}

export default function DebugAuthStatus() {
  const [data, setData] = useState<SessionHello | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/api/session/hello', {
          method: 'POST',
          body: JSON.stringify({})
        })
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e))
      }
    })()
    return () => { cancelled = true }
  }, [])

  const startDiscord = async () => {
    try {
      const res = await apiFetch('/api/auth/discord/start', { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.redirectUrl) {
        console.error('Discord start failed:', json)
        return
      }
      window.location.href = json.redirectUrl
    } catch (e) {
      console.error('Discord start error', e)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        right: 10,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '8px 10px',
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <div style={{ marginBottom: 6, opacity: 0.8 }}>auth debug</div>
      {err && <div style={{ color: '#fca5a5' }}>err: {err}</div>}
      <pre style={{ margin: 0, maxWidth: 280, whiteSpace: 'pre-wrap' }}>
        {JSON.stringify(data ?? { loading: true }, null, 2)}
      </pre>
      {(!data || !data.isDiscordLinked) && (
        <button
          onClick={startDiscord}
          style={{
            marginTop: 8,
            background: '#5865F2',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.15)',
            cursor: 'pointer'
          }}
        >
          Sign in with Discord
        </button>
      )}
    </div>
  )
}
