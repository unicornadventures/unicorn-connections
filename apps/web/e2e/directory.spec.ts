import { test, expect, Page } from '@playwright/test';
import { loginAs } from './helpers/auth';

const CLASS_INFO = {
  id: 5,
  year: 2015,
  school_id: 10,
  school_name: 'Central High School',
};

// Order mirrors what the backend returns: sorted by COALESCE(former_last_name, last_name).
const DIRECTORY_USERS = [
  {
    id: 102,
    email: 'amy@example.com',
    is_deceased: false,
    first_name: 'Amy',
    last_name: 'Chen',
    nickname: null,
    former_first_name: null,
    former_last_name: null,
    now_photo_url: 'https://example.com/amy.jpg',
    tags: [],
  },
  {
    id: 103,
    email: 'carlos@example.com',
    is_deceased: false,
    first_name: 'Carlos',
    last_name: 'Diaz',
    nickname: null,
    former_first_name: null,
    former_last_name: 'Reyes',
    now_photo_url: null,
    tags: ['band'],
  },
  {
    id: 101,
    email: 'bob@example.com',
    is_deceased: false,
    first_name: 'Robert',
    last_name: 'Johnson',
    nickname: 'Bobby',
    former_first_name: 'Bob',
    former_last_name: 'Smith',
    now_photo_url: null,
    tags: ['football', 'honor roll'],
  },
  {
    id: 104,
    email: 'diane@example.com',
    is_deceased: true,
    first_name: 'Diane',
    last_name: 'Foster',
    nickname: null,
    former_first_name: 'Dee',
    former_last_name: 'Walsh',
    now_photo_url: null,
    tags: [],
  },
];

async function mockDirectory(page: Page, users = DIRECTORY_USERS) {
  await page.route('**/api/users/1/class', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify({ class: CLASS_INFO }) });
  });
  await page.route('**/api/classes/5/directory**', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify({ users }) });
  });
}

