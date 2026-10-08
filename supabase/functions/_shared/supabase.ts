import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import { requiredEnv } from "./utils.ts";

function serverKey(): string {
  const current = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (current) {
    try {
      const keys = JSON.parse(current) as Record<string, unknown>;
      if (typeof keys.default === "string" && keys.default) return keys.default;
      const first = Object.values(keys).find((value): value is string =>
        typeof value === "string" && value.length > 0
      );
      if (first) return first;
    } catch {
      throw new Error("SUPABASE_SECRET_KEYS is not valid JSON");
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  throw new Error("No Supabase server secret is available");
}

export function adminClient(): SupabaseClient {
  return createClient(requiredEnv("SUPABASE_URL"), serverKey(), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "x-client-info": "yusuf-opportunity-inbox/1.0" } },
  });
}
