import { test, expect } from '@playwright/test';

/**
 * The only e2e that talks to a real server.
 *
 * Every other spec in this directory mocks the API with `page.route`, which
 * makes them fast and hermetic but means they would pass just as well against
 * no backend at all. This one logs in for real, so it is what actually
 * demonstrates the client works against the ported API — the phase-6 gate.
 *
 * It is skipped unless `E2E_LIVE_API=1`, because it needs a running Nest server
 * and a seeded database; see `scripts/smoke-web.sh`, which sets both up.
 */
const LIVE = process.env.E2E_LIVE_API === '1';

test.describe('against a live Nest API', () => {
  test.skip(!LIVE, 'set E2E_LIVE_API=1 and run scripts/smoke-web.sh');

  test('logs in with real credentials and lands on the home page', async ({
    page,
  }) => {
    await page.goto('/login');

    await page.getByPlaceholder('your@email.com').fill('ada@example.com');
    await page.getByPlaceholder('••••••••').fill('correct-horse');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Landing anywhere but /login means the token came back and stuck.
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByRole('banner')).toBeVisible();
  });

  test('rejects a wrong password with the API’s own message', async ({
    page,
  }) => {
    await page.goto('/login');

    await page.getByPlaceholder('your@email.com').fill('ada@example.com');
    await page.getByPlaceholder('••••••••').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // The API answers { error: 'Invalid credentials.' } and Login.tsx renders
    // `err.response.data.error` — so this also proves the error envelope the
    // AllExceptionsFilter produces is the shape the client expects.
    await expect(page.getByText(/invalid credentials/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/login/);
  });

  test('renders the class directory from real data', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('your@email.com').fill('ada@example.com');
    await page.getByPlaceholder('••••••••').fill('correct-horse');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto('/directory');

    // Seeded by scripts/smoke-web.sh.
    await expect(page.getByText('Lovelace')).toBeVisible({ timeout: 15_000 });
  });
});
