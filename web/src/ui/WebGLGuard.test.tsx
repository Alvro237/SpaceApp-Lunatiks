/**
 * Without WebGL the 3D views give way to a message instead of taking the whole page down with them.
 */
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebGLGuard } from './WebGLGuard'
import { resetWebglProbe, webglAvailable } from './webgl'

function stubContext(ok: boolean) {
  const lose = vi.fn()
  const ctx = ok ? { getExtension: () => ({ loseContext: lose }) } : null
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext)
  return lose
}

function Throws(): never {
  throw new Error('Error creating WebGL context.')
}

const view = (child: ReactNode) =>
  render(
    <MemoryRouter>
      <WebGLGuard what="3D globe">{child}</WebGLGuard>
    </MemoryRouter>,
  )

describe('WebGLGuard', () => {
  beforeEach(() => resetWebglProbe())
  afterEach(() => vi.restoreAllMocks())

  it('draws the view when WebGL is available, and releases the probe context', () => {
    const lose = stubContext(true)
    view(<div role="img" aria-label="globe canvas" />)
    expect(screen.getByRole('img', { name: 'globe canvas' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(lose).toHaveBeenCalledOnce()
  })

  it('shows a message and a way to the method page when WebGL is missing', () => {
    stubContext(false)
    view(<div role="img" aria-label="globe canvas" />)
    expect(screen.queryByRole('img', { name: 'globe canvas' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('cannot draw the 3D globe')
    expect(screen.getByRole('link', { name: 'Data & methods' })).toHaveAttribute('href', '/data')
  })

  it('catches a renderer that fails to start and keeps the rest of the page', () => {
    stubContext(true)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <MemoryRouter>
        <p>Panels</p>
        <WebGLGuard what="3D globe">
          <Throws />
        </WebGLGuard>
      </MemoryRouter>,
    )
    expect(screen.getByText('Panels')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('could not be drawn')
    expect(log).toHaveBeenCalled()
  })

  it('probes once', () => {
    stubContext(false)
    expect(webglAvailable()).toBe(false)
    stubContext(true)
    expect(webglAvailable()).toBe(false)
    resetWebglProbe()
    expect(webglAvailable()).toBe(true)
  })
})
