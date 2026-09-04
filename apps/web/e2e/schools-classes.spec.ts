import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

// There are no public /schools or /classes routes for regular users — school and class
// year management is super-admin-only, at /admin/schools (SchoolManager.tsx) and
// /admin/classes (ClassManager.tsx).
test.describe('Admin: School Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, { id: 1, email: 'admin@reunion.com', is_admin: true, profile: { first_name: 'Admin', last_name: 'User' } });
  });

  test('should list registered schools', async ({ page }) => {
    await page.route('**/api/schools', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          schools: [
            { id: 1, name: 'Central High School', location: 'Downtown', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
            { id: 2, name: 'Westside Academy', location: 'West End', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
          ],
        }),
      });
    });

    await page.goto('/admin/schools');

    await expect(page.getByRole('heading', { name: 'School Management' })).toBeVisible();
    await expect(page.getByText('Registered Schools (2)')).toBeVisible();
    await expect(page.getByText('Central High School')).toBeVisible();
    await expect(page.getByText('Downtown')).toBeVisible();
    await expect(page.getByText('Westside Academy')).toBeVisible();
  });

  test('should show an empty state with no schools', async ({ page }) => {
    await page.route('**/api/schools', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ schools: [] }) });
    });

    await page.goto('/admin/schools');

    await expect(page.getByText('No schools yet.')).toBeVisible();
    await expect(page.getByText('Registered Schools (0)')).toBeVisible();
  });

  test('should add a new school', async ({ page }) => {
    let schools = [{ id: 1, name: 'Central High School', location: 'Downtown', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' }];
    await page.route('**/api/schools', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ schools }) });
    });
    await page.goto('/admin/schools');
    await expect(page.getByText('Registered Schools (1)')).toBeVisible();

    await page.route('**/api/admin/schools', (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        schools = [...schools, { id: 2, name: body.name, location: body.location, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' }];
        route.fulfill({ status: 201, body: JSON.stringify({ school: schools[1] }) });
      } else {
        route.continue();
      }
    });

    await page.getByPlaceholder('Westbrook High School').fill('Eastside Prep');
    await page.getByPlaceholder('Springfield, IL').fill('Eastside, NY');
    await page.getByRole('button', { name: 'Add school' }).click();

    await expect(page.getByText('Eastside Prep')).toBeVisible();
    await expect(page.getByText('Registered Schools (2)')).toBeVisible();
  });

  test('should prefill the form when editing a school', async ({ page }) => {
    await page.route('**/api/schools', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ schools: [{ id: 1, name: 'Central High School', location: 'Downtown', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' }] }),
      });
    });
    await page.goto('/admin/schools');

    await page.getByRole('button', { name: 'Edit' }).click();

    await expect(page.getByRole('heading', { name: 'Edit School' })).toBeVisible();
    await expect(page.getByPlaceholder('Westbrook High School')).toHaveValue('Central High School');
    await expect(page.getByPlaceholder('Springfield, IL')).toHaveValue('Downtown');
    await expect(page.getByRole('button', { name: 'Update school' })).toBeVisible();
  });

  test('should delete a school after confirming', async ({ page }) => {
    let schools = [{ id: 1, name: 'Central High School', location: 'Downtown', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' }];
    await page.route('**/api/schools', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ schools }) });
    });
    await page.route('**/api/admin/schools/1', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ message: 'Deleted' }) });
    });
    await page.goto('/admin/schools');

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: 'Delete Central High School' })).toBeVisible();
    await expect(page.getByText('This is permanent and cannot be undone.')).toBeVisible();

    await page.getByRole('button', { name: 'Delete School' }).click();

    await expect(page.getByText('Central High School')).toHaveCount(0);
    await expect(page.getByText('No schools yet.')).toBeVisible();
  });
});

test.describe('Admin: Class Year Management', () => {
  const SCHOOLS = [
    { id: 1, name: 'Central High School' },
    { id: 2, name: 'Westside Academy' },
  ];
  const ALL_YEARS = [
    { id: 100, year: 2014 },
    { id: 101, year: 2015 },
    { id: 102, year: 2016 },
  ];

  test.beforeEach(async ({ page }) => {
    await loginAs(page, { id: 1, email: 'admin@reunion.com', is_admin: true, profile: { first_name: 'Admin', last_name: 'User' } });
    await page.route('**/api/schools', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ schools: SCHOOLS }) });
    });
    await page.route('**/api/classes', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ classes: ALL_YEARS }) });
    });
  });

  test('should show a school selector and prompt to pick one', async ({ page }) => {
    await page.goto('/admin/classes');

    await expect(page.getByRole('heading', { name: 'Class Management' })).toBeVisible();
    await expect(page.getByText('Select a school above to manage its class years.')).toBeVisible();
  });

  test('should show a setup form for a school with no linked years', async ({ page }) => {
    await page.route('**/api/schools/1/classes', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ classes: [] }) });
    });
    await page.goto('/admin/classes');

    await page.locator('select').first().selectOption('1');

    await expect(page.getByText('No class years set up yet')).toBeVisible();

    await page.route('**/api/admin/schools/1/classes/bulk**', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ classes: [{ id: 101, year: 2015, member_count: 0 }, { id: 102, year: 2016, member_count: 0 }] }),
      });
    });

    await page.getByPlaceholder(/e\.g\. \d+/).fill('2015');
    await page.getByRole('button', { name: 'Set up years' }).click();

    const linkedYears = page.locator('span.font-display');
    await expect(linkedYears).toHaveCount(2);
    expect((await linkedYears.allTextContents()).sort()).toEqual(['2015', '2016']);
  });

  test('should show linked class years with member counts for a school', async ({ page }) => {
    await page.route('**/api/schools/1/classes', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ classes: [{ id: 101, year: 2015, member_count: 42 }] }),
      });
    });
    await page.goto('/admin/classes');

    await page.locator('select').first().selectOption('1');

    await expect(page.getByText('Linked Class Years')).toBeVisible();
    await expect(page.locator('span.font-display', { hasText: '2015' })).toBeVisible();
    await expect(page.getByText('42 members')).toBeVisible();
  });

  test('should link an additional class year', async ({ page }) => {
    await page.route('**/api/schools/1/classes', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ classes: [{ id: 101, year: 2015, member_count: 0 }] }) });
    });
    await page.goto('/admin/classes');
    await page.locator('select').first().selectOption('1');
    await expect(page.locator('span.font-display', { hasText: '2015' })).toBeVisible();

    await page.route('**/api/admin/schools/1/classes', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 201, body: JSON.stringify({ class: { id: 100, year: 2014 } }) });
      } else {
        route.continue();
      }
    });

    await page.locator('select').nth(1).selectOption('100');
    await page.getByRole('button', { name: 'Link Year' }).click();

    await expect(page.locator('span.font-display', { hasText: '2014' })).toBeVisible();
  });

  test('should remove a linked class year after confirming', async ({ page }) => {
    await page.route('**/api/schools/1/classes', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ classes: [{ id: 101, year: 2015, member_count: 3 }] }) });
    });
    await page.route('**/api/admin/schools/1/classes/101', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ message: 'Unlinked' }) });
    });
    await page.goto('/admin/classes');
    await page.locator('select').first().selectOption('1');
    await expect(page.locator('span.font-display', { hasText: '2015' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('heading', { name: 'Remove Class Year 2015' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove Year' }).click();

    await expect(page.locator('span.font-display', { hasText: '2015' })).toHaveCount(0);
  });
});
