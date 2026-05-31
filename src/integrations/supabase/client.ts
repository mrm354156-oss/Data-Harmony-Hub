// Supabase client — connected to the user's external Supabase project (EGX AI).
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://aodzerqrhyjsrbnxqrmk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvZHplcnFyaHlqc3Jibnhxcm1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNzE2MDIsImV4cCI6MjA5Mzg0NzYwMn0.sCqlsuIrq5MmGLhNkL1c9lguomydDeqe7Tjdkw86KBs";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
