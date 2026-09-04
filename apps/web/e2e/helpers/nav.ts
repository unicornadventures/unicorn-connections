import { Page } from '@playwright/test';

// Header.tsx hides the desktop nav below the md breakpoint (768px) and shows a hamburger
// menu instead. These helpers open it first when the viewport is narrow, so the same test
// works across desktop and mobile projects.
export async function openMobileMenuIfNeeded(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 768) {
    await page.getByRole('button', { name: 'Toggle menu' }).click();
  }
}

// Scoped to the header: role+name is a substring match, so a bare 'Help' also
// matches the inline "help page" link some pages render in their body text.
// `banner` rather than `navigation` because the desktop <nav> is `hidden md:flex`
// — below 768px the links live in the mobile menu, which is outside it but still
// inside <header>.
export async function clickNavLink(page: Page, name: string): Promise<void> {
  await openMobileMenuIfNeeded(page);
  await page.getByRole('banner').getByRole('link', { name }).click();
}

export async function clickSignOut(page: Page): Promise<void> {
  await openMobileMenuIfNeeded(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
}

// The "Profile" text next to the avatar is hidden below the sm breakpoint (640px), which
// changes the link's accessible name — so target it by href instead of role+name.
export function profileLink(page: Page) {
  return page.locator('header a[href="/profile"]');
}
