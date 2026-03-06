import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as postAnalysis } from '@/app/api/analysis/route'
import { POST as postReport } from '@/app/api/report/route'
import { GET as getRuns } from '@/app/api/runs/route'
import { GET as getStageGateDecisions } from '@/app/api/stage-gates/decisions/route'
import { ANALYSIS_QUERY_MAX_CHARS } from '@/lib/analysis/query'

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


  it('POST /api/analysis rejects query prompts above the max length with HTTP 400', async () => {
    const request = jsonRequest('http://localhost/api/analysis', {
      workspaceId: '00000000-0000-0000-0000-000000000000',
      queryText: 'x'.repeat(ANALYSIS_QUERY_MAX_CHARS + 1),
      corridorGeojson: {
        type: 'Polygon',
        coordinates: [
          [
            [-121.0, 39.0],
            [-121.0, 39.01],
            [-120.99, 39.01],
            [-120.99, 39.0],
            [-121.0, 39.0],
          ],
        ],
      },
    })

    const response = await postAnalysis(request)
    expect(response.status).toBe(400)

    const payload = (await response.json()) as { error?: string }
    expect(payload.error).toBe('Invalid input')
  })

  it('POST /api/analysis rejects corridor geometries outside WGS84 bounds with HTTP 400', async () => {
    const request = jsonRequest('http://localhost/api/analysis', {
      workspaceId: '00000000-0000-0000-0000-000000000000',
      queryText: 'test corridor',
      corridorGeojson: {
        type: 'Polygon',
        coordinates: [
          [
            [630000, 4340000],
            [631000, 4340000],
            [631000, 4341000],
            [630000, 4341000],
            [630000, 4340000],
          ],
        ],
      },
    })

    const response = await postAnalysis(request)
    expect(response.status).toBe(400)

    const payload = (await response.json()) as { error?: string }
    expect(payload.error).toBe('Invalid corridor geometry')
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

  it('GET /api/runs rejects invalid limit values with HTTP 400', async () => {
    const request = new NextRequest('http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111&limit=999')
    const response = await getRuns(request)

    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error?: string }
    expect(payload.error).toBe('Invalid limit')
  })

  it('GET /api/stage-gates/decisions rejects invalid query params with HTTP 400', async () => {
    const request = new NextRequest('http://localhost/api/stage-gates/decisions?workspaceId=bad-id')
    const response = await getStageGateDecisions(request)

    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error?: string }
    expect(payload.error).toBe('Invalid stage-gate decision query')
  })
})
