import { describe, expect, it } from 'vitest'
import { advance, formatDuration, formatUtc, isoMinute } from './clock'

const H = 3_600_000
const bounds: [number, number] = [0, 1000 * H]

describe('playback clock', () => {
  it('advances by speed × real time', () => {
    expect(advance(0, 500, '6h', bounds, false)).toEqual({ tMs: 3 * H, ended: false })
    expect(advance(0, 1000, '1d', bounds, false).tMs).toBe(24 * H)
  })

  it('jumps 6 hours per tick with reduced motion, whatever the speed', () => {
    expect(advance(0, 16, '1h', bounds, true).tMs).toBe(6 * H)
  })

  it('stops at the end of the tables', () => {
    expect(advance(999 * H, 1000, '1d', bounds, false)).toEqual({ tMs: 1000 * H, ended: true })
  })
})

describe('formatting', () => {
  it('countdowns and UTC labels', () => {
    expect(formatDuration(3 * 86_400_000 + 4 * H + 5 * 60_000)).toBe('3 d 4 h 05 min')
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min')
    expect(formatDuration(59_000)).toBe('1 min')
    const t = Date.parse('2027-01-01T12:00:29Z')
    expect(formatUtc(t)).toBe('2027-01-01 12:00 UTC')
    expect(isoMinute(t)).toBe('2027-01-01T12:00:00Z')
  })
})