test.describe('Alumni Directory', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, { id: 1, email: 'me@example.com', profile: { first_name: 'Me', last_name: 'User' } });
  });

  test('shows the class header and total classmate count', async ({ page }) => {
    await mockDirectory(page);
    await page.goto('/directory');

    await expect(page.getByText('Central High School · Class of 2015')).toBeVisible();
    await expect(page.getByText(/4 classmates/)).toBeVisible();
  });

  test('displays former name and initials when set, falling back to current name otherwise', async ({ page }) => {
    await mockDirectory(page);
    await page.goto('/directory');

    // Former name set on both first and last -> shows former name, not current
    const bobCard = page.locator('button', { has: page.getByText('Smith', { exact: true }) });
    await expect(bobCard.getByText('Smith', { exact: true })).toBeVisible();
    await expect(bobCard.getByText('Bob', { exact: true })).toBeVisible();
    await expect(bobCard.getByText('Robert')).toHaveCount(0);
    await expect(bobCard.getByText('BS', { exact: true })).toBeVisible();
    await expect(bobCard.getByText('"Bobby"')).toBeVisible();

    // Only former last name set -> current first name + former last name
    const carlosCard = page.locator('button', { has: page.getByText('Reyes', { exact: true }) });
    await expect(carlosCard.getByText('Carlos', { exact: true })).toBeVisible();
    await expect(carlosCard.getByText('CR', { exact: true })).toBeVisible();

    // No former name at all -> falls back to current name, and shows photo instead of initials
    const amyCard = page.locator('button', { has: page.getByText('Chen', { exact: true }) });
    await expect(amyCard.getByText('Amy', { exact: true })).toBeVisible();
    const amyPhoto = amyCard.locator('img');
    await expect(amyPhoto).toHaveAttribute('src', 'https://example.com/amy.jpg');
    await expect(amyPhoto).toHaveAttribute('alt', 'Amy Chen');
  });

  test('lists deceased classmates alongside everyone else, using former name', async ({ page }) => {
    await mockDirectory(page);
    await page.goto('/directory');

    await expect(page.getByText('In Memoriam')).toHaveCount(0);

    const deceasedCard = page.locator('button', { has: page.getByText('Walsh', { exact: true }) });
    await expect(deceasedCard.getByText('Dee', { exact: true })).toBeVisible();
    await expect(deceasedCard.getByText('DW', { exact: true })).toBeVisible();
    await expect(deceasedCard.getByText('Deceased', { exact: true })).toBeVisible();
    await expect(page.getByText('Diane')).toHaveCount(0);

    const livingCard = page.locator('button', { has: page.getByText('Chen', { exact: true }) });
    await expect(livingCard.getByText('Deceased', { exact: true })).toHaveCount(0);
  });

  test('renders all classmates sorted by effective (former-first) last name', async ({ page }) => {
    await mockDirectory(page);
    await page.goto('/directory');

    await expect(page.getByText('Walsh', { exact: true })).toBeVisible();
    const names = await page.locator('button .font-display').allTextContents();

    expect(names).toEqual(['Chen', 'Reyes', 'Smith', 'Walsh']);
  });

  test('search matches former first name, former last name, current name, email, and tags', async ({ page }) => {
    await mockDirectory(page);
    await page.goto('/directory');

    const search = page.getByPlaceholder('Search classmates or tags...');

    // Former first name ("Bob") should find Bob Smith even though his current name is Robert Johnson
    await search.fill('bob');
    await expect(page.getByText('Smith', { exact: true })).toBeVisible();
    await expect(page.getByText('Chen', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Reyes', { exact: true })).toHaveCount(0);

    // Former last name
    await search.fill('reyes');
    await expect(page.getByText('Reyes', { exact: true })).toBeVisible();
    await expect(page.getByText('Smith', { exact: true })).toHaveCount(0);

    // Tag search
    await search.fill('football');
    await expect(page.getByText('Smith', { exact: true })).toBeVisible();
    await expect(page.getByText('Chen', { exact: true })).toHaveCount(0);

    // Email search
    await search.fill('amy@example.com');
    await expect(page.getByText('Chen', { exact: true })).toBeVisible();
    await expect(page.getByText('Smith', { exact: true })).toHaveCount(0);
  });

  test('shows an empty state when the search has no matches', async ({ page }) => {
    await mockDirectory(page);
    await page.goto('/directory');

    await page.getByPlaceholder('Search classmates or tags...').fill('nobody-matches-this');

    await expect(page.getByText('No classmates match "nobody-matches-this"')).toBeVisible();
  });

  test('shows a friendly empty state when the class has no members yet', async ({ page }) => {
    await mockDirectory(page, []);
    await page.goto('/directory');

    await expect(page.getByText('No classmates found yet.')).toBeVisible();
    await expect(page.getByText(/0 classmates/)).toBeVisible();
  });

  test('navigates to the classmate profile on card click', async ({ page }) => {
    await mockDirectory(page);
    await page.goto('/directory');

    await page.locator('button', { has: page.getByText('Smith', { exact: true }) }).click();

    await expect(page).toHaveURL(/\/user\/101$/);
  });

  test('does not show an edit control for a regular classmate', async ({ page }) => {
    await mockDirectory(page);
    await page.goto('/directory');

    await expect(page.getByTitle('Edit name / deceased status')).toHaveCount(0);
  });

  test('lets a class admin mark a classmate as deceased', async ({ page }) => {
    await loginAs(page, { id: 1, email: 'admin@example.com', is_class_admin: true, profile: { first_name: 'Me', last_name: 'User' } });
    await mockDirectory(page);
    let updateBody: any = null;
    await page.route('**/api/admin/users/102/profile', (route) => {
      updateBody = route.request().postDataJSON();
      route.fulfill({ status: 200, body: JSON.stringify({ user: { id: 102, email: 'amy@example.com', is_deceased: true, first_name: 'Amy', last_name: 'Chen' } }) });
    });
    await page.goto('/directory');

    const amyCard = page.locator('button', { has: page.getByText('Chen', { exact: true }) });
    await amyCard.getByTitle('Edit name / deceased status').click();

    await expect(page.getByText('Edit Amy Chen')).toBeVisible();
    await page.getByLabel('Mark as deceased').check();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Edit Amy Chen')).toHaveCount(0);
    expect(updateBody).toEqual({ is_deceased: true, first_name: 'Amy', last_name: 'Chen' });
  });

  test('lets a class admin correct a classmate\'s name', async ({ page }) => {
    await loginAs(page, { id: 1, email: 'admin@example.com', is_class_admin: true, profile: { first_name: 'Me', last_name: 'User' } });
    await mockDirectory(page);
    let updateBody: any = null;
    await page.route('**/api/admin/users/102/profile', (route) => {
      updateBody = route.request().postDataJSON();
      route.fulfill({ status: 200, body: JSON.stringify({ user: { id: 102, email: 'amy@example.com', is_deceased: false, first_name: 'Amelia', last_name: 'Chen' } }) });
    });
    await page.goto('/directory');

    const amyCard = page.locator('button', { has: page.getByText('Chen', { exact: true }) });
    await amyCard.getByTitle('Edit name / deceased status').click();

    await expect(page.getByText('Edit Amy Chen')).toBeVisible();
    const firstNameInput = page.getByPlaceholder('Current legal name');
    await firstNameInput.fill('Amelia');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Edit Amy Chen')).toHaveCount(0);
    expect(updateBody).toEqual({ is_deceased: false, first_name: 'Amelia', last_name: 'Chen' });
    await expect(page.getByText('Amelia', { exact: true })).toBeVisible();
  });

  test('shows an error message when the directory fails to load', async ({ page }) => {
    await page.route('**/api/users/1/class', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ class: CLASS_INFO }) });
    });
    await page.route('**/api/classes/5/directory**', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal server error.' }) });
    });

    await page.goto('/directory');

    await expect(page.getByText('Internal server error.')).toBeVisible();
  });
});
