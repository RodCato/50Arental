-- FIN-002B: nullable scheduling terms only; no seeds, backfill, or business updates.
-- Deploy/verify this migration before shell v29. Older clients cannot discard populated terms.
begin;
alter table public.recurring_charge_revisions
 add column effective_date date,
 add column due_day integer,
 add column autopay boolean,
 add constraint recurring_effective_date check(effective_date is null or (effective_date between date '0001-01-01' and date '9999-12-31' and to_char(effective_date,'YYYY-MM')=effective_month and (active or extract(day from effective_date)=1))),
 add constraint recurring_due_day check(due_day is null or due_day between 1 and 31);
create or replace function public.ledger_read(client_version integer) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; data_tmp jsonb; t text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if client_version not in (2,3,4) then raise exception 'Update the 50A app before cloud access'; end if;
 -- Old browser clients must not silently export a backup missing finance records.
 -- Trusted service-role bridges receive the COMPLETE snapshot without changing their API.
 if client_version=2 and current_setting('role',true)<>'service_role' and (
 exists(select 1 from public.income_sources where owner_id=auth.uid()) or exists(select 1 from public.financial_goals where owner_id=auth.uid()) or exists(select 1 from public.coverage_settings where owner_id=auth.uid()) or exists(select 1 from public.recurring_charge_revisions where owner_id=auth.uid())) then raise exception 'Update 50A to shell v27 for complete Housing Coverage access';end if;
 if client_version<4 and current_setting('role',true)<>'service_role' and exists(select 1 from public.recurring_charge_revisions where owner_id=auth.uid() and (effective_date is not null or due_day is not null or autopay is not null)) then raise exception 'Update 50A to shell v29 for recurring bill terms';end if;
 data:='{}';
 foreach t in array array['transactions','transaction_items','recurring_charges','water_events','user_settings','benchmark_adjustments','property_condition','attachments','vehicles','fuel_events','income_sources','financial_goals','work_sessions','paychecks','coverage_settings','recurring_charge_revisions'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from public.%I r where owner_id=$1',t) into strict data_tmp using auth.uid();
 if t='recurring_charge_revisions' then select coalesce(jsonb_agg((v-'effective_date'-'due_day'-'autopay')||jsonb_strip_nulls(jsonb_build_object('effective_date',v->'effective_date','due_day',v->'due_day','autopay',v->'autopay')) order by v::text),'[]') into data_tmp from jsonb_array_elements(data_tmp) v;end if;
 data:=data||jsonb_build_object(t,data_tmp);
 end loop;
 return jsonb_build_object('rows',data,'revision',md5(data::text));
end $$;
create or replace function public.ledger_apply(operation_id uuid,expected_revision text,changes jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare own uuid:=auth.uid(); snapshot jsonb; previous public.ledger_operations; digest text; t text; entry jsonb; r jsonb; cols text; vals text; result text; n integer; payment numeric; bill uuid;
begin
 if own is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if operation_id is null or expected_revision is null or jsonb_typeof(changes)<>'object' then raise exception 'Invalid operation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(own::text,502002));
 digest:=md5(changes::text);
 select * into previous from public.ledger_operations o where o.owner_id=own and o.operation_id=ledger_apply.operation_id;
 if found then
  if previous.payload_hash<>digest then raise exception 'Operation ID reused with different intent'; end if;
  return jsonb_build_object('revision',previous.result_revision,'replayed',true);
 end if;
 snapshot:=public.ledger_read(4);
 if snapshot->>'revision'<>expected_revision then raise exception 'Ledger changed on another device' using errcode='40001'; end if;
 for t in select jsonb_object_keys(changes) loop
  if t not in ('transactions','transaction_items','recurring_charges','water_events','user_settings','benchmark_adjustments','property_condition','attachments','vehicles','fuel_events','income_sources','financial_goals','work_sessions','paychecks','coverage_settings','recurring_charge_revisions') then raise exception 'Unsupported domain'; end if;
  entry:=changes->t;
  if jsonb_typeof(entry->'put')<>'array' or jsonb_typeof(entry->'remove')<>'array' then raise exception 'Invalid mutation'; end if;
  for r in select value from jsonb_array_elements(entry->'put') loop
   if r->>'owner_id' is distinct from own::text or r ? 'created_at' or r ? 'updated_at' then raise exception 'Invalid owner/audit fields' using errcode='42501'; end if;
  end loop;
 end loop;
 if exists(select 1 from public.coverage_settings where owner_id=own) then
  for r in select value from jsonb_array_elements(coalesce(changes->'recurring_charges'->'put','[]')) loop
   if not exists(select 1 from jsonb_array_elements(coalesce(changes->'recurring_charge_revisions'->'put','[]')) v where v->>'recurring_charge_id'=r->>'id') and not exists(select 1 from public.recurring_charges b where b.id=(r->>'id')::uuid and b.owner_id=own and b.amount=(r->>'amount')::numeric and b.active=(r->>'active')::boolean and b.kind=r->>'kind' and b.category=r->>'category' and b.utility_type=r->>'utility_type') then raise exception 'Monthly bill edit requires an effective revision';end if;
  end loop;
 end if;
 -- Deletes precede puts; the entire operation, including dependent rows, is atomic.
 foreach t in array array['work_sessions','paychecks','coverage_settings','recurring_charge_revisions','income_sources','financial_goals','fuel_events','vehicles','attachments','property_condition','transaction_items','transactions','benchmark_adjustments','water_events','recurring_charges'] loop
  for r in select value from jsonb_array_elements(coalesce(changes->t->'remove','[]')) loop
   execute format('delete from public.%I where owner_id=$1 and id=$2',t) using own,(r#>>'{}')::uuid;
  end loop;
 end loop;
 if coalesce(jsonb_array_length(changes->'user_settings'->'remove'),0)>0 then raise exception 'Settings cannot be removed'; end if;
 foreach t in array array['income_sources','financial_goals','vehicles','recurring_charges','transactions','transaction_items','water_events','user_settings','benchmark_adjustments','property_condition','attachments','fuel_events','work_sessions','paychecks','coverage_settings','recurring_charge_revisions'] loop
  for r in select value from jsonb_array_elements(coalesce(changes->t->'put','[]')) loop
   if exists(select 1 from jsonb_object_keys(r) k where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name=k)) then raise exception 'Unknown field'; end if;
   select string_agg(format('%I',k),',' order by k), string_agg(format('%I=excluded.%I',k,k),',' order by k) into cols,vals from jsonb_object_keys(r) k;
   execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) on conflict (%I) do update set %s',t,cols,cols,t,case when t='user_settings' then 'owner_id' else 'id' end,vals) using r;
  end loop;
 end loop;
 for r in select value from jsonb_array_elements(coalesce(changes->'transactions'->'put','[]')) loop
  select coalesce(sum(case when i.status in ('avoided','cancelled','reused') then 0 else i.amount-i.adjustment end),0) into payment from public.transaction_items i where i.owner_id=own and i.transaction_id=(r->>'id')::uuid;
  if (r->>'one_time_amount')::numeric>payment or (r->>'recurring_charge_id' is null and (r->>'one_time_amount')::numeric<>0) then raise exception 'Invalid one-time payment portion'; end if;
 end loop;
 -- A payment-driven estimate change cannot rewrite a fixed bill or invent its service portion.
 if coalesce(jsonb_array_length(changes->'transactions'->'put'),0)>0 then
  for r in select value from jsonb_array_elements(coalesce(changes->'recurring_charges'->'put','[]')) loop
   bill:=(r->>'id')::uuid;
   if coalesce((select h->>'kind' from jsonb_array_elements(snapshot->'rows'->'recurring_charge_revisions') h where h->>'recurring_charge_id'=bill::text and h->>'effective_month'<=(select v->>'effective_month' from jsonb_array_elements(coalesce(changes->'recurring_charge_revisions'->'put','[]')) v where v->>'recurring_charge_id'=bill::text order by v->>'effective_month' desc limit 1) order by h->>'effective_month' desc limit 1),(select b->>'kind' from jsonb_array_elements(snapshot->'rows'->'recurring_charges') b where b->>'id'=bill::text))='fixed' then raise exception 'Payment cannot rewrite fixed bill'; end if;
   select count(*) into n from jsonb_array_elements(changes->'transactions'->'put') x where x->>'recurring_charge_id'=bill::text;
   if n<>1 then raise exception 'Estimate requires one associated payment'; end if;
   select sum(case when i.status in ('avoided','cancelled','reused') then 0 else i.amount-i.adjustment end)-max(tx.one_time_amount) into payment from public.transactions tx join public.transaction_items i on i.transaction_id=tx.id and i.owner_id=own where tx.owner_id=own and tx.id=(select (x->>'id')::uuid from jsonb_array_elements(changes->'transactions'->'put') x where x->>'recurring_charge_id'=bill::text);
   if payment is null or payment<0 or payment<>(r->>'amount')::numeric then raise exception 'Estimate does not match recurring portion'; end if;
  end loop;
 end if;
 -- Finalize only metadata for an uploaded private object with matching type/size.
 for r in select value from jsonb_array_elements(coalesce(changes->'attachments'->'put','[]')) loop
  if not exists(select 1 from storage.objects o where o.bucket_id='50a-evidence' and o.name=r->>'storage_path' and (o.metadata->>'size')::bigint=(r->>'size_bytes')::bigint and o.metadata->>'mimetype'=r->>'mime_type') then raise exception 'Evidence object missing or mismatched'; end if;
 end loop;
 result:=public.ledger_read(4)->>'revision';
 insert into public.ledger_operations(owner_id,operation_id,payload_hash,result_revision) values(own,ledger_apply.operation_id,digest,result);
 return jsonb_build_object('revision',result,'replayed',false);
end $$;


create or replace function public.ledger_capabilities() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null and current_user <> 'service_role' then
  raise exception 'Authentication required' using errcode='42501';
 end if;
 return '{"contract_version":4,"domains":["transactions","transaction_items","recurring_charges","water_events","user_settings","benchmark_adjustments","property_condition","attachments","vehicles","fuel_events","income_sources","financial_goals","work_sessions","paychecks","coverage_settings","recurring_charge_revisions"],"features":["tax_bucket","multi_property_photos","automotive_transaction_link","alexa_water_v1","housing_coverage_v1","recurring_autopay_v1"],"read_versions":[1,2,3,4]}'::jsonb;
end $$;
revoke all on function public.ledger_capabilities() from public,anon;
grant execute on function public.ledger_capabilities() to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
