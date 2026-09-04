# Playwright E2E Tests

Comprehensive end-to-end tests for the Class Reunion frontend using Playwright.

## Setup

```bash
npm install
npx playwright install  # Install browser binaries
```

## Running Tests

### Development
```bash
npm run test:e2e         # Run all tests
npm run test:e2e:ui      # Run with UI mode (interactive)
npm run test:e2e:debug   # Run in debug mode
```

### CI/CD
Tests run on multiple browsers (Chromium, Firefox, WebKit) and mobile viewports.

```bash
CI=true npm run test:e2e
```

## Test Structure

Every spec below is verified against the real running app (`npm run dev` + `npx playwright test`),
not just written against the component source — see "Authentication" for the pattern they share.

### `auth.spec.ts`
Login page (`src/components/Login.tsx`): rendering, validation, error messages, loading state,
successful login, forgot-password link, mobile responsiveness. Public/unauthenticated only.

### `smoke.spec.ts`
Critical-path checks split into unauthenticated (login page structure, a11y basics, responsive
sizes, console errors) and authenticated (home page, nav to directory/help, logout, broken images).

### `dashboard.spec.ts`
Post-login navigation shell (`src/components/Header.tsx` + `WelcomePage.tsx`) — there is no
`/dashboard` route or "Dashboard" link in this app. Covers nav links, active-link styling, the
class greeting, avatar initials (former-name fallback), logout, and the mobile hamburger menu.

### `profile.spec.ts`
Own-profile view (`src/components/UserProfile.tsx` at `/profile`): info display (name, nickname,
former-name badge, bio, tags), class/contact info cards, edit mode (including former name and
tags), save/cancel, empty gallery state, then/now photo placeholders, error handling. Does not
cover the S3 presigned-upload photo flow.

### `comments.spec.ts`
"My Comments" (`src/components/CommentSection.tsx` at `/comments`) — this shows the current
user's own authored comments (`GET /comments/my-comments/:userId`), not comments left on their
profile. Covers list/count, empty state, posting, editing, deleting (with the confirm modal), and
error handling.

### `schools-classes.spec.ts`
There are no public `/schools` or `/classes` routes — school and class-year management is
super-admin-only, at `/admin/schools` (`SchoolManager.tsx`) and `/admin/classes`
(`ClassManager.tsx`). Covers listing, adding, and deleting schools, and linking/removing class
years (including the first-time bulk "Set up years" flow) for a school.

### `directory.spec.ts`
Class directory (`DirectoryPage.tsx` at `/directory`): class header/count, former-name display
with fallback to current name, initials, "In Memoriam" section, sort order, search (matching
former/current name, email, tags), empty states, card navigation, error handling.

## Configuration

See `playwright.config.ts` for:
- Test directory: `./e2e`
- Base URL: `http://localhost:5173`
- Browsers: Chromium, Firefox, WebKit
- Mobile: Pixel 5
- Screenshots: Only on failure
- Traces: On first retry

## Key Features

✅ **Multi-browser testing** - Chromium, Firefox, WebKit
✅ **Mobile testing** - Pixel 5 viewport
✅ **Accessibility checks** - Keyboard navigation, contrast
✅ **Visual testing** - Screenshots on failure
✅ **Trace recording** - Debug failed tests
✅ **API mocking** - Mock backend responses
✅ **Responsive design** - Test multiple viewports
✅ **Error handling** - Network failures, validation

## Writing New Tests

### Authentication

Most routes require a logged-in session, and `AppContext` only reads `localStorage` once, on
mount. Seed the session with `page.addInitScript` *before* `page.goto`, via the `loginAs` helper
in `e2e/helpers/auth.ts` — `page.evaluate` after navigation is too late:

```typescript
import { loginAs } from './helpers/auth';

test.beforeEach(async ({ page }) => {
  await loginAs(page, { id: 1, email: 'me@example.com', profile: { first_name: 'Jane', last_name: 'Doe' } });
});
```

