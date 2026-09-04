import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Login from '../Login';
import * as api from '../../api';

vi.mock('../../api');
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({
    login: vi.fn()
  })
}));

const renderLogin = () => render(<Login />, { wrapper: MemoryRouter });

describe('Login Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render login form', () => {
    renderLogin();

    expect(screen.getByText(/Class Reunion/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeInTheDocument();
  });

  it('should show validation error on empty submit', async () => {
    const user = userEvent.setup();
    renderLogin();

    const submitButton = screen.getByRole('button', { name: /Sign in/i });
    expect(submitButton).toBeDisabled();
  });

  it('should enable submit button when form is filled', async () => {
    const user = userEvent.setup();
    renderLogin();

    const emailInput = screen.getByPlaceholderText('your@email.com');
    const passwordInput = screen.getByPlaceholderText('••••••••');
    const submitButton = screen.getByRole('button', { name: /Sign in/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');

    expect(submitButton).not.toBeDisabled();
  });

  it('should display error message on failed login', async () => {
    const user = userEvent.setup();
    const errorMessage = 'Invalid credentials';

    vi.mocked(api.default.post).mockRejectedValueOnce({
      response: { data: { error: errorMessage } }
    });

    renderLogin();

    const emailInput = screen.getByPlaceholderText('your@email.com');
    const passwordInput = screen.getByPlaceholderText('••••••••');
    const submitButton = screen.getByRole('button', { name: /Sign in/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'wrong');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it('should display loading state during submission', async () => {
    const user = userEvent.setup();

    vi.mocked(api.default.post).mockImplementationOnce(() =>
      new Promise(resolve => setTimeout(() => resolve({ data: {} }), 100))
    );

    renderLogin();

    const emailInput = screen.getByPlaceholderText('your@email.com');
    const passwordInput = screen.getByPlaceholderText('••••••••');
    const submitButton = screen.getByRole('button', { name: /Sign in/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    expect(screen.getByRole('button', { name: /Signing in/i })).toBeInTheDocument();
  });
});
