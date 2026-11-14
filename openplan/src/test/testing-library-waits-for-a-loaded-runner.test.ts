import { getConfig } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

// The setup file raises Testing Library's async wait for every test. If it is
// removed, findBy and waitFor fall back to one second and fail on a busy CI
// runner (see src/test/setup.ts).
describe('Testing Library async waits', () => {
  it('waits five seconds before a findBy or waitFor gives up', () => {
    expect(getConfig().asyncUtilTimeout).toBe(5_000)
  })
})
