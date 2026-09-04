import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AxiosAdapter } from 'axios';

// This file exercises the real api.ts module and its interceptors, bypassing
// the global mock registered in src/test/setup.ts.
vi.unmock('./api');

function fakeAdapter(status: number, url: string): AxiosAdapter {
  return async (config) => {
    const response = {
      data: { error: 'nope' },
      status,
      statusText: String(status),
      headers: {},
      config: { ...config, url },
    };
    if (config.validateStatus && !config.validateStatus(status)) {
      const error: any = new Error(`Request failed with status code ${status}`);
      error.response = response;
      error.config = config;
      error.isAxiosError = true;
      throw error;
    }
    return response;
  };
}

describe('api response interceptor', () => {
  beforeEach(() => {
    window.localStorage.setItem('token', 'stale-token');
    window.localStorage.setItem('currentUser', JSON.stringify({ id: 1 }));
  });

  it('clears the session and redirects to /login on a 401 from a protected endpoint', async () => {
    const { default: api } = await import('./api');
    api.defaults.adapter = fakeAdapter(401, '/api/auth/me');

    await expect(api.get('/auth/me')).rejects.toBeTruthy();

    expect(window.localStorage.removeItem).toHaveBeenCalledWith('token');
    expect(window.localStorage.removeItem).toHaveBeenCalledWith('currentUser');
  });

  it('does not clear the session on a 401 from the login endpoint itself', async () => {
    const { default: api } = await import('./api');
    api.defaults.adapter = fakeAdapter(401, '/api/auth/login');
    vi.mocked(window.localStorage.removeItem).mockClear();

    await expect(api.post('/auth/login', {})).rejects.toBeTruthy();

    expect(window.localStorage.removeItem).not.toHaveBeenCalled();
  });
});
