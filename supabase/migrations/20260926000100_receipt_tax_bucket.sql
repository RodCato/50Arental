-- Expand only the item bucket allowlist. No rows, RPCs, RLS or privileges change.
-- Deploy before the Phase 4B application; old clients cannot import tax-bearing backups.
begin;
alter table public.transaction_items drop constraint transaction_items_bucket_check;
alter table public.transaction_items add constraint transaction_items_bucket_check
  check (bucket in ('housing_recurring','utilities','housing_one_time','groceries','refundable_deposit','excluded','tax')) not valid;
alter table public.transaction_items validate constraint transaction_items_bucket_check;
commit;
