import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { publicConfig } from '../scripts/public-config.mjs';
import { initializeCloud, cloudAuth } from '../cloud/client.mjs';
import { checkFoundation, tables } from '../cloud/data.mjs';
const url = 'https://example.supabase.co';
const key = 'sb_publishable_TEST_ONLY';
const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test`;
test('public configuration uses an allowlist and rejects secret/service-role keys', () => {
  assert.deepEqual(publicConfig({ POSTGRES_URL: 'PRIVATE_SENTINEL', SUPABASE_SECRET_KEY: 'PRIVATE_SENTINEL' }), { enabled: false });
  assert.deepEqual(publicConfig({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key, POSTGRES_PASSWORD: 'PRIVATE_SENTINEL' }), { enabled: true, url, publishableKey: key });
  assert.equal(publicConfig({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon') }).enabled, true);
  for (const invalid of ['sb_secret_TEST_ONLY', jwt('service_role'), 'unknown']) assert.throws(() => publicConfig({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: invalid }), /Only a Supabase/);
  assert.throws(() => publicConfig({ SUPABASE_URL: url }), /Configure both/);
  assert.throws(() => publicConfig({ SUPABASE_URL: 'https://user:password@example.com', SUPABASE_PUBLISHABLE_KEY: key }), /HTTPS origin/);
  assert.throws(() => publicConfig({ SUPABASE_URL: 'http://example.com', SUPABASE_PUBLISHABLE_KEY: key }));
});
test('client is optional and Auth session is isolated from ledger backups', async () => {
  let called = false;
  assert.equal(await initializeCloud({ storage: {}, fetcher: async () => ({ ok: true, json: async () => ({ enabled: false }) }), factory: () => { called = true; } }), null);
  assert.equal(called, false);
  const storage = {};
  await initializeCloud({ storage, fetcher: async (_path, options) => {
    assert.equal(options.cache, 'no-store'); return { ok: true, json: async () => ({ enabled: true, url, publishableKey: key }) };
  }, factory: (endpoint, apiKey, options) => {
    assert.equal(endpoint, url); assert.equal(apiKey, key); assert.equal(options.auth.storage, storage);
    assert.equal(options.auth.persistSession, true); assert.equal(options.auth.autoRefreshToken, true);
    assert.equal(options.auth.storageKey, '50a-supabase-auth'); assert.equal(options.auth.detectSessionInUrl, true);
  } });
});
test('default Magic Link uses the app callback and local sign-out', async () => {
  const calls = [];
  const auth = cloudAuth({ auth: {
    signInWithOtp: async args => calls.push(['send', args]),
    signOut: async args => calls.push(['out', args])
  } });
  await auth.sendLink('synthetic@example.test', 'https://ledger.example.test/');
  await auth.signOut();
  assert.deepEqual(calls, [['send', { email: 'synthetic@example.test', options: { emailRedirectTo: 'https://ledger.example.test/' } }], ['out', { scope: 'local' }]]);
});
test('health reads every table and own Storage path without mutation', async () => {
  const read = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-owner' } } }) },
    from: table => ({ select: (column, options) => {
      assert.equal(column, 'owner_id'); assert.equal(options.head, true); read.push(table);
      return { limit: async () => ({ error: null }) };
    } }),
    rpc: async name => { assert.equal(name, 'ledger_foundation_health'); return { data: { schema_version: 1, evidence_bucket_private: true, storage_policies_present: true } }; },
    storage: { from: name => { assert.equal(name, '50a-evidence'); return { list: async path => { assert.equal(path, 'synthetic-owner/receipts'); return { error: null }; } }; } }
  };
  assert.match(await checkFoundation(client), /No data uploaded/);
  assert.deepEqual(read, tables);
  client.rpc = async () => ({ data: { schema_version: 1, evidence_bucket_private: false } });
  await assert.rejects(checkFoundation(client), /private Storage policies/);
  client.auth.getUser = async () => ({ data: { user: null } });
  await assert.rejects(checkFoundation(client), /Sign in/);
});
test('build excludes private environment values and serves complete PWA shell', async () => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key,
    SUPABASE_SECRET_KEY: 'PRIVATE_SENTINEL_50A', POSTGRES_URL: 'PRIVATE_SENTINEL_50A', POSTGRES_PASSWORD: 'PRIVATE_SENTINEL_50A' };
  execFileSync(process.execPath, ['scripts/build.mjs'], { env, stdio: 'pipe' });
  const files = await readdir('dist');
  assert(!files.includes('.env')); assert(!files.includes('supabase')); assert(!files.includes('package.json'));
  for (const file of files) assert(!(await readFile(`dist/${file}`)).includes(Buffer.from('PRIVATE_SENTINEL_50A')), file);
  assert.deepEqual(JSON.parse(await readFile('dist/cloud-config.json')), { enabled: true, url, publishableKey: key });
  const sw = await readFile('dist/sw.js', 'utf8');
  assert(!sw.includes('cloud-config.json')); // Config/Auth/Storage never cached by shell worker.
  for (const [, asset] of sw.matchAll(/'\.\/([^']+)'/g)) assert(files.includes(asset), `Missing cached asset ${asset}`);
  execFileSync(process.execPath, ['scripts/build.mjs'], { env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: 'pipe' });
  assert.deepEqual(JSON.parse(await readFile('dist/cloud-config.json')), { enabled: false });
});

test('service worker does not intercept Auth, config, or session-bearing API requests', async () => {
  const handlers = {};
  vm.runInNewContext(await readFile('sw.js', 'utf8'), { URL, self: { location: { origin: 'https://ledger.example.test', href: 'https://ledger.example.test/sw.js' }, addEventListener: (name, callback) => { handlers[name] = callback; } } });
  for (const url of ['https://example.supabase.co/auth/v1/token', 'https://example.supabase.co/auth/v1/user', 'https://example.supabase.co/storage/v1/object/50a-evidence/private.webp', 'https://example.supabase.co/storage/v1/object/sign/50a-evidence/private.webp?token=synthetic', 'https://ledger.example.test/cloud-config.json', 'https://ledger.example.test/auth/v1/token']) {
    for (const method of ['GET', 'POST']) handlers.fetch({ request: { url, method }, respondWith: () => assert.fail('Private/config request intercepted') });
  }
});
