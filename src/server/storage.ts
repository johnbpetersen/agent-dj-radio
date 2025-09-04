// Supabase Storage operations for audio files

import { supabaseAdmin } from '../../api/_shared/supabase.js'

const TRACKS_BUCKET = 'tracks'

export interface UploadAudioParams {
  trackId: string
  audioBuffer: Buffer
}

export interface UploadAudioResult {
  publicUrl: string
  path: string
}

/**
 * Upload audio buffer to Supabase Storage
 */
export async function uploadAudioBuffer({ trackId, audioBuffer }: UploadAudioParams): Promise<UploadAudioResult> {
  if (!trackId) {
    throw new Error('Track ID is required')
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Audio buffer is empty')
  }

  const path = `${trackId}.mp3`
  
  const { data, error } = await supabaseAdmin.storage
    .from(TRACKS_BUCKET)
    .upload(path, audioBuffer, {
      contentType: 'audio/mpeg',
      cacheControl: '3600', // 1 hour cache
      upsert: true // Allow overwriting
    })

  if (error) {
    throw new Error(`Failed to upload audio: ${error.message}`)
  }

  const publicUrl = getPublicUrl(path)
  
  return {
    publicUrl,
    path: data.path
  }
}

/**
 * Get public URL for a stored track
 */
export function getPublicUrl(path: string): string {
  const { data } = supabaseAdmin.storage
    .from(TRACKS_BUCKET)
    .getPublicUrl(path)
  
  return data.publicUrl
}

/**
 * Delete audio file from storage
 */
export async function deleteAudio(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(TRACKS_BUCKET)
    .remove([path])

  if (error) {
    console.error('Failed to delete audio:', error)
    // Don't throw - deletion failures shouldn't break the flow
  }
}

/**
 * Ensure tracks bucket exists and is properly configured
 */
export async function ensureTracksBucket(): Promise<void> {
  // Check if bucket exists
  const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets()
  
  if (listError) {
    throw new Error(`Failed to list buckets: ${listError.message}`)
  }

  const tracksBucket = buckets.find(bucket => bucket.name === TRACKS_BUCKET)
  
  if (!tracksBucket) {
    // Create bucket if it doesn't exist
    const { error: createError } = await supabaseAdmin.storage.createBucket(TRACKS_BUCKET, {
      public: true,
      allowedMimeTypes: ['audio/mpeg', 'audio/mp3'],
      fileSizeLimit: 50 * 1024 * 1024, // 50MB limit
    })
    
    if (createError) {
      throw new Error(`Failed to create tracks bucket: ${createError.message}`)
    }
    
    console.log('Created tracks storage bucket')
  }
}