#!/usr/bin/env node

// Quick script to test Supabase Storage headers
const https = require('https')
const http = require('http')

async function testHeaders(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    
    const req = client.request(url, { method: 'HEAD' }, (res) => {
      console.log(`\n🔍 Testing URL: ${url}`)
      console.log(`📊 Status: ${res.statusCode} ${res.statusMessage}`)
      console.log(`📋 Headers:`)
      
      Object.entries(res.headers).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`)
      })
      
      // Check for range support
      const acceptRanges = res.headers['accept-ranges']
      const contentLength = res.headers['content-length']
      const contentType = res.headers['content-type']
      const cors = res.headers['access-control-allow-origin']
      
      console.log(`\n✅ Analysis:`)
      console.log(`   Range Support: ${acceptRanges === 'bytes' ? '✅ YES' : '❌ NO'} (${acceptRanges || 'none'})`)
      console.log(`   Content-Length: ${contentLength ? '✅ YES' : '❌ NO'} (${contentLength || 'missing'})`)
      console.log(`   Content-Type: ${contentType ? '✅ YES' : '❌ NO'} (${contentType || 'missing'})`)
      console.log(`   CORS: ${cors ? '✅ YES' : '❌ NO'} (${cors || 'missing'})`)
      
      resolve({ acceptRanges, contentLength, contentType, cors })
    })
    
    req.on('error', reject)
    req.end()
  })
}

// Test with a sample Supabase URL (replace with real URL)
const sampleUrl = 'https://tdpjxzwhgvfctfhttqrf.supabase.co/storage/v1/object/public/tracks/sample.mp3'

console.log('🧪 Testing Supabase Storage Headers...')
testHeaders(sampleUrl)
  .then(() => {
    console.log('\n💡 If "Range Support" is NO, that could explain the timer stuttering!')
    console.log('💡 If CORS is missing, crossOrigin="anonymous" may fail')
  })
  .catch(err => {
    console.error('❌ Test failed:', err.message)
    console.log('🔧 Try running this with a real audio URL from your database')
  })