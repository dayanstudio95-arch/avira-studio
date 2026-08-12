import { createClient } from '@supabase/supabase-js';

// Replaces src/api/base44Client.js. Not wired into the app yet —
// pages still call `base44` until each one is migrated (see roadmap).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