### Test Template
```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAs(page, { id: 1, email: 'me@example.com' });
    // Setup: mock APIs, etc.
    await page.goto('/');
  });

  test('should do something', async ({ page }) => {
    // Arrange: Set up state
    await page.locator('selector').fill('value');

    // Act: Perform action
    await page.locator('button').click();

    // Assert: Verify result
    await expect(page.locator('result')).toBeVisible();
  });
});
```

### Mobile nav

The desktop nav links live in a `hidden md:flex` `<nav>` and are replaced by a hamburger menu
below the `md` breakpoint (768px) — plain `getByRole('link', { name: 'Directory' })` clicks will
time out under the Mobile Chrome project. Use the helpers in `e2e/helpers/nav.ts`:
`clickNavLink(page, name)` and `clickSignOut(page)` open the hamburger first when the viewport is
narrow. The "Profile" link's accessible name also changes at the `sm` breakpoint (640px) since its
text label hides — use `profileLink(page)` (matches by `href`) instead of `getByRole` for it.

### A note on non-retrying locator methods

`allTextContents()`, `innerHTML()`, `count()`, etc. read the DOM once and don't wait for content
to appear the way `expect(locator).toBeVisible()` does. If the data loads asynchronously (as the
directory does), assert on a retrying matcher first (e.g. `await expect(locator).toHaveCount(n)`)
before calling one of these, or it will race the fetch and silently return an empty result.

### Best Practices

1. **Use page objects** - Avoid repetitive selectors
2. **Wait for elements** - Use `waitFor` or locator waits
3. **Mock APIs** - Use `context.route()` for consistent data
4. **Test user flows** - Not implementation details
5. **Be specific** - Use unique selectors, avoid xpath
6. **Clean up** - Close pages/contexts if needed

### Selectors

Prefer in order:
1. `text=` or `:has-text()` - User-visible text
2. `role=` - Semantic HTML roles
3. `placeholder=` - Form inputs
4. `data-testid=` - Explicit test attributes
5. CSS selectors - As fallback

## Debugging

### Visual Debugging
```bash
npm run test:e2e:ui
```

Interactive mode showing live preview and step-through.

### Debug Mode
```bash
npm run test:e2e:debug
```

Opens browser with Playwright Inspector.

### View Traces
```bash
npx playwright show-trace trace.zip
```

Replay test execution with full DOM snapshots.

## CI/CD Integration

There is no CI workflow wired up for this suite yet (only `.github/workflows/test-lambda.yml`
exists, for the backend Lambda integration tests). `playwright.config.ts` is already
CI-aware — `retries: 2` and `workers: 1` under `CI=true` — so adding a workflow that runs
`CI=true npm run test:e2e` is the remaining step.

## Common Assertions

```typescript
// Visibility
await expect(page.locator('selector')).toBeVisible();
await expect(page.locator('selector')).toBeHidden();

// Values
await expect(page.locator('input')).toHaveValue('text');
await expect(page.locator('button')).toBeEnabled();
await expect(page.locator('button')).toBeDisabled();

// Text
await expect(page.locator('h1')).toHaveText('Title');
await expect(page.locator('div')).toContainText('partial');

// Attributes
await expect(page.locator('img')).toHaveAttribute('src', '/path');

// Count
await expect(page.locator('li')).toHaveCount(3);
```

## Troubleshooting

### Tests timeout
- Increase timeout: `test.setTimeout(10000)`
- Check if elements load: Add `waitForLoadState('networkidle')`

### Flaky tests
- Use `waitFor()` instead of immediate assertions
- Mock APIs to avoid network variability
- Avoid `setTimeout` - use waits instead

### Failed on CI
- Check test recording: `npx playwright show-trace`
- Verify CI environment: PORT, BASE_URL, API endpoints
- Check for race conditions in setup/teardown

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Debug Guide](https://playwright.dev/docs/debug)
- [API Reference](https://playwright.dev/docs/api/intro)
