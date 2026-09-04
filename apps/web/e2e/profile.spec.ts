import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { profileLink } from './helpers/nav';

const USER = { id: 1, email: 'jane@example.com', is_admin: false, created_at: '2024-01-01T00:00:00Z' };
const PROFILE = {
  id: 1,
  user_id: 1,
  first_name: 'Jane',
  last_name: 'Doe',
  nickname: 'JD',
  former_first_name: 'Janie',
  former_last_name: 'Smith',
  bio: 'Software engineer from 2015',
  then_photo_url: null,
  now_photo_url: null,
  tags: ['band', 'honor roll'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};
const CLASS_INFO = { id: 5, year: 2015, school_id: 10, school_name: 'Central High School' };
const SCHOOL = { id: 10, name: 'Central High School', location: 'Springfield, IL' };

// Own-profile view of src/components/UserProfile.tsx, rendered at /profile.
test.describe('Own Profile', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, { id: 1, email: USER.email, profile: { first_name: 'Jane', last_name: 'Doe' } });

    await page.route('**/api/users/1', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 200, body: JSON.stringify({ user: USER, profile: PROFILE }) });
      } else {
        route.continue();
      }
    });
    await page.route('**/api/users/1/class', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ class: CLASS_INFO }) });
    });
    await page.route('**/api/schools/10', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ school: SCHOOL }) });
    });
    await page.route('**/api/users/1/gallery**', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ photos: [] }) });
    });

    await page.goto('/profile');
  });

  test('should display profile information', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Jane Doe' })).toBeVisible();
    await expect(page.getByText('"JD"')).toBeVisible();
    await expect(page.getByText('Formerly: Janie Smith')).toBeVisible();
    await expect(page.getByText('Software engineer from 2015')).toBeVisible();
    await expect(page.getByText('band')).toBeVisible();
    await expect(page.getByText('honor roll')).toBeVisible();
  });

  test('should show class info and contact info', async ({ page }) => {
    await expect(page.getByText('Central High School')).toBeVisible();
    await expect(page.getByText('Springfield, IL')).toBeVisible();
    await expect(page.getByText('2015', { exact: true })).toBeVisible();
    await expect(page.getByText('jane@example.com')).toBeVisible();
  });

  test('should show avatar initials from the current name when no photo is set', async ({ page }) => {
    await expect(page.getByText('JD', { exact: true }).first()).toBeVisible();
  });

  test('should toggle into edit mode with fields prefilled', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit profile' }).click();

    await expect(page.getByRole('button', { name: 'Cancel editing' })).toBeVisible();
    await expect(page.getByPlaceholder('First name', { exact: true })).toHaveValue('Jane');
    await expect(page.getByPlaceholder('Last name', { exact: true })).toHaveValue('Doe');
    await expect(page.getByPlaceholder('Former first name')).toHaveValue('Janie');
    await expect(page.getByPlaceholder('Former last name')).toHaveValue('Smith');
    await expect(page.getByPlaceholder("Tell your classmates what you've been up to...")).toHaveValue('Software engineer from 2015');
  });

  test('should save profile edits, including former name and a new tag', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit profile' }).click();

    await page.getByPlaceholder('Former first name').fill('Janet');
    await page.getByPlaceholder('Add a tag and press Enter').fill('soccer');
    await page.getByPlaceholder('Add a tag and press Enter').press('Enter');
    await expect(page.getByText('soccer')).toBeVisible();

    let putBody: any;
    await page.route('**/api/users/1/profile', (route) => {
      putBody = route.request().postDataJSON();
      route.fulfill({
        status: 200,
        body: JSON.stringify({ profile: { ...PROFILE, former_first_name: 'Janet', tags: [...PROFILE.tags, 'soccer'] } }),
      });
    });

    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
    await expect(page.getByText('Formerly: Janet Smith')).toBeVisible();
    expect(putBody.former_first_name).toBe('Janet');
    expect(putBody.tags).toEqual(['band', 'honor roll', 'soccer']);
  });

  test('should let the user pick and clear an avatar color', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit profile' }).click();

    let putBody: any;
    await page.route('**/api/users/1/profile', (route) => {
      putBody = route.request().postDataJSON();
      route.fulfill({
        status: 200,
        body: JSON.stringify({ profile: { ...PROFILE, avatar_color: putBody.avatar_color } }),
      });
    });

    await page.getByRole('button', { name: 'Avatar color #E91E63' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
    expect(putBody.avatar_color).toBe('#E91E63');

    // Re-enter edit mode and click the same swatch again to clear it back to the default.
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByRole('button', { name: 'Avatar color #E91E63' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
    expect(putBody.avatar_color).toBeNull();
  });

  test('should remove a tag while editing', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(page.getByText('band')).toBeVisible();

    await page.locator('span', { hasText: 'band' }).getByRole('button', { name: '×' }).click();

    await expect(page.getByText('band', { exact: true })).toHaveCount(0);
    await expect(page.getByText('honor roll')).toBeVisible();
  });

  test('should cancel edit mode without saving changes', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByPlaceholder('First name', { exact: true }).fill('Changed');

    await page.getByRole('button', { name: 'Cancel editing' }).click();

    await expect(page.getByRole('heading', { name: 'Jane Doe' })).toBeVisible();
    await expect(page.getByPlaceholder('First name', { exact: true })).toHaveCount(0);
  });

  test('should show empty gallery state for own profile', async ({ page }) => {
    await expect(page.getByText('Gallery (0/9)')).toBeVisible();
    await expect(page.getByText('No gallery photos yet. Add up to 9 photos.')).toBeVisible();
  });

  test('should show placeholders for then/now photos with an upload prompt', async ({ page }) => {
    await expect(page.getByText('Click to add photo')).toHaveCount(2);
  });

  test('should navigate back on the back button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome back, Jane')).toBeVisible();

    await page.route('**/api/users/1/class', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ class: CLASS_INFO }) });
    });
    await page.route('**/api/schools/10/classes/5/events', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ events: [] }) });
    });
    await profileLink(page).click();
    await expect(page).toHaveURL(/\/profile$/);

    await page.getByRole('button', { name: '← Back' }).click();
    await expect(page).toHaveURL('/');
  });

  test('should show an error message when the profile fails to load', async ({ page }) => {
    await page.route('**/api/users/1', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal server error.' }) });
      } else {
        route.continue();
      }
    });

    await page.reload();

    await expect(page.getByText('Internal server error.')).toBeVisible();
  });
});
