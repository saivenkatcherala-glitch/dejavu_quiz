import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isConfigured = supabaseUrl && supabaseAnonKey &&
  supabaseUrl !== 'your-supabase-url-here' &&
  supabaseAnonKey !== 'your-supabase-anon-key-here';

if (!isConfigured) {
  console.warn(
    '%c⚠ DejaVu: Supabase not configured',
    'color: #f59e0b; font-weight: bold; font-size: 14px;',
    '\nSet VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env',
  );
}

// Create a real client if configured, otherwise create a mock that won't crash
let supabase: SupabaseClient;

if (isConfigured) {
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 2,
      },
    },
  });
} else {
  // Create with a valid-looking but non-functional URL to prevent crash
  // The app will show appropriate "not configured" messages
  supabase = createClient(
    'https://placeholder.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMH0.placeholder',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

export { supabase, isConfigured };
