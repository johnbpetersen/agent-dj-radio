import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'

async function cleanupTestDataHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    console.log('Starting test data cleanup...')

    // Get all tracks to check what we have
    const { data: allTracks, error: fetchError } = await supabaseAdmin
      .from('tracks')
      .select('id, prompt, user_id, status, source, created_at')
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error('Error fetching tracks:', fetchError)
      res.status(500).json({ error: 'Failed to fetch tracks' })
      return
    }

    console.log(`Found ${allTracks?.length || 0} tracks in database`)
    
    // Identify test/mock tracks by their characteristics
    const testTracks = (allTracks || []).filter(track => 
      // Tracks with test-like IDs
      track.id.startsWith('test-track') ||
      // Tracks with mock user IDs
      track.user_id === 'mock-user' || track.user_id.startsWith('mock-user') ||
      // Tracks with specific test prompts we know about
      track.prompt.includes('Spanish guitar → deep jungle trance') ||
      track.prompt.includes('Uplifting synthwave interlude') ||
      // Tracks from manual source (likely test data)
      track.source === 'MANUAL'
    )

    console.log(`Identified ${testTracks.length} test tracks to remove:`)
    testTracks.forEach(track => {
      console.log(`  - ${track.id}: "${track.prompt}" (user: ${track.user_id}, source: ${track.source})`)
    })

    if (testTracks.length === 0) {
      console.log('No test tracks found to clean up')
      res.status(200).json({
        message: 'No test tracks found',
        removed: 0,
        remaining: allTracks?.length || 0
      })
      return
    }

    // Remove test tracks
    const testTrackIds = testTracks.map(t => t.id)
    const { error: deleteError } = await supabaseAdmin
      .from('tracks')
      .delete()
      .in('id', testTrackIds)

    if (deleteError) {
      console.error('Error deleting test tracks:', deleteError)
      res.status(500).json({ error: 'Failed to delete test tracks' })
      return
    }

    // Also remove any test users that might exist
    const testUserIds = [...new Set(testTracks.map(t => t.user_id))]
    console.log(`Removing test users: ${testUserIds.join(', ')}`)
    
    const { error: deleteUsersError } = await supabaseAdmin
      .from('users')
      .delete()
      .in('id', testUserIds)

    if (deleteUsersError) {
      console.warn('Error deleting test users (might not exist):', deleteUsersError)
    }

    // Reset station state to have no current track
    const { error: resetStationError } = await supabaseAdmin
      .from('station_state')
      .update({
        current_track_id: null,
        current_started_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1)

    if (resetStationError) {
      console.error('Error resetting station state:', resetStationError)
      res.status(500).json({ error: 'Failed to reset station state' })
      return
    }

    const remainingCount = (allTracks?.length || 0) - testTracks.length

    console.log(`Cleanup complete! Removed ${testTracks.length} test tracks, ${remainingCount} real tracks remaining`)

    res.status(200).json({
      message: 'Test data cleanup completed',
      removed: testTracks.length,
      removed_tracks: testTracks.map(t => ({
        id: t.id,
        prompt: t.prompt,
        user_id: t.user_id,
        source: t.source
      })),
      remaining: remainingCount
    })

  } catch (error) {
    console.error('Cleanup test data error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

export default secureHandler(cleanupTestDataHandler, securityConfigs.admin)