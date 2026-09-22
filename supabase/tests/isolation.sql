\set ON_ERROR_STOP on
begin;
insert into auth.users values ('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
-- Seed two full synthetic owners using their actual authenticated role.
set local role authenticated;
do $$
declare u uuid; tx uuid; rc uuid; prop uuid; att uuid;
begin
 foreach u in array array['aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'::uuid,'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'::uuid] loop
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into recurring_charges(owner_id,name,amount,category,kind) values(u,'TEST Electricity',93,'Utilities','estimated') returning id into rc;
  insert into transactions(owner_id,merchant,transaction_date,recurring_charge_id) values(u,'TEST merchant',current_date,rc) returning id into tx;
  insert into transaction_items(owner_id,transaction_id,description,amount,category,bucket) values(u,tx,'TEST service',75,'Utilities','utilities');
  insert into property_condition(owner_id,room,phase,condition_date) values(u,'TEST room','move-in',current_date) returning id into prop;
  att:=gen_random_uuid();
  insert into attachments(id,owner_id,transaction_id,storage_path,original_filename,mime_type,size_bytes,attachment_type) values(att,u,tx,u||'/receipts/'||att||'.webp','TEST.webp','image/webp',1,'receipt');
  insert into water_events(owner_id,completed_at) values(u,now());
  insert into user_settings(owner_id) values(u);
  insert into benchmark_adjustments(owner_id,label,amount) values(u,'TEST adjustment',1);
  insert into storage.objects(bucket_id,name) values('50a-evidence',u||'/receipts/'||att||'.webp');
 end loop;
end $$;
reset role;
-- Snapshot owner B parent IDs for deliberate cross-owner foreign-key attacks.
select set_config('test.b_tx',(select id::text from transactions where owner_id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'),true);
select set_config('test.b_rc',(select id::text from recurring_charges where owner_id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'),true);
select set_config('test.b_property',(select id::text from property_condition where owner_id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',true);
do $$
declare t text; n integer; oldstamp timestamptz; newstamp timestamptz; created timestamptz; rowjson jsonb; own uuid:=auth.uid(); other uuid:='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'; att uuid:=gen_random_uuid();
begin
 foreach t in array array['recurring_charges','transactions','transaction_items','property_condition','attachments','water_events','user_settings','benchmark_adjustments'] loop
  execute format('select count(*) from %I',t) into n;
  assert n=1, t||': must see exactly own row';
  execute format('update %I set updated_at=now() where owner_id=$1',t) using other;
  get diagnostics n=row_count; assert n=0,t||': cross-owner update';
  execute format('delete from %I where owner_id=$1',t) using other;
  get diagnostics n=row_count; assert n=0,t||': cross-owner delete';
  begin
   execute format('update %I set owner_id=$1',t) using other;
   raise exception 'Owner transfer unexpectedly permitted: %',t;
  exception when insufficient_privilege then null; end;
  -- Copy a valid row and attempt an INSERT as B (fresh PK and path).
  execute format('select to_jsonb(r) from %I r limit 1',t) into rowjson;
  rowjson:=rowjson||jsonb_build_object('owner_id',other);
  if t<>'user_settings' then rowjson:=rowjson||jsonb_build_object('id',gen_random_uuid()); end if;
  if t='attachments' then rowjson:=rowjson||jsonb_build_object('storage_path',other||'/receipts/'||(rowjson->>'id')||'.webp'); end if;
  begin
   execute format('insert into %I select * from jsonb_populate_record(null::%I,$1)',t,t) using rowjson;
   raise exception 'Impersonated insert permitted: %',t;
  exception when insufficient_privilege then null; end;
  execute format('select created_at,updated_at from %I limit 1',t) into created,oldstamp;
  execute format('update %I set created_at=''2000-01-01'',updated_at=''2000-01-01''',t);
  execute format('select updated_at from %I limit 1',t) into newstamp;
  assert newstamp>oldstamp,t||': server updated_at';
  execute format('select count(*) from %I where created_at=$1',t) into n using created;
  assert n=1,t||': created_at preserved';
 end loop;
 begin
  insert into transactions(owner_id,merchant,transaction_date,recurring_charge_id) values(own,'TEST cross',current_date,current_setting('test.b_rc')::uuid);
  raise exception 'Cross-owner recurring link allowed';
 exception when foreign_key_violation then null; end;
 begin
  insert into transaction_items(owner_id,transaction_id,description,amount,category,bucket) values(own,current_setting('test.b_tx')::uuid,'TEST cross',1,'Other','excluded');
  raise exception 'Cross-owner item parent allowed';
 exception when foreign_key_violation then null; end;
 begin
  insert into attachments(id,owner_id,property_condition_id,storage_path,original_filename,mime_type,size_bytes,attachment_type) values(att,own,current_setting('test.b_property')::uuid,own||'/property/'||att||'.webp','TEST.webp','image/webp',1,'property');
  raise exception 'Cross-owner evidence parent allowed';
 exception when foreign_key_violation then null; end;
 assert (select count(*) from storage.objects)=1,'Storage read isolation';
 update storage.objects set name=name where name like other||'/%';
 get diagnostics n=row_count; assert n=0,'Storage cross-owner update';
 delete from storage.objects where name like other||'/%';
 get diagnostics n=row_count; assert n=0,'Storage cross-owner delete';
 begin
  insert into storage.objects(bucket_id,name) values('50a-evidence',other||'/receipts/'||att||'.webp');
  raise exception 'Storage impersonation allowed';
 exception when insufficient_privilege then null; end;
 begin
  update storage.objects set name=other||'/receipts/'||att||'.webp';
  raise exception 'Storage owner transfer allowed';
 exception when insufficient_privilege then null; end;
 update storage.objects set name=own||'/property/'||att||'.webp';
 get diagnostics n=row_count; assert n=1,'Own Storage update';
 assert (public.ledger_foundation_health()->>'evidence_bucket_private')::boolean,'Private bucket health';
 assert (public.ledger_foundation_health()->>'storage_policies_present')::boolean,'Policies health';
 delete from transactions;
 assert (select count(*) from transaction_items)=0,'Cascade items';
 assert (select count(*) from attachments)=0,'Cascade metadata';
 delete from storage.objects;
 assert (select count(*) from storage.objects)=0,'Own Storage delete';
 foreach t in array array['transaction_items','attachments','transactions','recurring_charges','property_condition','water_events','user_settings','benchmark_adjustments'] loop
  execute format('delete from %I',t);
  execute format('select count(*) from %I',t) into n;
  assert n=0,t||': own deletion';
 end loop;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare t text; n integer;
begin
 foreach t in array array['recurring_charges','transactions','transaction_items','property_condition','attachments','water_events','user_settings','benchmark_adjustments'] loop
  begin
   execute format('select count(*) from %I',t) into n;
   raise exception 'Anonymous table access: %',t;
  exception when insufficient_privilege then null; end;
 end loop;
 assert (select count(*) from storage.objects)=0,'Anonymous Storage read';
 begin
  insert into storage.objects(bucket_id,name) values('50a-evidence','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/receipts/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.webp');
  raise exception 'Anonymous upload permitted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.ledger_foundation_health(); raise exception 'Anonymous health RPC permitted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 assert (select count(*) from transactions)=1,'Other owner records preserved';
 assert (select count(*) from storage.objects)=1,'Other owner files preserved';
 assert (select count(*) from pg_policies where schemaname='public')=32,'Four policies per personal table';
end $$;
delete from auth.users;
do $$ begin assert (select count(*) from recurring_charges)=0,'Account cascade'; end $$;
rollback;
\echo 'PASS: all eight tables, synthetic owner isolation, anonymous denial, parent constraints, timestamps, cascades, and private Storage policies.'
