-- Alexa-001: server-only, append-only bridge. No existing rows/policies rewritten.
-- Deploy and verify grants BEFORE deploying the dependent server/Lambda.
begin;
create or replace function public.ledger_capabilities() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null and current_user <> 'service_role' then
  raise exception 'Authentication required' using errcode='42501';
 end if;
 return '{"contract_version":2,"domains":["transactions","transaction_items","recurring_charges","water_events","user_settings","benchmark_adjustments","property_condition","attachments","vehicles","fuel_events"],"features":["tax_bucket","multi_property_photos","automotive_transaction_link","alexa_water_v1"],"read_versions":[1,2]}'::jsonb;
end $$;
revoke all on function public.ledger_capabilities() from public,anon;
grant execute on function public.ledger_capabilities() to authenticated,service_role;

create function public.alexa_log_water(p_owner uuid,p_event uuid,p_operation uuid,p_completed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 old_sub text:=current_setting('request.jwt.claim.sub',true);
 changes jsonb; snapshot jsonb; result jsonb; previous public.ledger_operations;
 existing public.water_events; has_receipt boolean;
begin
 if p_owner is null or p_event is null or p_operation is null or p_event=p_operation
    or substr(p_event::text,15,1)<>'5' or substr(p_operation::text,15,1)<>'5'
    or p_completed_at is null or not isfinite(p_completed_at) or p_completed_at<>date_trunc('milliseconds',p_completed_at) then
  raise exception 'Invalid voice identity' using errcode='22023';
 end if;
 if not exists(select 1 from auth.users u where u.id=p_owner and u.deleted_at is null
   and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()))
   or not exists(select 1 from public.user_settings s where s.owner_id=p_owner) then
  raise exception 'Voice owner unavailable' using errcode='42501';
 end if;
 -- Same serialization boundary as ledger_apply: no stale-revision race with PWA RPCs.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,502002));
 -- ledger_apply uses upsert. Serialize insert collisions (including other owners)
 -- before inspecting IDs so this privileged append can NEVER overwrite an event.
 lock table public.water_events in share row exclusive mode;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,502003));
 select * into previous from public.ledger_operations o where o.owner_id=p_owner and o.operation_id=p_operation;
 has_receipt:=found;
 select * into existing from public.water_events w where w.id=p_event;
 if found and (not has_receipt or existing.owner_id<>p_owner or existing.completed_at is distinct from p_completed_at
                or existing.gallons<>1 or existing.legacy) then
  raise exception 'Voice identity conflict' using errcode='22023';
 end if;
 if has_receipt and existing.id is null then
  -- A later user deletion must never be undone by a replay.
  raise exception 'Voice event no longer present' using errcode='22023';
 end if;
 if exists(select 1 from public.ledger_operations o where o.operation_id=p_operation and o.owner_id<>p_owner) then
  raise exception 'Voice identity conflict' using errcode='22023';
 end if;
 if not has_receipt then
  if p_completed_at<now()-interval '5 minutes' or p_completed_at>now()+interval '1 minute' then
   raise exception 'Voice request expired' using errcode='22023';
  end if;
  -- Durable, serialized owner-wide receipt budget; replay bypasses this budget.
  -- Counts PWA operations too, but never restricts normal PWA mutations.
  if (select count(*) from public.ledger_operations o where o.owner_id=p_owner and o.created_at>now()-interval '1 minute')>=30
     or (select count(*) from public.ledger_operations o where o.owner_id=p_owner and o.created_at>now()-interval '1 day')>=200 then
   raise exception 'Voice rate limit' using errcode='P0429';
  end if;
 end if;
 -- This is a transaction-local database execution context, NOT an Auth session/JWT.
 -- It is never returned, persisted, or refreshed, and is restored before returning.
 -- The trusted function constructs the ONLY payload that can reach ledger_apply.
 perform set_config('request.jwt.claim.sub',p_owner::text,true);
 if not (public.ledger_capabilities()->'features' ? 'alexa_water_v1') then
  raise exception 'Voice capability unavailable' using errcode='0A000';
 end if;
 changes:=jsonb_build_object('water_events',jsonb_build_object('put',jsonb_build_array(jsonb_build_object(
  'id',p_event,'owner_id',p_owner,'completed_at',to_char(p_completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'gallons',1,'legacy',false)),'remove','[]'::jsonb));
 snapshot:=public.ledger_read(2);
 result:=public.ledger_apply(p_operation,snapshot->>'revision',changes);
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 return jsonb_build_object('replayed',(result->>'replayed')::boolean);
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 raise;
end $$;
revoke all on function public.alexa_log_water(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.alexa_log_water(uuid,uuid,uuid,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
