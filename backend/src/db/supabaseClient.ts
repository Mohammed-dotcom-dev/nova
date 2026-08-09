import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

// Every DB client in this app is scoped to the "nova" schema — alias it so
// call sites don't have to repeat the generic parameters everywhere.
export type NovaDb = SupabaseClient<any, "nova", any>;

// Deliberately no service-role key anywhere in this backend. Every DB client
// is scoped to the calling user's JWT, so Postgres RLS is the actual
// enforcement boundary — a bug in application code can't leak another
// user's rows, because the database itself refuses the query.
export function clientForUser(accessToken: string): NovaDb {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "nova" },
  }) as NovaDb;
}

// Anon client for operations that don't need a user yet (e.g. verifying a token).
export function anonClient(): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
