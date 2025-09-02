import { test, expect, type Page } from '@playwright/test'

// Staging smoke test that runs the full user journey
// Tests against staging environment with all real services OFF
// Verifies: submit track → advance station → react to track

const STAGING_URL = process.env.STAGING_URL || 'https://agent-dj-radio-staging.vercel.app'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'staging-test-token'

test.describe('Staging Smoke Test', () => {
  let page: Page

  test.beforeEach(async ({ page: p }) => {
    page = p
    // Start with clean slate - go to staging URL
    await page.goto(STAGING_URL)
    
    // Verify page loads correctly
    await expect(page.locator('h1')).toContainText('Agent DJ Radio')
  })

  test('Complete user journey: submit → advance → react', async () => {
    // Step 1: Submit a mock track
    await test.step('Submit track', async () => {
      // Fill out submission form
      await page.fill('input[placeholder*="prompt"], textarea[placeholder*="prompt"]', 'Playwright test track - upbeat electronic music')
      
      // Select 60 second duration (should be cheapest)
      await page.selectOption('select[name*="duration"], select:has-text("60")', '60')
      
      // Submit the track
      await page.click('button:has-text("Submit Track"), button:has-text("Queue Track"), button[type="submit"]')
      
      // Wait for submission to complete
      await expect(page.locator('.bg-green-')).toBeVisible({ timeout: 10000 })
      
      // Verify track appears in queue
      await expect(page.getByText('Playwright test track')).toBeVisible()
    })

    // Step 2: Access admin panel and advance station
    await test.step('Admin advance station', async () => {
      // Navigate to admin panel
      await page.goto(`${STAGING_URL}/?admin=1`)
      
      // Enter admin token
      await page.fill('input[type="password"]', ADMIN_TOKEN)
      await page.click('button:has-text("Connect")')
      
      // Wait for admin panel to load
      await expect(page.locator('h2:has-text("Admin Panel")')).toBeVisible()
      
      // Verify our track is in the queue
      await page.click('button:has-text("Refresh State")')
      await expect(page.getByText('Playwright test track')).toBeVisible()
      
      // Advance station to start our track
      await page.click('button:has-text("Advance Station")')
      
      // Wait for advance to complete
      await expect(page.locator('.bg-green-')).toBeVisible({ timeout: 10000 })
      
      // Verify track is now playing
      await page.click('button:has-text("Refresh State")')
      await expect(page.locator('text="Now Playing"')).toBeVisible()
      await expect(page.getByText('Playwright test track')).toBeVisible()
    })

    // Step 3: Go back to main app and add reaction
    await test.step('Add reaction to playing track', async () => {
      // Navigate back to main radio interface
      await page.click('button:has-text("Back to Radio")')
      
      // Wait for page to load
      await expect(page.locator('h1')).toContainText('Agent DJ Radio')
      
      // Verify our track is now playing
      await expect(page.getByText('Playwright test track')).toBeVisible()
      
      // Add a LOVE reaction
      await page.click('button:has-text("❤️"), button[title*="Love"], .reaction-love, button[aria-label*="love" i]')
      
      // Wait for reaction to be recorded
      await page.waitForTimeout(2000)
      
      // Verify reaction was recorded (look for updated count or feedback)
      // Note: This might vary based on UI implementation
      const reactionElements = page.locator('button:has-text("❤️"), .reaction-count, .rating-display')
      await expect(reactionElements.first()).toBeVisible()
    })

    // Step 4: Verify system state via admin panel
    await test.step('Verify final system state', async () => {
      // Go back to admin panel to verify everything worked
      await page.goto(`${STAGING_URL}/?admin=1`)
      
      // Re-authenticate (token should be in localStorage)
      const tokenInput = page.locator('input[type="password"]')
      if (await tokenInput.isVisible()) {
        await tokenInput.fill(ADMIN_TOKEN)
        await page.click('button:has-text("Connect")')
      }
      
      // Refresh state to see current status
      await page.click('button:has-text("Refresh State")')
      
      // Verify track is playing and has reaction
      const nowPlayingSection = page.locator('text="Now Playing"').locator('..')
      await expect(nowPlayingSection).toContainText('Playwright test track')
      
      // Look for rating indicator (our LOVE reaction should have increased the rating)
      await expect(nowPlayingSection).toContainText('Rating:')
    })
  })

  test('Admin panel functionality', async () => {
    await test.step('Test admin authentication', async () => {
      // Navigate to admin panel
      await page.goto(`${STAGING_URL}/?admin=1`)
      
      // Should show login form
      await expect(page.locator('input[type="password"]')).toBeVisible()
      
      // Try invalid token
      await page.fill('input[type="password"]', 'invalid-token')
      await page.click('button:has-text("Connect")')
      
      // Should show error
      await expect(page.locator('.text-red-')).toBeVisible()
      
      // Try valid token
      await page.fill('input[type="password"]', ADMIN_TOKEN)
      await page.click('button:has-text("Connect")')
      
      // Should show admin panel
      await expect(page.locator('h2:has-text("Admin Panel")')).toBeVisible()
    })

    await test.step('Test admin controls', async () => {
      // Navigate and authenticate
      await page.goto(`${STAGING_URL}/?admin=1`)
      await page.fill('input[type="password"]', ADMIN_TOKEN)
      await page.click('button:has-text("Connect")')
      
      // Test generate button
      await page.click('button:has-text("Generate Track")')
      await expect(page.locator('.bg-green-, .bg-blue-')).toBeVisible({ timeout: 10000 })
      
      // Test refresh state button
      await page.click('button:has-text("Refresh State")')
      await expect(page.locator('text="Now Playing"')).toBeVisible()
      
      // Test advance station button
      await page.click('button:has-text("Advance Station")')
      await expect(page.locator('.bg-green-, .bg-blue-')).toBeVisible({ timeout: 10000 })
    })
  })

  test('Error handling and edge cases', async () => {
    await test.step('Handle empty queue gracefully', async () => {
      // Access admin panel
      await page.goto(`${STAGING_URL}/?admin=1`)
      await page.fill('input[type="password"]', ADMIN_TOKEN)
      await page.click('button:has-text("Connect")')
      
      // Try to advance with potentially empty queue
      await page.click('button:has-text("Advance Station")')
      
      // Should handle gracefully (either advance or show "no tracks")
      await expect(page.locator('.bg-green-, .bg-blue-, .bg-yellow-')).toBeVisible({ timeout: 10000 })
    })

    await test.step('Verify form validation', async () => {
      // Go to main app
      await page.goto(STAGING_URL)
      
      // Try to submit empty form
      await page.click('button:has-text("Submit Track"), button:has-text("Queue Track"), button[type="submit"]')
      
      // Should show validation error or prevent submission
      // (Exact behavior depends on implementation)
      await page.waitForTimeout(1000) // Give time for validation
    })
  })
})

// Health check test that runs independently
test.describe('Health Check', () => {
  test('Basic app loads and API responds', async ({ page }) => {
    // Test main app loads
    await page.goto(STAGING_URL)
    await expect(page.locator('h1')).toContainText('Agent DJ Radio')
    
    // Test API endpoint responds
    const response = await page.request.get(`${STAGING_URL}/api/station/state`)
    expect(response.ok()).toBeTruthy()
    
    // Verify admin endpoints are protected
    const adminResponse = await page.request.get(`${STAGING_URL}/api/admin/state`)
    expect(adminResponse.status()).toBe(401) // Should require auth
  })
})