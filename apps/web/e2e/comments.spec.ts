import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

// CommentSection.tsx renders the current user's own authored comments ("My Comments"),
// fetched from GET /comments/my-comments/:userId — not comments left on their profile.
test.describe('My Comments', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, { id: 1, email: 'me@example.com', profile: { first_name: 'Jane', last_name: 'Doe' } });
  });

  test('should display the comment count and list', async ({ page }) => {
    await page.route('**/api/comments/my-comments/1', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          comments: [
            { id: 1, target_user_id: 2, commenter_id: 1, content: 'Great times at school!', published: true, created_at: '2024-06-19T10:00:00Z', updated_at: '2024-06-19T10:00:00Z' },
            { id: 2, target_user_id: 3, commenter_id: 1, content: 'Remember the old days?', published: true, created_at: '2024-06-18T15:30:00Z', updated_at: '2024-06-18T15:30:00Z' },
          ],
        }),
      });
    });

    await page.goto('/comments');

    await expect(page.getByText('My Comments (2)')).toBeVisible();
    await expect(page.getByText('Great times at school!')).toBeVisible();
    await expect(page.getByText('Remember the old days?')).toBeVisible();
  });

  test('should show an empty state when there are no comments', async ({ page }) => {
    await page.route('**/api/comments/my-comments/1', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ comments: [] }) });
    });

    await page.goto('/comments');

    await expect(page.getByText("You haven't posted any comments yet.")).toBeVisible();
  });

  // Composing happens on another member's profile, not on /comments — that page
  // only lists your own. The test used to target /comments, where there is no
  // compose form, and had been failing since before the port.
  test('should disable posting until text is entered, then post a new comment', async ({ page }) => {
    // Registered before the narrower /comments route below: Playwright tries
    // the most recently added match first. The trailing ** is needed because
    // the page sends ?requesterId=.
    await page.route('**/api/users/2**', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          user: { user_id: 2, email: 'jane@example.com', is_admin: false, is_class_admin: false },
          profile: { first_name: 'Jane', last_name: 'Doe', tags: [] },
        }),
      });
    });
    await page.route('**/api/users/2/comments**', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 201, body: JSON.stringify({ comment: { id: 9 } }) });
      }
      route.fulfill({ status: 200, body: JSON.stringify({ comments: [] }) });
    });

    await page.goto('/user/2');

    const textarea = page.getByPlaceholder('Share your message...');
    const postButton = page.getByRole('button', { name: 'Post comment' });
    await expect(postButton).toBeDisabled();

    await textarea.fill('This is a great reunion!');
    await expect(postButton).toBeEnabled();
  });
  test('should edit an existing comment', async ({ page }) => {
    await page.route('**/api/comments/my-comments/1', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          comments: [{ id: 1, target_user_id: 2, commenter_id: 1, content: 'Original text', published: true, created_at: '2024-06-19T10:00:00Z', updated_at: '2024-06-19T10:00:00Z' }],
        }),
      });
    });
    await page.goto('/comments');
    await expect(page.getByText('Original text')).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    const editTextarea = page.locator('textarea').last();
    await expect(editTextarea).toHaveValue('Original text');
    await editTextarea.fill('Updated text');

    let putBody: any;
    await page.route('**/api/comments/1', (route) => {
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON();
        route.fulfill({
          status: 200,
          body: JSON.stringify({
            comment: { id: 1, target_user_id: 2, commenter_id: 1, content: 'Updated text', published: true, created_at: '2024-06-19T10:00:00Z', updated_at: '2024-06-19T11:00:00Z' },
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Updated text')).toBeVisible();
    await expect(page.getByText('Original text')).toHaveCount(0);
    expect(putBody).toEqual({ content: 'Updated text', requesterId: 1 });
  });

  test('should cancel editing without saving changes', async ({ page }) => {
    await page.route('**/api/comments/my-comments/1', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          comments: [{ id: 1, target_user_id: 2, commenter_id: 1, content: 'Original text', published: true, created_at: '2024-06-19T10:00:00Z', updated_at: '2024-06-19T10:00:00Z' }],
        }),
      });
    });
    await page.goto('/comments');

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.locator('textarea').last().fill('Changed my mind');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Original text')).toBeVisible();
    await expect(page.getByText('Changed my mind')).toHaveCount(0);
  });

  test('should delete a comment after confirming', async ({ page }) => {
    await page.route('**/api/comments/my-comments/1', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          comments: [{ id: 1, target_user_id: 2, commenter_id: 1, content: 'Delete me', published: true, created_at: '2024-06-19T10:00:00Z', updated_at: '2024-06-19T10:00:00Z' }],
        }),
      });
    });
    await page.goto('/comments');
    await expect(page.getByText('Delete me')).toBeVisible();

    let deleteRequested = false;
    await page.route('**/api/comments/1**', (route) => {
      if (route.request().method() === 'DELETE') {
        deleteRequested = true;
        expect(route.request().url()).toContain('requesterId=1');
        route.fulfill({ status: 200, body: JSON.stringify({ message: 'Deleted' }) });
      } else {
        route.continue();
      }
    });

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Delete Comment')).toBeVisible();

    // The modal's own confirm button is also labeled "Delete" — it's the one that appears after opening.
    await page.getByRole('button', { name: 'Delete' }).last().click();

    await expect(page.getByText('Delete me')).toHaveCount(0);
    await expect(page.getByText("You haven't posted any comments yet.")).toBeVisible();
    expect(deleteRequested).toBe(true);
  });

  test('should show an error message when comments fail to load', async ({ page }) => {
    await page.route('**/api/comments/my-comments/1', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'Failed to load comments.' }) });
    });

    await page.goto('/comments');

    await expect(page.getByText('Failed to load comments.')).toBeVisible();
  });

  test('should have a responsive layout on mobile', async ({ page }) => {
    await page.route('**/api/comments/my-comments/1', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          comments: [{ id: 1, target_user_id: 2, commenter_id: 1, content: 'Great times at school!', published: true, created_at: '2024-06-19T10:00:00Z', updated_at: '2024-06-19T10:00:00Z' }],
        }),
      });
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/comments');

    await expect(page.getByText('Great times at school!')).toBeVisible();
  });
});
