// Feature toggles. Each flag is on by default and turned off by setting the
// matching VITE_* env var to 'false' (e.g. VITE_FEEDBACK_ENABLED=false).
// The backend has a matching FEEDBACK_ENABLED flag guarding its endpoints.
export const FEEDBACK_ENABLED = import.meta.env.VITE_FEEDBACK_ENABLED !== 'false';
