import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should display login page when not authenticated', async ({ page }) => {
    await expect(page.getByText('Class Reunion')).toBeVisible();
    await expect(page.getByText('Sign in to your account')).toBeVisible();
    await expect(page.getByPlaceholder('your@email.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
  });

  test('redirects to the login page for any route when not authenticated', async ({ page }) => {
    await page.goto('/directory');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('should disable the submit button for an empty form', async ({ page }) => {
    const submitButton = page.getByRole('button', { name: 'Sign in' });
    await expect(submitButton).toBeDisabled();
  });

  test('should enable submit button once email and password are filled', async ({ page }) => {
    await page.getByPlaceholder('your@email.com').fill('test@example.com');
    await page.getByPlaceholder('••••••••').fill('password123');

    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  test('should show an error message on failed login', async ({ page, context }) => {
    await context.route('**/api/auth/login', (route) => {
      route.fulfill({
        status: 401,
        body: JSON.stringify({ error: 'Incorrect email or password.' }),
      });
    });

    await page.getByPlaceholder('your@email.com').fill('invalid@example.com');
    await page.getByPlaceholder('••••••••').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  });

  test('should show a loading state while submitting', async ({ page, context }) => {
    await context.route('**/api/auth/login', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      route.fulfill({ status: 401, body: JSON.stringify({ error: 'Incorrect email or password.' }) });
    });

    await page.getByPlaceholder('your@email.com').fill('test@example.com');
    await page.getByPlaceholder('••••••••').fill('password123');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('button', { name: 'Signing in...' })).toBeVisible();
  });

  test('should log in successfully and land on the home page', async ({ page, context }) => {
    await context.route('**/api/auth/login', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          user: {
            user_id: 1,
            email: 'test@example.com',
            is_admin: false,
            is_class_admin: false,
            created_at: '2024-01-01T00:00:00Z',
            profile: { first_name: 'Jane', last_name: 'Doe' },
          },
          token: 'fake-jwt-token',
        }),
      });
    });
    await context.route('**/api/users/1/class', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ class: { id: 1, year: 2015, school_id: 1, school_name: 'Central High School' } }),
      });
    });
    await context.route('**/api/schools/1/classes/1/events', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ events: [] }) });
    });

    await page.getByPlaceholder('your@email.com').fill('test@example.com');
    await page.getByPlaceholder('••••••••').fill('password123');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText('Welcome back, Jane')).toBeVisible();
  });

  test('password field should mask input', async ({ page }) => {
    const passwordInput = page.getByPlaceholder('••••••••');
    await passwordInput.fill('password123');
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('should navigate to forgot password page', async ({ page }) => {
    await page.getByText('Forgot your password?').click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });

  test('should be responsive on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await expect(page.getByText('Class Reunion')).toBeVisible();
    await expect(page.getByPlaceholder('your@email.com')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
