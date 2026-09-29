-- Housing Coverage source records only. No personal records or baseline seeded.
begin;
create table public.income_sources (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 4000), source_type text not null check(source_type in ('employment','other')),
 active boolean not null, hourly_rate_cents bigint check(hourly_rate_cents between 0 and 10000000),
 typical_shift_hundredths integer check(typical_shift_hundredths between 1 and 2400),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,id)
);
create table public.financial_goals (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 4000), goal_type text not null check(goal_type in ('debt','investment','other')),
 target_cents bigint not null check(target_cents between 0 and 99999999999), active boolean not null, completed boolean not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,id)
);
create table public.work_sessions (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade, income_source_id uuid not null,
 work_date date not null check(work_date between date '0001-01-01' and date '9999-12-31'),
 hours_hundredths integer not null check(hours_hundredths between 1 and 2400), hourly_rate_cents bigint not null check(hourly_rate_cents between 1 and 10000000), notes text not null default '' check(length(notes)<=4000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(owner_id,income_source_id) references public.income_sources(owner_id,id) on delete restrict
);
create table public.paychecks (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade, income_source_id uuid not null,
 pay_date date not null check(pay_date between date '0001-01-01' and date '9999-12-31'), period_start date, period_end date,
 gross_cents bigint check(gross_cents between 0 and 99999999999), net_cents bigint not null check(net_cents between 0 and 99999999999), notes text not null default '' check(length(notes)<=4000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(owner_id,income_source_id) references public.income_sources(owner_id,id) on delete restrict,
 check((period_start is null and period_end is null) or (period_start is not null and period_end is not null and period_start>=date '0001-01-01' and period_end<=date '9999-12-31' and period_end>=period_start and period_end-period_start<=366))
);
create table public.coverage_settings (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 effective_month text not null check(effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and effective_month>='0001-01'), income_source_id uuid, goal_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,effective_month),
 foreign key(owner_id,income_source_id) references public.income_sources(owner_id,id) on delete restrict,
 foreign key(owner_id,goal_id) references public.financial_goals(owner_id,id) on delete restrict
);
create table public.recurring_charge_revisions (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade, recurring_charge_id uuid not null,
 effective_month text not null check(effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and effective_month>='0001-01'),
 amount_cents bigint not null check(amount_cents between 0 and 99999999999), active boolean not null, included boolean not null,
 kind text not null check(kind in ('fixed','estimated')), category text not null check(length(btrim(category)) between 1 and 4000), utility_type text not null check(length(utility_type)<=4000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,recurring_charge_id,effective_month), foreign key(owner_id,recurring_charge_id) references public.recurring_charges(owner_id,id) on delete restrict
);
create function public.coverage_pay_period_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,502002));
 if new.period_start is not null and exists(select 1 from public.paychecks p where p.owner_id=new.owner_id and p.income_source_id=new.income_source_id and p.id<>new.id and p.period_start<=new.period_end and p.period_end>=new.period_start) then raise exception 'Pay periods for one source cannot overlap';end if;
 return new;
