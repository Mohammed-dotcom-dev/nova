import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  // Fail loud in dev rather than silently making unauthenticated requests
  // that the backend will reject one-by-one with confusing 401s.
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check frontend/.env");
}

export const supabase = createClient(url, anonKey);
