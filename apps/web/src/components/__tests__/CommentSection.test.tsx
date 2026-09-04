import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import CommentSection from '../CommentSection';
import * as api from '../../api';

vi.mock('../../api');
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({
    // CommentSection takes no props — it always shows the signed-in user's own comments,
    // fetched via /comments/my-comments/:user_id
    currentUser: { id: 2, user_id: 2, email: 'commenter@example.com', is_admin: false, profile: null }
  })
}));

const mockComments = [
  {
    id: 1,
    target_user_id: 1,
    commenter_id: 2,
    content: 'Great memories!',
    published: true,
    created_at: '2024-06-19T10:00:00Z',
    updated_at: '2024-06-19T10:00:00Z',
    target_first_name: 'John',
    target_last_name: 'Doe'
  }
];

// The page links to the directory and each comment's target, so it needs a router
const renderPage = () => render(<CommentSection />, { wrapper: MemoryRouter });

describe('CommentSection Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.default.get).mockImplementation(() =>
      Promise.resolve({ data: { comments: mockComments } })
    );
  });

  it('should render comment section', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/My Comments/i)).toBeInTheDocument();
    });
  });

  it('should display loading state initially', () => {
    renderPage();

    expect(screen.getByText('Loading comments...')).toBeInTheDocument();
  });

  it('should display comments after loading', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Great memories!')).toBeInTheDocument();
    });
  });

  it('should show who each comment was left for, linking to their page', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'John Doe' })).toHaveAttribute('href', '/user/1');
    });
  });

  it('should show a Pending badge for unpublished comments', async () => {
    vi.mocked(api.default.get).mockResolvedValueOnce({
      data: { comments: [{ ...mockComments[0], published: false }] }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });
  });

  it('should show empty state when no comments', async () => {
    vi.mocked(api.default.get).mockResolvedValueOnce({
      data: { comments: [] }
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText(/You haven't posted any comments yet/i)
      ).toBeInTheDocument();
    });
  });

  it('should allow editing own comments', async () => {
    const user = userEvent.setup();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Great memories!')).toBeInTheDocument();
    });

    const editButton = screen.getByRole('button', { name: /Edit/i });
    expect(editButton).toBeInTheDocument();

    await user.click(editButton);

    expect(screen.getByDisplayValue('Great memories!')).toBeInTheDocument();
  });

  it('should allow deleting own comments', async () => {
    const user = userEvent.setup();

    vi.mocked(api.default.delete).mockResolvedValueOnce({
      data: { message: 'Deleted' }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Great memories!')).toBeInTheDocument();
    });

    // Opens the ConfirmModal (the component uses a modal, not window.confirm)
    const deleteButton = screen.getByRole('button', { name: /Delete/i });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText('Delete Comment')).toBeInTheDocument();
    });

    // Modal's own confirm button is also labeled "Delete" — it's the one added after opening
    const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(api.default.delete).toHaveBeenCalledWith('/comments/1', { params: { requesterId: 2 } });
    });
  });
});
