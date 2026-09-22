-- Phase 1 only: empty cloud foundation. No import of local records or files.
begin;

create function public.ledger_timestamps() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then new.created_at = clock_timestamp();
  else new.created_at = old.created_at;
  end if;
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function public.ledger_timestamps() from public;

create table public.recurring_charges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  amount numeric(12,2) not null check (amount >= 0),
  category text not null,
  kind text not null check (kind in ('fixed','estimated')),
  utility_type text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id,id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  merchant text not null check (length(trim(merchant)) > 0),
  transaction_date date not null,
  notes text not null default '',
  recurring_charge_id uuid,
  one_time_amount numeric(12,2) not null default 0 check (one_time_amount >= 0),
  system_key text,
  sample_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id,id),
  foreign key (owner_id,recurring_charge_id) references public.recurring_charges(owner_id,id) on delete restrict
);
create unique index transactions_system_key on public.transactions(owner_id,system_key) where system_key is not null;
create unique index transactions_sample_key on public.transactions(owner_id,sample_key) where sample_key is not null;
create index transactions_owner_date on public.transactions(owner_id,transaction_date);

create table public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  position integer not null default 0 check (position >= 0),
  description text not null check (length(trim(description)) > 0),
  amount numeric(12,2) not null check (amount >= 0),
  category text not null,
  bucket text not null check (bucket in ('housing_recurring','utilities','housing_one_time','groceries','refundable_deposit','excluded')),
  setup_class text not null default 'none' check (setup_class in ('move_in_essential','forgotten_essential','post_move_improvement','lease_service_setup','none')),
  status text not null default 'kept' check (status in ('kept','returned','refunded','reused','cancelled','avoided')),
  adjustment numeric(12,2) not null default 0 check (adjustment >= 0),
  deposit_status text not null default 'held' check (deposit_status in ('held','refunded','partially_refunded','forfeited')),
  deposit_refunded numeric(12,2) not null default 0 check (deposit_refunded >= 0 and deposit_refunded <= amount),
  move_in boolean not null default false,
  prorated boolean not null default false,
  estimated boolean not null default false,
  recurring boolean not null default false,
  gift_card_offset numeric(12,2) not null default 0 check (gift_card_offset >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id,transaction_id) references public.transactions(owner_id,id) on delete cascade
);
create index transaction_items_parent on public.transaction_items(owner_id,transaction_id);

create table public.property_condition (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  room text not null,
  phase text not null check (phase in ('move-in','move-out')),
  condition_date date not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id,id)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid,
  property_condition_id uuid,
  storage_bucket text not null default '50a-evidence' check (storage_bucket = '50a-evidence'),
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/webp','image/jpeg','image/png')),
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 20971520),
  attachment_type text not null check (attachment_type in ('receipt','property')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id,transaction_id) references public.transactions(owner_id,id) on delete cascade,
  foreign key (owner_id,property_condition_id) references public.property_condition(owner_id,id) on delete cascade,
  check ((attachment_type='receipt' and transaction_id is not null and property_condition_id is null)
      or (attachment_type='property' and transaction_id is null and property_condition_id is not null)),
  check (storage_path ~ ('^' || owner_id::text || '/' || case when attachment_type='receipt' then 'receipts' else 'property' end || '/' || id::text || '\.(webp|jpg|jpeg|png)$'))
);
create index attachments_transaction on public.attachments(owner_id,transaction_id);
create index attachments_property on public.attachments(owner_id,property_condition_id);

create table public.water_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz,
  gallons integer not null default 1 check (gallons > 0),
  legacy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_at is not null or legacy)
);
create index water_events_owner_date on public.water_events(owner_id,completed_at);

create table public.user_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  setup_budget numeric(12,2) not null default 400 check (setup_budget >= 0),
  forgotten_essentials_budget numeric(12,2) not null default 100 check (forgotten_essentials_budget >= 0),
  josh_rent numeric(12,2) not null default 1450 check (josh_rent >= 0),
  josh_stay_days integer not null default 68 check (josh_stay_days > 0),
  move_in_date date,
  prorated_rent numeric(12,2) not null default 321.60 check (prorated_rent >= 0),
  admin_fee numeric(12,2) not null default 150 check (admin_fee >= 0),
  deposit_amount numeric(12,2) not null default 800 check (deposit_amount >= 0),
  deposit_status text not null default 'held' check (deposit_status in ('held','refunded','partially_refunded','forfeited')),
  deposit_refunded numeric(12,2) not null default 0 check (deposit_refunded >= 0 and deposit_refunded <= deposit_amount),
  waterdrop_name text not null default 'Waterdrop',
  waterdrop_baseline_cost_per_gallon numeric(12,4) not null default 1.25 check (waterdrop_baseline_cost_per_gallon >= 0),
  waterdrop_system_cost numeric(12,2) not null default 73.35 check (waterdrop_system_cost >= 0),
  waterdrop_break_even_gallon integer not null default 59 check (waterdrop_break_even_gallon > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.benchmark_adjustments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  amount numeric(12,2) not null check (amount >= 0),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Explicit per-operation owner policies on every user table, including child rows.
do $$
declare table_name text;
begin
  foreach table_name in array array['recurring_charges','transactions','transaction_items','property_condition','attachments','water_events','user_settings','benchmark_adjustments'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated',table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated',table_name);
    execute format('create policy owner_select on public.%I for select to authenticated using (owner_id = (select auth.uid()))',table_name);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))',table_name);
    execute format('create policy owner_update on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',table_name);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (owner_id = (select auth.uid()))',table_name);
    execute format('create trigger ledger_timestamps before insert or update on public.%I for each row execute function public.ledger_timestamps()',table_name);
  end loop;
end $$;
create index recurring_charges_owner on public.recurring_charges(owner_id);
create index property_condition_owner on public.property_condition(owner_id);
create index benchmark_adjustments_owner on public.benchmark_adjustments(owner_id);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('50a-evidence','50a-evidence',false,20971520,array['image/webp','image/jpeg','image/png']);

create policy evidence_select on storage.objects for select to authenticated
using (bucket_id='50a-evidence' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy evidence_insert on storage.objects for insert to authenticated
with check (bucket_id='50a-evidence' and (storage.foldername(name))[1]=(select auth.uid()::text)
  and name ~ ('^' || (select auth.uid()::text) || '/(receipts|property)/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'));
create policy evidence_update on storage.objects for update to authenticated
using (bucket_id='50a-evidence' and (storage.foldername(name))[1]=(select auth.uid()::text))
with check (bucket_id='50a-evidence' and (storage.foldername(name))[1]=(select auth.uid()::text)
  and name ~ ('^' || (select auth.uid()::text) || '/(receipts|property)/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'));
create policy evidence_delete on storage.objects for delete to authenticated
using (bucket_id='50a-evidence' and (storage.foldername(name))[1]=(select auth.uid()::text));

-- Narrow read-only diagnostic. Does not expose bucket listings or user rows.
create function public.ledger_foundation_health() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  return jsonb_build_object(
    'schema_version',1,
    'evidence_bucket_private',exists(select 1 from storage.buckets where id='50a-evidence' and not public),
    'storage_policies_present',(select count(*)=4 from pg_catalog.pg_policies where schemaname='storage' and tablename='objects' and policyname in ('evidence_select','evidence_insert','evidence_update','evidence_delete'))
  );
end $$;
revoke all on function public.ledger_foundation_health() from public,anon;
grant execute on function public.ledger_foundation_health() to authenticated;
commit;
