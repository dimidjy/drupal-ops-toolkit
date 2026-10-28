import { expect, test } from '@playwright/test';

// The dashboard and `dops test run --url` pass the pages to check in
// DOPS_TEST_URLS; without them a few common Drupal pages are checked.
const paths = process.env.DOPS_TEST_URLS?.split(',').filter(Boolean) ?? ['/', '/user/login'];

for (const path of paths) {
  test(`${path} loads without errors`, async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(path);
    expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
    await expect(page.locator('body')).not.toContainText(
      'The website encountered an unexpected error',
    );
    expect(errors).toEqual([]);
  });
}
