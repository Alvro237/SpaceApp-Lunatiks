import { describe, expect, it } from 'vitest'
import { cameraFor, compass16, earthPhase, project, separation, tickStep, unproject, wrap180 } from './project'

describe('horizon view projection', () => {
  const cam = cameraFor(90, 5, 80, 800, 400, 300) // 0.1 degree per pixel, looking east at 5° up

  it('puts the camera direction at the centre and keeps one scale across and up', () => {
    expect(project(cam, 90, 5)).toEqual({ x: 400, y: 300 })
    expect(project(cam, 100, 5).x).toBeCloseTo(500, 9) // 10° right
    expect(project(cam, 90, 15).y).toBeCloseTo(200, 9) // 10° up
  })

  it('takes the short way round north', () => {
    const north = cameraFor(350, 0, 80, 800, 400, 300)
    expect(project(north, 10, 0).x).toBeCloseTo(600, 9) // 20° to the right, not 340° to the left
    expect(wrap180(190)).toBe(-170)
    expect(wrap180(-180)).toBe(180)
  })

  it('unprojects back to the same direction', () => {
    const p = project(cam, 123.4, -2.5)
    const d = unproject(cam, p.x, p.y)
    expect(d.az).toBeCloseTo(123.4, 9)
    expect(d.el).toBeCloseTo(-2.5, 9)
  })
})

describe('Earth phase seen from the Moon', () => {
  it('is full with the Sun opposite and new with the Sun beside it', () => {
    expect(earthPhase({ az: 270, el: 0 }, { az: 90, el: 0 }).lit).toBeCloseTo(1, 9)
    expect(earthPhase({ az: 90, el: 0.5 }, { az: 90, el: 0 }).lit).toBeLessThan(0.0001)
    expect(earthPhase({ az: 0, el: 0 }, { az: 90, el: 0 }).lit).toBeCloseTo(0.5, 9) // quarter
  })

  it('turns the bright limb towards the Sun', () => {
    // Sun to the right of the Earth on the horizon: bright limb at +90° (right)
    expect(earthPhase({ az: 120, el: 0 }, { az: 90, el: 0 }).brightLimbDeg).toBeCloseTo(90, 6)
    // Sun straight above: bright limb up (0°)
    expect(earthPhase({ az: 90, el: 40 }, { az: 90, el: 10 }).brightLimbDeg).toBeCloseTo(0, 6)
  })

  it('measures separations on the sphere', () => {
    expect(separation(0, 0, 90, 0)).toBeCloseTo(90, 9)
    expect(separation(10, 89, 190, 89)).toBeCloseTo(2, 6) // across the zenith
  })
})

describe('labels and ticks', () => {
  it('names 16 compass points and picks readable tick steps', () => {
    expect(compass16(0)).toBe('N')
    expect(compass16(135)).toBe('SE')
    expect(compass16(359)).toBe('N')
    expect(tickStep(0.1)).toBe(10)
    expect(tickStep(0.01)).toBe(1)
  })
})
