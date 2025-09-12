// scripts/reconcile-tracks.ts
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // admin key
)

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!, // your Postgres connection string from Supabase
  ssl: { rejectUnauthorized: false }
})

async function listAll(prefix = ''): Promise<Set<string>> {
  const set = new Set<string>()
  let page = 0
  while (true) {
    const { data, error } = await supabase.storage.from('tracks').list(prefix, {
      limit: 1000,
      offset: page * 1000
    })
    if (error) throw error
    if (!data || data.length === 0) break
    for (const obj of data) {
      if (obj.name) set.add(obj.name) // e.g. "c4ee7d20-... .mp3"
    }
    if (data.length < 1000) break
    page++
  }
  return set
}

async function main() {
  const client = await pool.connect()
  try {
    const files = await listAll('')
    console.log(`Found ${files.size} objects in tracks bucket`)

    const { rows } = await client.query<{
      id: string
      status: string
      audio_url: string | null
    }>(`
      select id, status, audio_url
      from public.tracks
      where audio_url is not null
        and audio_url like '%/storage/v1/object/public/tracks/%'
    `)

    const missing: string[] = []
    for (const r of rows) {
      const filename = `${r.id}.mp3` // we always upload id.mp3
      if (!files.has(filename)) {
        missing.push(r.id)
      }
    }
    console.log(`Tracks referencing missing files: ${missing.length}`)

    if (missing.length) {
      // Mark BROKEN and null out URL so the client won't try to play it
      await client.query(
        `
        update public.tracks
           set status = 'BROKEN',
               broken_at = now(),
               broken_reason = 'storage_missing',
               audio_url = null
         where id = any($1::uuid[])
        `,
        [missing]
      )
      console.log(`Marked ${missing.length} tracks as BROKEN`)
    }

    // Optional: hard delete BROKEN older than 7 days and without reactions/plays
    // await client.query(`
    //   delete from public.tracks t
    //   where t.status = 'BROKEN'
    //     and t.broken_at < now() - interval '7 days'
    //     and not exists (select 1 from public.reactions r where r.track_id = t.id)
    // `)

  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})