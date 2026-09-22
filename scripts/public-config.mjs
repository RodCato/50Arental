// Explicit allowlist: never spread process.env into a browser bundle.
export function publicConfig(env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url && !publishableKey) return { enabled: false };
  if (!url || !publishableKey) throw new Error('Configure both the public Supabase URL and publishable/anon key.');
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('Invalid public Supabase URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if ((endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('Supabase URL must be an HTTPS origin (HTTP allowed only for localhost).');
  let safeKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey);
  if (!safeKey) {
    try {
      const parts = publishableKey.split('.');
      safeKey = parts.length === 3 && JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'anon';
    } catch { /* Reject unknown keys without logging their contents. */ }
  }
  if (!safeKey) throw new Error('Only a Supabase publishable key or legacy anon JWT may be exposed.');
  return { enabled: true, url: endpoint.origin, publishableKey };
}
