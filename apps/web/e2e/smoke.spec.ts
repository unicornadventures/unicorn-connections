import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { clickNavLink, clickSignOut } from './helpers/nav';

test.describe('Smoke Tests - Critical User Flows', () => {
  test.describe('unauthenticated', () => {
    test('should load the login page', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByText('Class Reunion')).toBeVisible();
    });

    test('should have valid page structure', async ({ page }) => {
      await page.goto('/login');

      expect(await page.locator('html').count()).toBe(1);
      expect(await page.locator('body').count()).toBe(1);
    });

    test('should have accessible form labels', async ({ page }) => {
      await page.goto('/login');

      await expect(page.locator('label:has-text("Email")')).toBeVisible();
      await expect(page.locator('label:has-text("Password")')).toBeVisible();
    });

    test('should have a functional, initially-disabled submit button', async ({ page }) => {
      await page.goto('/login');

      const loginButton = page.getByRole('button', { name: 'Sign in' });
      await expect(loginButton).toBeVisible();
      await expect(loginButton).toBeDisabled();
    });

    test('should preserve form input while typing', async ({ page }) => {
      await page.goto('/login');

      await page.getByPlaceholder('your@email.com').fill('test@example.com');
      await expect(page.getByPlaceholder('your@email.com')).toHaveValue('test@example.com');
    });

    test('should be responsive on mobile, tablet, and desktop', async ({ page }) => {
      const sizes = [
        { width: 375, height: 667 },
        { width: 768, height: 1024 },
        { width: 1920, height: 1080 },
      ];

      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.goto('/login');
        await expect(page.getByText('Class Reunion')).toBeVisible();
      }
    });

    test('should support keyboard focus on the email field', async ({ page }) => {
      await page.goto('/login');

      await page.getByPlaceholder('your@email.com').focus();
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('placeholder'));
      expect(focused).toBe('your@email.com');
    });

    test('should load without console errors', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });

      await page.goto('/login');

      expect(errors).toEqual([]);
    });
  });

  test.describe('authenticated', () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, { id: 1, email: 'me@example.com', profile: { first_name: 'Jane', last_name: 'Doe' } });
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
    });

    test('should reach the home page and see the nav', async ({ page }) => {
      await page.goto('/');

      await expect(page.getByText('Welcome back, Jane')).toBeVisible();
      await expect(page.getByRole('link', { name: 'ReunionConnect' })).toBeVisible();
    });

    test('should navigate to the directory without errors', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.goto('/');
      await clickNavLink(page, 'Directory');

      await expect(page).toHaveURL(/\/directory$/);
      expect(errors).toEqual([]);
    });

    test('should navigate to the help page', async ({ page }) => {
      await page.goto('/');
      await clickNavLink(page, 'Help');

      await expect(page).toHaveURL(/\/help$/);
      await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible();
    });

    test('should log out back to the login page', async ({ page }) => {
      await page.goto('/');
      await clickSignOut(page);

      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByText('Class Reunion')).toBeVisible();
    });

    test('should have no broken images on the home page', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByText('Welcome back, Jane')).toBeVisible();

      const images = page.locator('img');
      const count = await images.count();
      for (let i = 0; i < count; i++) {
        expect(await images.nth(i).getAttribute('src')).toBeTruthy();
      }
    });
  });
});
