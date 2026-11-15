/**
 * Keeps the page usable on a browser that cannot draw WebGL (turned off by policy, no GPU in a virtual machine, a
 * driver on the block list, or a context that fails to start). Without it, React Three Fiber throws while creating
 * the renderer and the whole navigator unmounts, so a visitor sees a blank page. With it, only the drawing is
 * replaced by a message: the panels, the comparison, the timeline and the text pages keep working, because they
 * read the API and the browser engine, not the GPU.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { webglAvailable } from './webgl'

function NoWebGL({ what, reason }: { what: string; reason: 'unsupported' | 'failed' }) {
  return (
    <div className="map-loading no-webgl" role="status">
      <p>
        {reason === 'unsupported'
          ? `This browser cannot draw the ${what}: WebGL is turned off or not supported here.`
          : `The ${what} could not be drawn: the browser's WebGL failed to start.`}
      </p>
      <p>
        The panels, the comparison and the timeline still work. The method, the data and the validation are on the{' '}
        <Link to="/data">Data &amp; methods</Link> page. To see the 3D view, turn on hardware acceleration in the browser
        settings or open the page in another browser.
      </p>
    </div>
  )
}

class Boundary extends Component<{ what: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`WebGL view "${this.props.what}" failed`, error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.failed ? <NoWebGL what={this.props.what} reason="failed" /> : this.props.children
  }
}

/**
 * Wrap a `<Canvas>` (and only the canvas, so the controls and text around it stay). `what` names the view in the
 * message, for example "3D globe".
 */
export function WebGLGuard({ what, children }: { what: string; children: ReactNode }) {
  if (!webglAvailable()) return <NoWebGL what={what} reason="unsupported" />
  return <Boundary what={what}>{children}</Boundary>
}
