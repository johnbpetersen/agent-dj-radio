#!/usr/bin/env node

// Test range requests on audio URLs
const https = require('https');
const http = require('http');

async function testRangeSupport(url) {
  console.log(`\n🔍 Testing Range Support: ${url}`);
  
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    // Test range request
    const req = client.request(url, { 
      method: 'GET',
      headers: { 'Range': 'bytes=0-1' }
    }, (res) => {
      console.log(`📊 Range Request Status: ${res.statusCode} ${res.statusMessage}`);
      
      const important = {
        'accept-ranges': res.headers['accept-ranges'],
        'content-range': res.headers['content-range'], 
        'content-length': res.headers['content-length'],
        'content-type': res.headers['content-type'],
        'access-control-allow-origin': res.headers['access-control-allow-origin']
      };
      
      console.log('📋 Important Headers:');
      Object.entries(important).forEach(([key, value]) => {
        const status = value ? '✅' : '❌';
        console.log(`   ${status} ${key}: ${value || 'MISSING'}`);
      });
      
      // Analysis
      console.log('\n🔍 Analysis:');
      if (res.statusCode === 206) {
        console.log('✅ Range requests supported (206 Partial Content)');
      } else if (res.statusCode === 200) {
        console.log('❌ Range requests NOT supported (returned full file instead of range)');
      } else {
        console.log(`❌ Unexpected status: ${res.statusCode}`);
      }
      
      resolve(important);
    });
    
    req.on('error', (err) => {
      console.error('❌ Request failed:', err.message);
      reject(err);
    });
    
    req.end();
  });
}

// Test local file first
console.log('🧪 Testing Range Request Support...');

// If you have a real Supabase URL, replace this
const testUrl = process.argv[2] || 'http://localhost:5173/sample-track.wav';

testRangeSupport(testUrl)
  .then(() => {
    console.log('\n💡 To test your real Supabase URL:');
    console.log('   node test-range.cjs "https://your-supabase-url/audio.mp3"');
  })
  .catch(() => {
    console.log('🔧 Try with a real audio URL from your database');
  });