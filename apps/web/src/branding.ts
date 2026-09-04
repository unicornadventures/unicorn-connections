// The same build is served on multiple custom domains (see the
// SecondaryDomainName parameter in template.yaml), so the brand shown in the
// UI is resolved at runtime from the hostname the app was loaded on rather
// than baked in at build time. Keep this map in sync with index.html's
// inline title script, which mirrors this logic for the browser tab title.
const DOMAIN_BRANDS: Record<string, string> = {
  'unicornconnections.org': 'UnicornConnections',
  'www.unicornconnections.org': 'UnicornConnections',
};

export const SITE_BRAND: string =
  (typeof window !== 'undefined' && DOMAIN_BRANDS[window.location.hostname]) || 'ReunionConnect';
