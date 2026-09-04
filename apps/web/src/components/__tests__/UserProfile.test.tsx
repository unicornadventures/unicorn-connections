import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import UserProfile from '../UserProfile';
import * as api from '../../api';

vi.mock('../../api');
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({
    // is_admin so viewing another user's profile (userId=999 tests) doesn't get
    // short-circuited by the "you can only view your own profile" guard
    currentUser: { id: 1, user_id: 1, email: 'test@example.com', is_admin: true, profile: null },
    updateCurrentUser: vi.fn()
  })
}));

const renderUserProfile = (props: { userId: number }) =>
  render(<UserProfile {...props} />, { wrapper: MemoryRouter });

const mockProfile = {
  user: {
    id: 1,
    email: 'test@example.com',
    is_admin: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  profile: {
    id: 1,
    user_id: 1,
    first_name: 'John',
    last_name: 'Doe',
    nickname: 'Johnny',
    bio: 'Software engineer',
    then_photo_url: 'https://example.com/then.jpg',
    now_photo_url: 'https://example.com/now.jpg',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  }
};

describe('UserProfile Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // fetchProfile also fetches /:id/class, /schools/:id and /:id/gallery after the
    // main profile call — default those so tests only need to override the profile call
    vi.mocked(api.default.get).mockImplementation((url: string) => {
      if (url.includes('/gallery')) return Promise.resolve({ data: { photos: [] } });
      if (url.includes('/class')) return Promise.resolve({ data: { class: { id: 10, year: 2020, school_id: 5 } } });
      if (url.startsWith('/schools/')) return Promise.resolve({ data: { school: { id: 5, name: 'Test High' } } });
      return Promise.resolve({ data: mockProfile });
    });
  });

  it('should render user profile', async () => {
    renderUserProfile({ userId: 1 });

    await waitFor(() => {
      expect(screen.getByText(/John Doe/)).toBeInTheDocument();
      expect(screen.getByText(/test@example.com/)).toBeInTheDocument();
    });
  });

  it('should display loading state initially', () => {
    renderUserProfile({ userId: 1 });

    expect(screen.getByText('Loading profile...')).toBeInTheDocument();
  });

  it('should display profile information after loading', async () => {
    renderUserProfile({ userId: 1 });

    await waitFor(() => {
      expect(screen.getByText(/Johnny/)).toBeInTheDocument();
      expect(screen.getByText('Software engineer')).toBeInTheDocument();
    });
  });

  it('should show error on failed profile load', async () => {
    const errorMsg = 'Failed to load profile';

    vi.mocked(api.default.get).mockRejectedValueOnce({
      response: { data: { error: errorMsg } }
    });

    renderUserProfile({ userId: 999 });

    await waitFor(() => {
      expect(screen.getByText(new RegExp(errorMsg))).toBeInTheDocument();
    });
  });

  it('should toggle edit mode', async () => {
    const user = userEvent.setup();

    renderUserProfile({ userId: 1 });

    await waitFor(() => {
      expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    });

    const editButton = screen.getByRole('button', { name: /Edit profile/i });
    await user.click(editButton);

    // "Cancel editing" (toggle button) and "Cancel" (form button) both render once in edit mode
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('should allow editing profile information', async () => {
    const user = userEvent.setup();

    renderUserProfile({ userId: 1 });

    await waitFor(() => {
      expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    });

    const editButton = screen.getByRole('button', { name: /Edit profile/i });
    await user.click(editButton);

    const firstNameInput = screen.getByDisplayValue('John');
    await user.clear(firstNameInput);
    await user.type(firstNameInput, 'Jane');

    expect(screen.getByDisplayValue('Jane')).toBeInTheDocument();
  });

  it('should display photos when available', async () => {
    renderUserProfile({ userId: 1 });

    await waitFor(() => {
      expect(screen.getByAltText(/Then/)).toBeInTheDocument();
      expect(screen.getByAltText(/Now/)).toBeInTheDocument();
    });
  });

  it('should show photo placeholders when photos are not available', async () => {
    vi.mocked(api.default.get).mockResolvedValueOnce({
      data: {
        ...mockProfile,
        profile: {
          ...mockProfile.profile,
          then_photo_url: null,
          now_photo_url: null
        }
      }
    });

    renderUserProfile({ userId: 1 });

    // isOwnProfile is true for this mocked viewer, so the empty-slot label is
    // "Click to add photo" (it would read "No photo" for a non-owner viewer)
    await waitFor(() => {
      expect(screen.getAllByText('Click to add photo')).toHaveLength(2);
    });
  });

  it('should allow file input for photo upload', async () => {
    const user = userEvent.setup();

    renderUserProfile({ userId: 1 });

    await waitFor(() => {
      expect(screen.getByAltText(/Then/)).toBeInTheDocument();
    });

    const fileInputs = screen.getAllByDisplayValue('');
    expect(fileInputs.length).toBeGreaterThan(0);
  });

  it('should handle missing profile gracefully', async () => {
    vi.mocked(api.default.get).mockResolvedValueOnce({
      data: {
        user: mockProfile.user,
        profile: null
      }
    });

    renderUserProfile({ userId: 1 });

    // Falls back to the email in both the heading and the contact-info field
    await waitFor(() => {
      expect(screen.getAllByText(/test@example.com/).length).toBeGreaterThan(0);
    });
  });
});
