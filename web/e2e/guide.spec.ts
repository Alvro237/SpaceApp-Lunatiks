import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

for (const scheme of ['dark', 'light'] as const) {
  test(`the Guide opens from the top bar, jumps to a section, closes with Escape and passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('./')
    const button = page.getByRole('button', { name: 'Guide' })
    await button.click()
    const dialog = page.getByRole('dialog', { name: 'Guide' })
    await expect(dialog).toBeVisible()
    await page.screenshot({ path: `test-results/guide-${scheme}.png` })

    const r = await new AxeBuilder({ page }).include('.guide').withTags(WCAG).analyze()
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])

    await dialog.getByRole('navigation', { name: 'Guide contents' }).getByRole('link', { name: /Side panel/ }).click()
    await expect(dialog.getByRole('heading', { name: /Side panel/ })).toBeFocused()
    await expect(dialog.getByRole('heading', { name: /Side panel/ })).toBeInViewport()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(button).toBeFocused()
  })
}

test('the Guide fills a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('./')
  await page.getByRole('button', { name: 'Guide' }).click()
  const box = (await page.getByRole('dialog', { name: 'Guide' }).boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(370)
  await page.screenshot({ path: 'test-results/guide-phone.png' })
  // no horizontal scroll inside the guide
  const overflow = await page.locator('.guide-body').evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
