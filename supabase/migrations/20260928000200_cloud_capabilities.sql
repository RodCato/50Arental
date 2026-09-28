-- Additive capability discovery; no business writes or changes to existing RPC/RLS.
begin;
create function public.ledger_capabilities() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 return '{"contract_version":2,"domains":["transactions","transaction_items","recurring_charges","water_events","user_settings","benchmark_adjustments","property_condition","attachments","vehicles","fuel_events"],"features":["tax_bucket","multi_property_photos","automotive_transaction_link"],"read_versions":[1,2]}'::jsonb;
end $$;
revoke all on function public.ledger_capabilities() from public,anon;
grant execute on function public.ledger_capabilities() to authenticated;
notify pgrst, 'reload schema';
commit;
