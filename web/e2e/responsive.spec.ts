import { type Page, expect, test } from '@playwright/test'

/**
 * Nothing leaves the window at any size: phone (portrait and on its side), tablet, small laptop, desktop.
 * At each size the page does not scroll sideways, the bars and panels stay inside the window, and a menu opened
 * from the tool bar (the mission filters, the widest one) is moved and capped to fit.
 */
const SIZES = [
  { name: 'small phone', width: 320, height: 640 },
  { name: 'phone', width: 375, height: 812 },
  { name: 'phone on its side', width: 812, height: 375 },
  { name: 'tablet', width: 820, height: 1100 },
  { name: 'small laptop', width: 1024, height: 700 },
  { name: 'desktop', width: 1440, height: 900 },
]

/** Visible elements matching `selector` whose box crosses the left or right edge of the window. */
async function outside(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const w = document.documentElement.clientWidth
    return Array.from(document.querySelectorAll<HTMLElement>(sel))
      .filter((e) => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && (r.left < -1 || r.right > w + 1)
      })
      .map((e) => `${e.className} [${Math.round(e.getBoundingClientRect().left)}..${Math.round(e.getBoundingClientRect().right)}]`)
  }, selector)
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

for (const size of SIZES) {
  test(`the navigator fits a ${size.name} (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.goto('./')
    await expect(page.getByRole('application', { name: 'The Moon' })).toBeVisible()
    const parts = '.topbar, .topbar nav a, .bar-tools > *, .where-when > *, .toolstrip button, .float-bottom, .globe-caption'
    expect(await noSidewaysScroll(page)).toBe(true)
    expect(await outside(page, parts)).toEqual([])

    // a section opens beside the map (or under it on a phone) without pushing anything out
    await page.getByRole('button', { name: 'Power' }).click()
    await expect(page.locator('.side-panel')).toBeVisible()
    expect(await noSidewaysScroll(page)).toBe(true)
    expect(await outside(page, `${parts}, .side-panel, .side-panel .stat`)).toEqual([])

    // the widest menu of the tool bar stays inside the window, in both directions
    await page.getByRole('radio', { name: 'Mission' }).click()
    await page.getByRole('button', { name: 'Mission filters' }).click()
    const panel = page.locator('.mission-pop .pop-panel')
    await expect(panel).toBeVisible()
    const box = (await panel.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(size.width)
    expect(box.y + box.height).toBeLessThanOrEqual(size.height)
  })
}

for (const size of [SIZES[0], SIZES[1], SIZES[3], SIZES[5]]) {
  test(`Educational mode fits a ${size.name} (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.goto('./')
    await page.getByRole('switch', { name: /Educational/ }).click()
    const card = page.locator('.blk-story')
    await expect(card).toBeVisible({ timeout: 20_000 })
    const parts = '.topbar, .where-when > *, .toolstrip button, .blk-sky, .blk-bottom, .blk-story, .blk-mission'
    expect(await noSidewaysScroll(page)).toBe(true)
    expect(await outside(page, parts)).toEqual([])

    // a mission's story: the picture strip and the big button stay inside the card, which never scrolls sideways
    await page.locator('.blk-mission').first().click()
    await expect(page.locator('.blk-strip')).toBeVisible()
    expect(await noSidewaysScroll(page)).toBe(true)
    expect(await outside(page, `${parts}, .blk-strip li, .blk-big`)).toEqual([])
    expect(await card.evaluate((e) => getComputedStyle(e).overflowX)).toBe('hidden')
    const strip = await page.locator('.blk-strip li').evaluateAll((items) => items.map((e) => e.scrollWidth <= e.clientWidth + 1))
    expect(strip).not.toContain(false)
  })
}

test('the text pages fit a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  for (const path of ['./#/data', './#/learn']) {
    await page.goto(path)
    await expect(page.locator('.page h1')).toBeVisible()
    expect(await noSidewaysScroll(page)).toBe(true)
    expect(await outside(page, '.topbar, .topbar nav a, .page > *')).toEqual([])
  }
})