end $$;
create trigger coverage_pay_period_guard before insert or update on public.paychecks for each row execute function public.coverage_pay_period_guard();
alter table public.income_sources enable row level security;
revoke all on public.income_sources from public,anon,authenticated;
grant select,insert,update,delete on public.income_sources to authenticated;
create policy owner_select on public.income_sources for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_insert on public.income_sources for insert to authenticated with check(owner_id=(select auth.uid()));
create policy owner_update on public.income_sources for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy owner_delete on public.income_sources for delete to authenticated using(owner_id=(select auth.uid()));
create trigger ledger_timestamps before insert or update on public.income_sources for each row execute function public.ledger_timestamps();
create index income_sources_owner on public.income_sources(owner_id);
alter table public.financial_goals enable row level security;
revoke all on public.financial_goals from public,anon,authenticated;
grant select,insert,update,delete on public.financial_goals to authenticated;
create policy owner_select on public.financial_goals for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_insert on public.financial_goals for insert to authenticated with check(owner_id=(select auth.uid()));
create policy owner_update on public.financial_goals for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy owner_delete on public.financial_goals for delete to authenticated using(owner_id=(select auth.uid()));
create trigger ledger_timestamps before insert or update on public.financial_goals for each row execute function public.ledger_timestamps();
create index financial_goals_owner on public.financial_goals(owner_id);
alter table public.work_sessions enable row level security;
revoke all on public.work_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.work_sessions to authenticated;
create policy owner_select on public.work_sessions for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_insert on public.work_sessions for insert to authenticated with check(owner_id=(select auth.uid()));
create policy owner_update on public.work_sessions for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy owner_delete on public.work_sessions for delete to authenticated using(owner_id=(select auth.uid()));
create trigger ledger_timestamps before insert or update on public.work_sessions for each row execute function public.ledger_timestamps();
create index work_sessions_owner on public.work_sessions(owner_id);
alter table public.paychecks enable row level security;
revoke all on public.paychecks from public,anon,authenticated;
grant select,insert,update,delete on public.paychecks to authenticated;
create policy owner_select on public.paychecks for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_insert on public.paychecks for insert to authenticated with check(owner_id=(select auth.uid()));
create policy owner_update on public.paychecks for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy owner_delete on public.paychecks for delete to authenticated using(owner_id=(select auth.uid()));
create trigger ledger_timestamps before insert or update on public.paychecks for each row execute function public.ledger_timestamps();
create index paychecks_owner on public.paychecks(owner_id);
alter table public.coverage_settings enable row level security;
revoke all on public.coverage_settings from public,anon,authenticated;
grant select,insert,update,delete on public.coverage_settings to authenticated;
create policy owner_select on public.coverage_settings for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_insert on public.coverage_settings for insert to authenticated with check(owner_id=(select auth.uid()));
create policy owner_update on public.coverage_settings for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy owner_delete on public.coverage_settings for delete to authenticated using(owner_id=(select auth.uid()));
create trigger ledger_timestamps before insert or update on public.coverage_settings for each row execute function public.ledger_timestamps();
create index coverage_settings_owner on public.coverage_settings(owner_id);
alter table public.recurring_charge_revisions enable row level security;
revoke all on public.recurring_charge_revisions from public,anon,authenticated;
grant select,insert,update,delete on public.recurring_charge_revisions to authenticated;
create policy owner_select on public.recurring_charge_revisions for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_insert on public.recurring_charge_revisions for insert to authenticated with check(owner_id=(select auth.uid()));
create policy owner_update on public.recurring_charge_revisions for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy owner_delete on public.recurring_charge_revisions for delete to authenticated using(owner_id=(select auth.uid()));
create trigger ledger_timestamps before insert or update on public.recurring_charge_revisions for each row execute function public.ledger_timestamps();
create index recurring_charge_revisions_owner on public.recurring_charge_revisions(owner_id);
create or replace function public.ledger_read(client_version integer) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; data_tmp jsonb; t text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if client_version not in (2,3) then raise exception 'Update the 50A app before cloud access'; end if;
 -- Old browser clients must not silently export a backup missing finance records.
 -- Trusted service-role bridges receive the COMPLETE snapshot without changing their API.
 if client_version=2 and current_setting('role',true)<>'service_role' and (
 exists(select 1 from public.income_sources where owner_id=auth.uid()) or exists(select 1 from public.financial_goals where owner_id=auth.uid()) or exists(select 1 from public.coverage_settings where owner_id=auth.uid()) or exists(select 1 from public.recurring_charge_revisions where owner_id=auth.uid())) then raise exception 'Update 50A to shell v27 for complete Housing Coverage access';end if;
 data:='{}';
 foreach t in array array['transactions','transaction_items','recurring_charges','water_events','user_settings','benchmark_adjustments','property_condition','attachments','vehicles','fuel_events','income_sources','financial_goals','work_sessions','paychecks','coverage_settings','recurring_charge_revisions'] loop
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
 snapshot:=public.ledger_read(3);
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
 result:=public.ledger_read(3)->>'revision';
 insert into public.ledger_operations(owner_id,operation_id,payload_hash,result_revision) values(own,ledger_apply.operation_id,digest,result);
 return jsonb_build_object('revision',result,'replayed',false);
end $$;


create or replace function public.ledger_capabilities() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null and current_user <> 'service_role' then
  raise exception 'Authentication required' using errcode='42501';
 end if;
 return '{"contract_version":3,"domains":["transactions","transaction_items","recurring_charges","water_events","user_settings","benchmark_adjustments","property_condition","attachments","vehicles","fuel_events","income_sources","financial_goals","work_sessions","paychecks","coverage_settings","recurring_charge_revisions"],"features":["tax_bucket","multi_property_photos","automotive_transaction_link","alexa_water_v1","housing_coverage_v1"],"read_versions":[1,2,3]}'::jsonb;
end $$;
revoke all on function public.ledger_capabilities() from public,anon;
grant execute on function public.ledger_capabilities() to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
