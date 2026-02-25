import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const updateSessionMock = vi.fn()

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: (...args: unknown[]) => updateSessionMock(...args),
}))

describe('proxy auth/session guard', () => {
  it('redirects unauthenticated dashboard requests to /sign-in', async () => {
    updateSessionMock.mockResolvedValueOnce({
      response: NextResponse.next(),
      user: null,
    })

    const { proxy } = await import('@/proxy')
    const request = new NextRequest('http://localhost/dashboard')
    const response = await proxy(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/sign-in')
    expect(response.headers.get('location')).toContain('redirect=%2Fdashboard')
  })

  it('allows authenticated dashboard requests through', async () => {
    updateSessionMock.mockResolvedValueOnce({
      response: NextResponse.next(),
      user: { id: 'user-1' },
    })

    const { proxy } = await import('@/proxy')
    const request = new NextRequest('http://localhost/dashboard')
    const response = await proxy(request)

    expect(response.status).toBe(200)
  })
})
