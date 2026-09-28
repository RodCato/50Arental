-- Automotive Phase 1. Deploy before shell v25; no existing business rows rewritten.
begin;
alter table public.transaction_items drop constraint transaction_items_bucket_check;
alter table public.transaction_items add constraint transaction_items_bucket_check check(bucket in ('housing_recurring','utilities','housing_one_time','groceries','refundable_deposit','excluded','tax','automotive'));
create table public.vehicles(
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 nickname text not null check(length(btrim(nickname)) between 1 and 120), year integer check(year between 1886 and 2200),
 make text check(length(make)<=120), model text check(length(model)<=120), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.fuel_events(
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 vehicle_id uuid not null, fill_date date not null check(fill_date between date '0001-01-01' and date '9999-12-31'),
 total_cost numeric(12,2) not null check(total_cost>0 and total_cost<10000000000),
 gallons numeric(12,3) check(gallons>0 and gallons<1000000000), price_per_gallon numeric(12,3) check(price_per_gallon>0 and price_per_gallon<1000000000),
 odometer numeric(12,1) check(odometer>=0 and odometer<100000000000), full_tank boolean not null,
 station text, notes text, transaction_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(vehicle_id,owner_id) references public.vehicles(id,owner_id) on delete restrict,
 foreign key(transaction_id,owner_id) references public.transactions(id,owner_id) on delete no action deferrable initially deferred,
 unique(transaction_id),
 check(gallons is null or price_per_gallon is null or abs(round(gallons*price_per_gallon*100)-total_cost*100)<=greatest(2,ceil((gallons+price_per_gallon)/20+0.5)))
);
create index fuel_vehicle_date on public.fuel_events(owner_id,vehicle_id,fill_date);
do $$ declare t text; begin foreach t in array array['vehicles','fuel_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 execute format('create policy owner_select on public.%I for select to authenticated using(owner_id=(select auth.uid()))',t);
 execute format('create policy owner_insert on public.%I for insert to authenticated with check(owner_id=(select auth.uid()))',t);
 execute format('create policy owner_update on public.%I for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()))',t);
 execute format('create policy owner_delete on public.%I for delete to authenticated using(owner_id=(select auth.uid()))',t);
 execute format('create trigger ledger_timestamps before insert or update on public.%I for each row execute function public.ledger_timestamps()',t);
 end loop; end $$;
-- Deferred checks inspect the final atomic operation, including item-only financial edits.
create function public.validate_fuel_links() returns trigger language plpgsql security invoker set search_path='' as $$
declare own uuid:=coalesce(new.owner_id,old.owner_id); begin
 perform pg_advisory_xact_lock(hashtextextended(own::text,502002));
 if exists(select 1 from public.fuel_events f where f.owner_id=own and f.transaction_id is not null and f.total_cost is distinct from
 (select coalesce(sum(case when i.status in ('avoided','cancelled','reused') then 0 else i.amount-i.adjustment end),0) from public.transaction_items i where i.owner_id=own and i.transaction_id=f.transaction_id and i.bucket='automotive')) then raise exception 'Fuel cost must match linked transaction automotive spending'; end if;
 if exists(select 1 from public.fuel_events a join public.fuel_events b on a.owner_id=b.owner_id and a.vehicle_id=b.vehicle_id and a.fill_date<b.fill_date where a.owner_id=own and a.odometer>b.odometer) then raise exception 'Odometer cannot decrease'; end if;
 return null;
end $$;
create constraint trigger fuel_consistency after insert or update or delete on public.fuel_events deferrable initially deferred for each row execute function public.validate_fuel_links();
create constraint trigger fuel_item_consistency after insert or update or delete on public.transaction_items deferrable initially deferred for each row execute function public.validate_fuel_links();
create function public.ledger_read(client_version integer) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; data_tmp jsonb; t text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if client_version<>2 then raise exception 'Update the 50A app before cloud access'; end if;
 data:='{}';
 foreach t in array array['transactions','transaction_items','recurring_charges','water_events','user_settings','benchmark_adjustments','property_condition','attachments','vehicles','fuel_events'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from public.%I r where owner_id=$1',t) into strict data_tmp using auth.uid();
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
 snapshot:=public.ledger_read(2);
 if snapshot->>'revision'<>expected_revision then raise exception 'Ledger changed on another device' using errcode='40001'; end if;
 for t in select jsonb_object_keys(changes) loop
  if t not in ('transactions','transaction_items','recurring_charges','water_events','user_settings','benchmark_adjustments','property_condition','attachments','vehicles','fuel_events') then raise exception 'Unsupported domain'; end if;
  entry:=changes->t;
  if jsonb_typeof(entry->'put')<>'array' or jsonb_typeof(entry->'remove')<>'array' then raise exception 'Invalid mutation'; end if;
  for r in select value from jsonb_array_elements(entry->'put') loop
   if r->>'owner_id' is distinct from own::text or r ? 'created_at' or r ? 'updated_at' then raise exception 'Invalid owner/audit fields' using errcode='42501'; end if;
  end loop;
 end loop;
 -- Deletes precede puts; the entire operation, including dependent rows, is atomic.
 foreach t in array array['fuel_events','vehicles','attachments','property_condition','transaction_items','transactions','benchmark_adjustments','water_events','recurring_charges'] loop
  for r in select value from jsonb_array_elements(coalesce(changes->t->'remove','[]')) loop
   execute format('delete from public.%I where owner_id=$1 and id=$2',t) using own,(r#>>'{}')::uuid;
  end loop;
 end loop;
 if coalesce(jsonb_array_length(changes->'user_settings'->'remove'),0)>0 then raise exception 'Settings cannot be removed'; end if;
 foreach t in array array['vehicles','recurring_charges','transactions','transaction_items','water_events','user_settings','benchmark_adjustments','property_condition','attachments','fuel_events'] loop
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
 -- Finalize only metadata for an uploaded private object with matching type/size.
 for r in select value from jsonb_array_elements(coalesce(changes->'attachments'->'put','[]')) loop
  if not exists(select 1 from storage.objects o where o.bucket_id='50a-evidence' and o.name=r->>'storage_path' and (o.metadata->>'size')::bigint=(r->>'size_bytes')::bigint and o.metadata->>'mimetype'=r->>'mime_type') then raise exception 'Evidence object missing or mismatched'; end if;
 end loop;
 result:=public.ledger_read(2)->>'revision';
 insert into public.ledger_operations(owner_id,operation_id,payload_hash,result_revision) values(own,ledger_apply.operation_id,digest,result);
 return jsonb_build_object('revision',result,'replayed',false);
end $$;


-- Older clients must never export a seemingly complete backup that omits Automotive.
create or replace function public.ledger_read() returns jsonb language plpgsql stable security invoker set search_path='' as $$ begin
 if exists(select 1 from public.vehicles where owner_id=auth.uid()) or exists(select 1 from public.fuel_events where owner_id=auth.uid()) then raise exception 'Update 50A to shell v25 or later to read/export Automotive history'; end if;
 return public.ledger_read(2);
end $$;
revoke all on function public.ledger_read(integer) from public,anon;
grant execute on function public.ledger_read(integer) to authenticated;
notify pgrst, 'reload schema';
commit;
