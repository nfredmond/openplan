import { describe, expect, it } from 'vitest'
import { validateCorridorGeometry } from '@/lib/geo/corridor-geometry'

describe('corridor geometry validator', () => {
  it('accepts a closed WGS84 polygon ring', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-121.0812, 39.2019] as [number, number],
          [-121.0478, 39.2019] as [number, number],
          [-121.0478, 39.2197] as [number, number],
          [-121.0812, 39.2197] as [number, number],
          [-121.0812, 39.2019] as [number, number],
        ],
      ],
    }

    const result = validateCorridorGeometry(geometry)
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('rejects projected/easting-northing style coordinates', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [630000, 4340000] as [number, number],
          [631000, 4340000] as [number, number],
          [631000, 4341000] as [number, number],
          [630000, 4341000] as [number, number],
          [630000, 4340000] as [number, number],
        ],
      ],
    }

    const result = validateCorridorGeometry(geometry)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.includes('outside WGS84 lon/lat bounds'))).toBe(true)
  })

  it('rejects non-closed polygon rings', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-121.0812, 39.2019] as [number, number],
          [-121.0478, 39.2019] as [number, number],
          [-121.0478, 39.2197] as [number, number],
          [-121.0812, 39.2197] as [number, number],
          [-121.0812, 39.2020] as [number, number],
        ],
      ],
    }

    const result = validateCorridorGeometry(geometry)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.includes('ring must be closed'))).toBe(true)
  })
})
