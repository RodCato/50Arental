// Read-only diagnostics. No financial writes, migration, or image uploads in Phase 1.
export const tables = ['transactions','transaction_items','recurring_charges','property_condition','attachments','water_events','user_settings','benchmark_adjustments'];
export async function checkFoundation(client) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Sign in before checking cloud access.');
  for (const table of tables) {
    const result = await client.from(table).select('owner_id', { head: true }).limit(1);
    if (result.error) throw new Error(`Database check failed for ${table}. Check migrations and permissions.`);
  }
  const health = await client.rpc('ledger_foundation_health');
  if (health.error || health.data?.schema_version !== 1 || !health.data.evidence_bucket_private || !health.data.storage_policies_present) throw new Error('Foundation schema or private Storage policies are missing. Apply the migration.');
  const listing = await client.storage.from('50a-evidence').list(`${data.user.id}/receipts`, { limit: 1 });
  if (listing.error) throw new Error('Private Storage access check failed.');
  return 'Authenticated database access verified. Private evidence bucket and policies present; own-path listing succeeded. No data uploaded.';
}
