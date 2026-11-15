import { describe, expect, it } from 'vitest'
import { loadNearFirst } from './nearFirst'

/** A load that resolves when the test says so. */
function deferred() {
  const started: string[] = []
  const pending = new Map<string, { ok: (v: string) => void; fail: (e: Error) => void }>()
  const load = (id: string) =>
    new Promise<string>((ok, fail) => {
      started.push(id)
      pending.set(id, { ok, fail })
    })
  const tick = () => new Promise((r) => setTimeout(r, 0))
  return { started, pending, load, tick }
}

describe('loadNearFirst', () => {
  it('starts the nearest pieces first, at most `concurrency` at a time', async () => {
    const d = deferred()
    const items = [
      { id: 'far', m: 9000 },
      { id: 'near', m: 10 },
      { id: 'mid', m: 500 },
      { id: 'feet', m: 0 },
    ]
    const done: string[] = []
    loadNearFirst(items, (i) => i.m, (i) => d.load(i.id), (i) => done.push(i.id), 2)
    expect(d.started).toEqual(['feet', 'near'])
    d.pending.get('near')!.ok('x')
    await d.tick()
    // one finished, the next nearest takes its place
    expect(d.started).toEqual(['feet', 'near', 'mid'])
    expect(done).toEqual(['near'])
    d.pending.get('feet')!.fail(new Error('HTTP 500'))
    await d.tick()
    expect(d.started).toEqual(['feet', 'near', 'mid', 'far'])
    expect(done).toEqual(['near', 'feet'])
  })

  it('reports a failed load as null and keeps going', async () => {
    const d = deferred()
    const got: (string | null)[] = []
    loadNearFirst(['a', 'b'], () => 0, (id) => d.load(id), (_, r) => got.push(r), 1)
    d.pending.get('a')!.fail(new Error('down'))
    await d.tick()
    d.pending.get('b')!.ok('B')
    await d.tick()
    expect(got).toEqual([null, 'B'])
  })

  it('keeps the caller order on equal distances', () => {
    const d = deferred()
    loadNearFirst(['heavy', 'light', 'lighter'], () => 1, (id) => d.load(id), () => {}, 3)
    expect(d.started).toEqual(['heavy', 'light', 'lighter'])
  })

  it('starts nothing more and reports nothing once cancelled', async () => {
    const d = deferred()
    const done: string[] = []
    const cancel = loadNearFirst(['a', 'b', 'c'], () => 0, (id) => d.load(id), (id) => done.push(id), 1)
    cancel()
    d.pending.get('a')!.ok('A')
    await d.tick()
    expect(d.started).toEqual(['a'])
    expect(done).toEqual([])
  })
})
