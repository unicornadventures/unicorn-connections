import { test, expect, Page } from '@playwright/test';
import { loginAs } from './helpers/auth';

const CLASS_INFO = { id: 5, year: 2015, school_id: 10, school_name: 'Central High School' };
const PAGE_SIZE = 24;

/** The query the page actually sent, so the spec can assert on paging. */
interface Captured {
  page: string | null;
  pageSize: string | null;
  order: string | null;
}

/**
 * A 1x1 PNG, inline.
 *
 * Not a URL on some example host: `page.goto` waits for `load`, which waits
 * for every `<img>`, and WebKit hangs on a name that does not resolve instead
 * of failing fast — nine of these tests timed out in WebKit and passed
 * everywhere else. A data URI needs no network at all, which is what the rest
 * of these route-mocked specs assume.
 */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const photo = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  url: PIXEL,
  caption: `Caption ${id}`,
  created_at: '2024-06-01T12:00:00Z',
  userId: 7,
  firstName: 'Ada',
  lastName: 'Lovelace',
  ...over,
});

/**
 * Mocks the class lookup and the gallery endpoint, echoing `total` back so the
 * pager has something to size itself against, and recording the last query.
 */
async function mockGallery(
  page: Page,
  { total, photos }: { total: number; photos: ReturnType<typeof photo>[] },
): Promise<Captured> {
  const captured: Captured = { page: null, pageSize: null, order: null };

  await page.route('**/api/users/1/class', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify({ class: CLASS_INFO }) });
  });

  await page.route('**/api/classes/5/gallery-photos**', (route) => {
    const url = new URL(route.request().url());
    captured.page = url.searchParams.get('page');
    captured.pageSize = url.searchParams.get('pageSize');
    captured.order = url.searchParams.get('order');

    route.fulfill({
      status: 200,
      body: JSON.stringify({
        photos,
        total,
        page: Number(captured.page ?? 1),
        pageSize: Number(captured.pageSize ?? PAGE_SIZE),
        order: captured.order ?? 'newest',
      }),
    });
  });

  return captured;
}

test.describe('Class Photos', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, {
      id: 1,
      email: 'jane@example.com',
      profile: { first_name: 'Jane', last_name: 'Doe' },
    });
  });

  test('lists the class photos with caption, uploader and count', async ({ page }) => {
    await mockGallery(page, { total: 2, photos: [photo(1), photo(2)] });
    await page.goto('/class-photos');

    await expect(page.getByRole('heading', { name: 'Class Photos' })).toBeVisible();
    await expect(page.getByText('Every photo the class of 2015 has uploaded. 2 in total.')).toBeVisible();
    await expect(page.getByText('Caption 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ada Lovelace' }).first()).toBeVisible();
  });

  test('defaults to newest first at page 1', async ({ page }) => {
    const captured = await mockGallery(page, { total: 2, photos: [photo(1)] });
    await page.goto('/class-photos');
    await expect(page.getByText('Caption 1')).toBeVisible();

    expect(captured.order).toBe('newest');
    expect(captured.page).toBe('1');
    expect(captured.pageSize).toBe(String(PAGE_SIZE));
    await expect(page.getByRole('button', { name: 'Newest first' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('re-requests oldest first when the order is switched', async ({ page }) => {
    const captured = await mockGallery(page, { total: 2, photos: [photo(1)] });
    await page.goto('/class-photos');
    await expect(page.getByText('Caption 1')).toBeVisible();

    await page.getByRole('button', { name: 'Oldest first' }).click();

    await expect(page.getByRole('button', { name: 'Oldest first' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => captured.order).toBe('oldest');
  });

  test('shows no pager when everything fits on one page', async ({ page }) => {
    await mockGallery(page, { total: 3, photos: [photo(1), photo(2), photo(3)] });
    await page.goto('/class-photos');
    await expect(page.getByText('Caption 1')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
    await expect(page.getByText(/Page \d+ of \d+/)).toHaveCount(0);
  });

  test('pages forward and asks for the next page', async ({ page }) => {
    // 3 pages at 24 per page.
    const captured = await mockGallery(page, { total: 60, photos: [photo(1)] });
    await page.goto('/class-photos');
    await expect(page.getByText('Page 1 of 3')).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByText('Page 2 of 3')).toBeVisible();
    await expect.poll(() => captured.page).toBe('2');
  });

  test('disables Previous on the first page and Next on the last', async ({ page }) => {
    await mockGallery(page, { total: 60, photos: [photo(1)] });
    await page.goto('/class-photos');
    await expect(page.getByText('Page 1 of 3')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();

    await page.getByRole('button', { name: '3', exact: true }).click();

    await expect(page.getByText('Page 3 of 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  /**
   * Page 3 of newest-first holds different photos from page 3 of oldest-first,
   * so keeping the page across a sort change would look like the sort did
   * nothing.
   */
  test('returns to page 1 when the order changes', async ({ page }) => {
    const captured = await mockGallery(page, { total: 60, photos: [photo(1)] });
    await page.goto('/class-photos');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Page 2 of 3')).toBeVisible();

    await page.getByRole('button', { name: 'Oldest first' }).click();

    await expect(page.getByText('Page 1 of 3')).toBeVisible();
    await expect.poll(() => captured.page).toBe('1');
  });

  test('elides the pager rather than rendering a button per page', async ({ page }) => {
    // 1200 photos is 50 pages; the pager must not render 50 buttons.
    await mockGallery(page, { total: 1200, photos: [photo(1)] });
    await page.goto('/class-photos');
    await expect(page.getByText('Page 1 of 50')).toBeVisible();

    await expect(page.getByText('…').first()).toBeVisible();
    // First and last stay reachable regardless of where the window sits.
    await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '50', exact: true })).toBeVisible();
    expect(await page.getByRole('button', { name: /^\d+$/ }).count()).toBeLessThan(12);
  });

  test('shows a placeholder for a photo whose file is missing', async ({ page }) => {
    await mockGallery(page, {
      total: 1,
      photos: [photo(1, { url: null, caption: null })],
    });
    await page.goto('/class-photos');

    await expect(page.getByText('Photo unavailable')).toBeVisible();
  });

  test('opens a photo full-screen and closes it again', async ({ page }) => {
    await mockGallery(page, { total: 1, photos: [photo(1)] });
    await page.goto('/class-photos');

    await page.getByRole('img', { name: 'Caption 1' }).click();
    await expect(page.getByRole('button', { name: 'Close photo' })).toBeVisible();

    await page.getByRole('button', { name: 'Close photo' }).click();
    await expect(page.getByRole('button', { name: 'Close photo' })).toHaveCount(0);
  });

  test('shows an empty state when the class has no photos', async ({ page }) => {
    await mockGallery(page, { total: 0, photos: [] });
    await page.goto('/class-photos');

    await expect(
      page.getByText('No photos yet. Add some from your profile and they will show up here.'),
    ).toBeVisible();
  });

  test('shows an error message when the photos fail to load', async ({ page }) => {
    await page.route('**/api/users/1/class', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ class: CLASS_INFO }) });
    });
    await page.route('**/api/classes/5/gallery-photos**', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal server error.' }) });
    });

    await page.goto('/class-photos');

    await expect(page.getByText('Internal server error.')).toBeVisible();
  });
});
