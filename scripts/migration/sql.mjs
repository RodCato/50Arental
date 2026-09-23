import {TABLES} from './model.mjs';
export const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
export const tableList=TABLES.map(quote).join(',');
export const snapshotSQL=`select jsonb_build_object(${TABLES.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.${t} r)`).join(',')}) as rows, (select count(*) from storage.objects where bucket_id='50a-evidence') as objects, (select count(*) from storage.buckets where id='50a-evidence' and not public) as private_buckets`;
export const schemaSQL=`select jsonb_build_object(
 'columns',(select jsonb_agg(to_jsonb(c) order by table_name,ordinal_position) from (select table_name,column_name,ordinal_position,data_type,is_nullable,column_default,numeric_precision,numeric_scale from information_schema.columns where table_schema='public' and table_name in (${tableList})) c),
 'constraints',(select jsonb_agg(to_jsonb(c) order by table_name,definition) from (select cl.relname as table_name,pg_get_constraintdef(co.oid) as definition from pg_constraint co join pg_class cl on cl.oid=co.conrelid join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='public' and cl.relname in (${tableList})) c),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from (select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in (${tableList})) p),
 'rls',(select jsonb_agg(jsonb_build_object('table',relname,'enabled',relrowsecurity) order by relname) from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relname in (${tableList})),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${tableList}) and not t.tgisinternal)
) as schema`;
export function applySQL(rows,owner){
 const tables=TABLES.map(t=>'public.'+t).join(',');
 const inserts=TABLES.filter(t=>rows[t].length).map(t=>{const cols=Object.keys(rows[t][0]).join(',');return `insert into public.${t} (${cols}) select ${cols} from jsonb_populate_recordset(null::public.${t},${quote(JSON.stringify(rows[t]))}::jsonb);`;}).join('\n');
 return `begin; select pg_advisory_xact_lock(502002);
lock table ${tables} in share row exclusive mode;
lock table storage.objects,storage.buckets in share mode;
do $$ begin
 if ${TABLES.map(t=>`exists(select 1 from public.${t})`).join(' or ')} then raise exception 'Destination changed: not empty'; end if;
 if exists(select 1 from storage.objects where bucket_id='50a-evidence') or not exists(select 1 from storage.buckets where id='50a-evidence' and not public) then raise exception 'Storage preflight failed'; end if;
 if not exists(select 1 from auth.users where id=${quote(owner)}::uuid and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<now())) then raise exception 'Owner verification failed'; end if;
end $$;
select set_config('request.jwt.claim.sub',${quote(owner)},true);
set local role authenticated;
${inserts}
commit;`;
}
// No inserts/deletes in production policy verification. Non-owner no-op updates must
// affect zero rows; the transaction rolls back even if an assertion detects a defect.
export function rlsSQL(owner,other,rows){return `begin;
set local role authenticated;
select set_config('request.jwt.claim.sub',${quote(owner)},true);
do $$ begin ${TABLES.map(t=>`if (select count(*) from public.${t})<>${rows[t].length} then raise exception 'Owner read failed: ${t}'; end if;`).join('\n')} end $$;
select set_config('request.jwt.claim.sub',${quote(other)},true);
do $$ declare n integer; begin ${TABLES.map(t=>`if exists(select 1 from public.${t}) then raise exception 'Non-owner read failed: ${t}'; end if;
update public.${t} set owner_id=owner_id where owner_id=${quote(owner)}::uuid; get diagnostics n=row_count; if n<>0 then raise exception 'Non-owner update failed: ${t}'; end if;`).join('\n')} end $$;
reset role; set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ declare n integer; begin ${TABLES.map(t=>`begin select count(*) into n from public.${t}; raise exception 'Anonymous access: ${t}'; exception when insufficient_privilege then null; end;`).join('\n')} end $$;
rollback;
select true as rls_pass;`;}
