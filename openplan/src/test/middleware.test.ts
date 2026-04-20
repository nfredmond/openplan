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

  it('redirects unauthenticated planning routes and preserves the full target path', async () => {
    updateSessionMock.mockResolvedValueOnce({
      response: NextResponse.next(),
      user: null,
    })

    const { proxy } = await import('@/proxy')
    const request = new NextRequest('http://localhost/projects?tab=active')
    const response = await proxy(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/sign-in')
    expect(response.headers.get('location')).toContain('redirect=%2Fprojects%3Ftab%3Dactive')
  })

  it('redirects unauthenticated grants requests to sign-in with the grants target preserved', async () => {
    updateSessionMock.mockResolvedValueOnce({
      response: NextResponse.next(),
      user: null,
    })

    const { proxy } = await import('@/proxy')
    const request = new NextRequest('http://localhost/grants?status=open')
    const response = await proxy(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/sign-in')
    expect(response.headers.get('location')).toContain('redirect=%2Fgrants%3Fstatus%3Dopen')
  })

  it('allows public routes through for unauthenticated visitors', async () => {
    updateSessionMock.mockResolvedValueOnce({
      response: NextResponse.next(),
      user: null,
    })

    const { proxy } = await import('@/proxy')
    const request = new NextRequest('http://localhost/pricing')
    const response = await proxy(request)

    expect(response.status).toBe(200)
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

  it('echoes an incoming x-request-id header on the response', async () => {
    updateSessionMock.mockResolvedValueOnce({
      response: NextResponse.next(),
      user: { id: 'user-1' },
    })

    const { proxy } = await import('@/proxy')
    const request = new NextRequest('http://localhost/dashboard', {
      headers: { 'x-request-id': 'upstream-fixed-id' },
    })
    const response = await proxy(request)

    expect(response.headers.get('x-request-id')).toBe('upstream-fixed-id')
  })

  it('generates a UUID x-request-id on the response when none is set', async () => {
    updateSessionMock.mockResolvedValueOnce({
      response: NextResponse.next(),
      user: { id: 'user-1' },
    })

    const { proxy } = await import('@/proxy')
    const request = new NextRequest('http://localhost/dashboard')
    const response = await proxy(request)

    const generated = response.headers.get('x-request-id')
    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('sets x-request-id on sign-in redirects too', async () => {
    updateSessionMock.mockResolvedValueOnce({
      response: NextResponse.next(),
      user: null,
    })

    const { proxy } = await import('@/proxy')
    const request = new NextRequest('http://localhost/dashboard', {
      headers: { 'x-request-id': 'redirect-correlation-id' },
    })
    const response = await proxy(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('x-request-id')).toBe('redirect-correlation-id')
  })
})
