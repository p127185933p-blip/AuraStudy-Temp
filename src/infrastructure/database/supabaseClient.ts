import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface SupabaseEnvConfig {
  url: string;
  anonKey: string;
}

function readSupabaseEnv(): SupabaseEnvConfig | null {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const url = env?.VITE_SUPABASE_URL?.trim() ?? '';
  const anonKey = env?.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseEnv() !== null;
}

let cachedClient: SupabaseClient | null = null;
let cachedSignature: string | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const config = readSupabaseEnv();
  if (!config) {
    return null;
  }

  const signature = `${config.url}::${config.anonKey}`;
  if (!cachedClient || cachedSignature !== signature) {
    cachedClient = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    cachedSignature = signature;
  }

  return cachedClient;
}
