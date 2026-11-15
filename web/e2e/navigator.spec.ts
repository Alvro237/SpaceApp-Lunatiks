import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function mapStats(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'South pole map' }).click()
  await expect(page.locator('.map-stats')).toContainText('tiles drawn', { timeout: 20_000 })
  return page.locator('.map-stats').textContent()
}

test('the globe turns with the mouse and zooming in over the polar cap opens the map there', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && /shader|WebGL|THREE/i.test(m.text()) && errors.push(m.text()))
  await page.goto('./')
  const globe = page.getByRole('application', { name: 'The Moon' })
  await expect(globe).toBeVisible()
  await page.waitForTimeout(5000)
  await page.screenshot({ path: 'test-results/globe.png' })
  const box = (await globe.boundingBox())!
  await page.mouse.move(box.x + 700, box.y + 450)
  await page.mouse.down()
  await page.mouse.move(box.x + 760, box.y + 430, { steps: 5 })
  await page.mouse.up()
  await page.mouse.move(box.x + 760, box.y + 430)
  await page.mouse.down()
  await page.mouse.move(box.x + 700, box.y + 450, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  // a click on the surface marks that point; zooming in over the polar cap flies down into the map
  await page.mouse.move(720, 580) // inside the 60° S outline in the first view
  const map = page.getByRole('application', { name: 'South polar terrain map' })
  for (let i = 0; i < 20 && !(await map.isVisible()); i++) {
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(500)
  }
  await expect(map).toBeVisible({ timeout: 15_000 })
  expect(errors).toEqual([])
})

test('the terrain renders with WebGL and the Sun and Earth timeline is filled', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('./')
  await mapStats(page)
  // the place panel opens on demand; the timeline always says when the place is sunlit and sees the Earth
  await expect(page.getByRole('region', { name: 'Mission window and playback' })).toContainText(/Sunlit [\d.]+ %, Earth in view [\d.]+ %/)
  await page.locator('.map-view').screenshot({ path: 'test-results/map-2d.png' })
  // the map is not blank: count bright pixels in a screenshot (a WebGL canvas cannot be read back directly)
  const png = (await page.locator('.map-view canvas').screenshot()).toString('base64')
  const lit = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0, 64, 64)
    const d = ctx.getImageData(0, 0, 64, 64).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) n++
    return n
  }, png)
  expect(lit).toBeGreaterThan(50)
  expect(errors.filter((e) => /shader|WebGL|THREE/i.test(e))).toEqual([])
  // the first view is the whole polar disc; zooming in refines to finer tiles
  const wanted = () => page.evaluate(() => (window as unknown as { __terrain: { stats: { wanted: string[] } } }).__terrain.stats.wanted)
  const deepest = async () => Math.max(...(await wanted()).map((k) => Number(k.split('/')[0])))
  const before = await deepest()
  await page.getByRole('application', { name: 'South polar terrain map' }).focus()
  for (let i = 0; i < 6; i++) await page.keyboard.press('+')
  await page.waitForTimeout(2000)
  expect(await deepest()).toBeGreaterThan(before)
})

test('keyboard: the map zooms, tilts to 3D and Space plays', async ({ page }) => {
  await page.goto('./')
  await mapStats(page)
  const map = page.getByRole('application', { name: 'South polar terrain map' })
  await map.focus()
  await page.keyboard.press('+')
  await page.keyboard.press('t')
  await expect(page.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(1500)
  await page.locator('.map-view').screenshot({ path: 'test-results/map-3d.png' })
  const before = await page.locator('.tl-clock').textContent()
  await page.locator('body').press('Space')
  await page.waitForTimeout(1200)
  await page.locator('body').press('Space')
  expect(await page.locator('.tl-clock').textContent()).not.toEqual(before)
})

test('colour layers show their legend with values', async ({ page }) => {
  await page.goto('./')
  await mapStats(page)
  await page.getByRole('button', { name: 'Layers' }).click()
  await page.getByRole('radio', { name: /Mean sunlight/ }).check()
  await expect(page.locator('.legend-chip figcaption')).toContainText('PGDA')
  await page.waitForTimeout(1500)
  await page.locator('.map-view').screenshot({ path: 'test-results/map-sunlight-layer.png' })
})

for (const scheme of ['dark', 'light'] as const) {
  test(`axe in a real browser, ${scheme} scheme, including colour contrast`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    for (const path of ['./', 'map', './#/data', './#/learn']) {
      if (path === 'map') await page.getByRole('button', { name: 'South pole map' }).click()
      else await page.goto(path)
      await page.waitForTimeout(2500)
      const r = await new AxeBuilder({ page }).withTags(WCAG).analyze()
      expect(r.violations.map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    }
  })
}
