// Admin API client functions
// Injects Authorization: Bearer token from localStorage

interface AdminApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

class AdminClient {
  private getAuthHeader(): string | null {
    const token = localStorage.getItem('adminToken')
    return token ? `Bearer ${token}` : null
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<AdminApiResponse<T>> {
    const authHeader = this.getAuthHeader()
    
    if (!authHeader) {
      return { success: false, error: 'Admin token not configured' }
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}`,
        }
      }

      return { success: true, data }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  // Trigger manual track generation
  async generate(): Promise<AdminApiResponse> {
    return this.request('/api/admin/generate', { method: 'POST' })
  }

  // Advance station manually
  async advance(): Promise<AdminApiResponse> {
    return this.request('/api/admin/advance', { method: 'POST' })
  }

  // Get current station state and queue
  async getState(): Promise<AdminApiResponse> {
    return this.request('/api/admin/state', { method: 'GET' })
  }

  // Skip a track (mark as DONE)
  async skipTrack(trackId: string): Promise<AdminApiResponse> {
    return this.request(`/api/admin/track/${trackId}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'skip' }),
    })
  }

  // Requeue a track (DONE/FAILED -> READY)
  async requeueTrack(trackId: string): Promise<AdminApiResponse> {
    return this.request(`/api/admin/track/${trackId}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'requeue' }),
    })
  }

  // Delete a track permanently
  async deleteTrack(trackId: string): Promise<AdminApiResponse> {
    return this.request(`/api/admin/track/${trackId}`, {
      method: 'DELETE',
    })
  }

  // Test admin token validity
  async testAuth(): Promise<boolean> {
    const result = await this.getState()
    return result.success
  }
}

export const adminApi = new AdminClient()