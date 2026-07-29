import {
  createClient,
  type SupabaseClient
} from "@supabase/supabase-js";
import { chromeStorageAdapter } from "./storage";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isCloudConfigured =
  Boolean(supabaseUrl && supabaseKey) &&
  !supabaseUrl?.includes("YOUR_PROJECT") &&
  !supabaseKey?.includes("YOUR_SUPABASE");

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isCloudConfigured || !supabaseUrl || !supabaseKey) {
    return null;
  }

  if (!client) {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        storage: chromeStorageAdapter,
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }

  return client;
}
