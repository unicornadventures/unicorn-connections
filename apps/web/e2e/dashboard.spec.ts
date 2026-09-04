import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { clickNavLink, clickSignOut, openMobileMenuIfNeeded, profileLink } from './helpers/nav';

// There is no /dashboard route or "Dashboard" nav link in this app — the authenticated
// home is "/" (WelcomePage), navigated via the persistent Header. This spec covers that
// post-login navigation shell (src/components/Header.tsx).
test.describe('Post-login Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, {
      id: 1,
      email: 'jane@example.com',
      profile: { first_name: 'Jane', last_name: 'Doe', former_first_name: 'Janie', former_last_name: 'Smith' },
    });

    await page.route('**/api/users/1/class', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ class: { id: 5, year: 2015, school_id: 10, school_name: 'Central High School' } }),
      });
    });
    await page.route('**/api/schools/10/classes/5/events', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ events: [] }) });
    });
    await page.route('**/api/classes/5/directory**', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ users: [] }) });
    });

    await page.goto('/');
  });

  test('should display the navigation menu after login', async ({ page }) => {
    await openMobileMenuIfNeeded(page);

    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Directory' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Events' })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: 'Help' })).toBeVisible();
    await expect(profileLink(page)).toBeVisible();
  });

  test('should show the class greeting on the home page', async ({ page }) => {
    await expect(page.getByText('Central High School · Class of 2015')).toBeVisible();
    await expect(page.getByText('Welcome back, Jane')).toBeVisible();
  });

  test('should navigate to the directory page', async ({ page }) => {
    await clickNavLink(page, 'Directory');
    await expect(page).toHaveURL(/\/directory$/);
    await expect(page.getByRole('heading', { name: 'Alumni Directory' })).toBeVisible();
  });

  test('should navigate to the events page', async ({ page }) => {
    await clickNavLink(page, 'Events');
    await expect(page).toHaveURL(/\/events$/);
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  });

  test('should navigate to the help page', async ({ page }) => {
    await clickNavLink(page, 'Help');
    await expect(page).toHaveURL(/\/help$/);
  });

  test('should navigate to the profile page', async ({ page }) => {
    await page.route('**/api/users/1', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          user: { id: 1, email: 'jane@example.com', is_admin: false, created_at: '2024-01-01T00:00:00Z' },
          profile: { id: 1, user_id: 1, first_name: 'Jane', last_name: 'Doe', tags: [] },
        }),
      });
    });

    await profileLink(page).click();
    await expect(page).toHaveURL(/\/profile$/);
  });

  test('should highlight the active nav link', async ({ page }) => {
    await openMobileMenuIfNeeded(page);
    const classTokens = (locator: ReturnType<typeof page.getByRole>) =>
      locator.evaluate((el) => el.className.split(/\s+/));

    expect(await classTokens(page.getByRole('link', { name: 'Home' }))).toContain('text-[#E8A93E]');
    expect(await classTokens(page.getByRole('link', { name: 'Directory' }))).not.toContain('text-[#E8A93E]');
  });

  test('should show avatar initials from the former name', async ({ page }) => {
    // Janie Smith -> "JS", not the current name "Jane Doe" -> "JD"
    await expect(page.getByText('JS', { exact: true })).toBeVisible();
  });

  test('should log out and redirect to the login page', async ({ page }) => {
    await clickSignOut(page);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Class Reunion')).toBeVisible();
  });

  test('should toggle the mobile menu', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await expect(page.getByRole('link', { name: 'Directory' })).toBeHidden();

    await page.getByRole('button', { name: 'Toggle menu' }).click();

    await expect(page.getByRole('link', { name: 'Directory' })).toBeVisible();
  });
});
