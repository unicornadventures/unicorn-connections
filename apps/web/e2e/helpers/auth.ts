import { Page } from '@playwright/test';

export interface MockCurrentUser {
  id: number;
  email: string;
  is_admin?: boolean;
  is_class_admin?: boolean;
  created_at?: string;
  profile?: {
    first_name?: string | null;
    last_name?: string | null;
    former_first_name?: string | null;
    former_last_name?: string | null;
  } | null;
}

/**
 * Seeds localStorage with a logged-in session before the app's first script runs,
 * mirroring what Login.tsx stores on a real login. AppContext only reads
 * localStorage on mount, so this must run via addInitScript (before goto),
 * not page.evaluate after navigation.
 */
export async function loginAs(page: Page, user: MockCurrentUser): Promise<void> {
  const currentUser = {
    id: user.id,
    user_id: user.id,
    email: user.email,
    is_admin: user.is_admin ?? false,
    is_class_admin: user.is_class_admin ?? false,
    created_at: user.created_at ?? '2024-01-01T00:00:00Z',
    profile: user.profile ?? null,
    first_name: user.profile?.first_name || '',
    last_name: user.profile?.last_name || '',
  };

  await page.addInitScript(
    ({ token, currentUser }) => {
      window.localStorage.setItem('token', token);
      window.localStorage.setItem('currentUser', JSON.stringify(currentUser));
    },
    { token: 'fake-e2e-token', currentUser }
  );
}
