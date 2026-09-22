import { createClient } from '@supabase/supabase-js';
export async function initializeCloud({ fetcher = fetch, factory = createClient, storage = sessionStorage } = {}) {
  const response = await fetcher('./cloud-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Cloud configuration unavailable.');
  const config = await response.json();
  if (!config.enabled) return null;
  // Auth stays separate from the ledger and from portable/Google backups.
  return factory(config.url, config.publishableKey, { auth: {
    storage, storageKey: '50a-supabase-auth', persistSession: true,
    autoRefreshToken: true, detectSessionInUrl: false
  } });
}
export function cloudAuth(client) {
  return {
    sendCode: email => client.auth.signInWithOtp({ email }),
    verifyCode: (email, token) => client.auth.verifyOtp({ email, token, type: 'email' }),
    signOut: () => client.auth.signOut({ scope: 'local' }),
    getUser: () => client.auth.getUser(),
    onChange: callback => client.auth.onAuthStateChange((_event, session) => callback(session?.user || null))
  };
}
