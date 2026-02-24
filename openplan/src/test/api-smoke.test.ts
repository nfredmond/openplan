import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as postAnalysis } from '@/app/api/analysis/route'
import { POST as postReport } from '@/app/api/report/route'
import { GET as getRuns } from '@/app/api/runs/route'

function jsonRequest(url: string, payload: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

describe('API smoke tests (validation + guard rails)', () => {
  it('POST /api/analysis rejects invalid payloads with HTTP 400', async () => {
    const request = jsonRequest('http://localhost/api/analysis', { foo: 'bar' })
    const response = await postAnalysis(request)

    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error?: string }
    expect(payload.error).toBe('Invalid input')
  })

  it('POST /api/report rejects invalid run IDs with HTTP 400', async () => {
    const request = jsonRequest('http://localhost/api/report', { runId: 'not-a-uuid' })
    const response = await postReport(request)

    expect(response.status).toBe(400)
  })

  it('GET /api/runs rejects invalid workspaceId with HTTP 400', async () => {
    const request = new NextRequest('http://localhost/api/runs?workspaceId=bad-id')
    const response = await getRuns(request)

    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error?: string }
    expect(payload.error).toBe('Invalid workspaceId')
  })
})
