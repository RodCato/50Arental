-- Explicit Phase 2B APIs. No existing ledger rows are changed by this migration.
begin;
create table public.ledger_operations (
 owner_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,
 payload_hash text not null,
 result_revision text not null,
 created_at timestamptz not null default now(),
 primary key(owner_id,operation_id)
);
alter table public.ledger_operations enable row level security;
revoke all on public.ledger_operations from public,anon,authenticated;
grant select,insert on public.ledger_operations to authenticated;
create policy owner_read on public.ledger_operations for select to authenticated using(owner_id=auth.uid());
create policy owner_insert on public.ledger_operations for insert to authenticated with check(owner_id=auth.uid());
create function public.ledger_read() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; data_tmp jsonb; t text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 data:='{}';
 foreach t in array array['transactions','transaction_items','recurring_charges','water_events','user_settings','benchmark_adjustments','property_condition','attachments'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from public.%I r where owner_id=$1',t) into strict data_tmp using auth.uid();
 data:=data||jsonb_build_object(t,data_tmp);
 end loop;
 return jsonb_build_object('rows',data,'revision',md5(data::text));
end $$;
create function public.ledger_apply(operation_id uuid,expected_revision text,changes jsonb) returns jsonb
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
 snapshot:=public.ledger_read();
 if snapshot->>'revision'<>expected_revision then raise exception 'Ledger changed on another device' using errcode='40001'; end if;
 for t in select jsonb_object_keys(changes) loop
  if t not in ('transactions','transaction_items','recurring_charges','water_events','user_settings','benchmark_adjustments') then raise exception 'Unsupported domain'; end if;
  entry:=changes->t;
  if jsonb_typeof(entry->'put')<>'array' or jsonb_typeof(entry->'remove')<>'array' then raise exception 'Invalid mutation'; end if;
  for r in select value from jsonb_array_elements(entry->'put') loop
   if r->>'owner_id' is distinct from own::text or r ? 'created_at' or r ? 'updated_at' then raise exception 'Invalid owner/audit fields' using errcode='42501'; end if;
  end loop;
 end loop;
 -- Deletes precede puts; the entire operation, including dependent rows, is atomic.
 foreach t in array array['transaction_items','transactions','benchmark_adjustments','water_events','recurring_charges'] loop
  for r in select value from jsonb_array_elements(coalesce(changes->t->'remove','[]')) loop
   execute format('delete from public.%I where owner_id=$1 and id=$2',t) using own,(r#>>'{}')::uuid;
  end loop;
 end loop;
 if coalesce(jsonb_array_length(changes->'user_settings'->'remove'),0)>0 then raise exception 'Settings cannot be removed'; end if;
 foreach t in array array['recurring_charges','transactions','transaction_items','water_events','user_settings','benchmark_adjustments'] loop
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
   if exists(select 1 from jsonb_array_elements(snapshot->'rows'->'recurring_charges') b where b->>'id'=bill::text and b->>'kind'='fixed') then raise exception 'Payment cannot rewrite fixed bill'; end if;
   select count(*) into n from jsonb_array_elements(changes->'transactions'->'put') x where x->>'recurring_charge_id'=bill::text;
   if n<>1 then raise exception 'Estimate requires one associated payment'; end if;
   select sum(case when i.status in ('avoided','cancelled','reused') then 0 else i.amount-i.adjustment end)-max(tx.one_time_amount) into payment from public.transactions tx join public.transaction_items i on i.transaction_id=tx.id and i.owner_id=own where tx.owner_id=own and tx.id=(select (x->>'id')::uuid from jsonb_array_elements(changes->'transactions'->'put') x where x->>'recurring_charge_id'=bill::text);
   if payment is null or payment<0 or payment<>(r->>'amount')::numeric then raise exception 'Estimate does not match recurring portion'; end if;
  end loop;
 end if;
 result:=public.ledger_read()->>'revision';
 insert into public.ledger_operations(owner_id,operation_id,payload_hash,result_revision) values(own,ledger_apply.operation_id,digest,result);
 return jsonb_build_object('revision',result,'replayed',false);
end $$;
revoke all on function public.ledger_read() from public,anon;
revoke all on function public.ledger_apply(uuid,text,jsonb) from public,anon;
grant execute on function public.ledger_read(),public.ledger_apply(uuid,text,jsonb) to authenticated;
commit;
