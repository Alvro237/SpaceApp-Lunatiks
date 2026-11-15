import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** Step title → the control its spotlight must surround (a sample across the bars). */
const TARGETS: Record<string, string> = {
  'Two ways to work': '.mode-switch',
  'Choose when': '.pill-btn',
  'Study the place': '.place-tools',
  'The timeline': '.navigator > .float-bottom',
  'Mission filters': 'button[aria-label="Mission filters"]',
  'Where the numbers come from': 'nav a[href$="data"]',
}

for (const scheme of ['dark', 'light'] as const) {
  test(`the tour spotlights each control, passes axe and ends on the full guide (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('./')
    await expect(page.locator('.place-tools')).toBeVisible({ timeout: 20_000 })
    const button = page.getByRole('button', { name: 'Tour' })
    await button.click()
    const card = page.getByRole('dialog')
    await expect(card).toContainText('Welcome')
    await page.screenshot({ path: `test-results/tour-0-${scheme}.png` })
    const r = await new AxeBuilder({ page }).include('.tour-card').withTags(WCAG).analyze()
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])

    // walk every step; each one with a control puts the spotlight on it
    for (let i = 1; i < 20; i++) {
      if (await card.getByRole('button', { name: 'Done' }).isVisible()) break
      await card.getByRole('button', { name: 'Next' }).click()
      const title = (await card.getByRole('heading').textContent())!
      await expect(card).toContainText(`Step ${i + 1} of`)
      const target = TARGETS[title]
      if (target) {
        // the spotlight surrounds the control the card talks about
        const want = (await page.locator(target).first().boundingBox())!
        await expect
          .poll(async () => {
            const b = await page.locator('.tour-spot').boundingBox()
            return b ? Math.abs(b.x + b.width / 2 - (want.x + want.width / 2)) + Math.abs(b.y + b.height / 2 - (want.y + want.height / 2)) : 1e9
          }, { timeout: 10_000 })
          .toBeLessThan(4)
      }
      await page.screenshot({ path: `test-results/tour-${i}-${scheme}.png` })
    }
    await expect(card).toContainText('You are ready')
    await card.getByRole('button', { name: 'Read the full guide' }).click()
    const guide = page.getByRole('dialog', { name: 'Guide' })
    await expect(guide).toBeVisible()
    const g = await new AxeBuilder({ page }).include('.guide').withTags(WCAG).analyze()
    expect(g.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(guide).toBeHidden()
    // the tour put Site explorer back
    await expect(page.getByRole('radio', { name: 'Site explorer' })).toHaveAttribute('aria-checked', 'true')
  })
}

test('the tour card stays on a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('./')
  await page.getByRole('button', { name: 'Tour' }).click()
  const card = page.getByRole('dialog')
  for (let i = 0; i < 5; i++) {
    await card.getByRole('button', { name: 'Next' }).click()
    await page.waitForTimeout(350)
    const box = (await card.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(812)
  }
  await page.screenshot({ path: 'test-results/tour-phone.png' })
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
})
