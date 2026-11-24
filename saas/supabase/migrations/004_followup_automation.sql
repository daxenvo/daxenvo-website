begin;

-- Private storage; only the checked RPCs below are exposed to PostgREST.
create table daxenvo_private.followup_policy (
  company_id uuid primary key references public.companies on delete cascade,
  delay_hours integer not null check (delay_hours between 1 and 8760),
  urgent_hours integer not null check (urgent_hours between 1 and 8760),
  max_attempts integer not null check (max_attempts between 0 and 20),
  batch_size integer not null check (batch_size between 1 and 100)
);
create table daxenvo_private.followup_contact (
  company_id uuid not null, prospect_id uuid not null,
  channel text check (channel in ('email','sms','phone')),
  opposed boolean not null default false,
  primary key(company_id,prospect_id),
  foreign key(company_id,prospect_id) references public.prospects(company_id,id) on delete cascade
);
create table daxenvo_private.followup_job (
  company_id uuid not null, request_id uuid not null,
  state text not null default 'pending' check (state in ('pending','scheduled','prepared','sent','cancelled','error')),
  reason text not null default 'new_request',
  channel text, due_at timestamptz, last_contact timestamptz, defer_until timestamptz,
  paused boolean not null default false, response text, sent_count int not null default 0,
  primary key(company_id,request_id),
  foreign key(company_id,request_id) references public.quote_requests(company_id,id) on delete cascade
);
create index followup_ready on daxenvo_private.followup_job(company_id,due_at,request_id)
  where state in ('pending','scheduled','error');
create table daxenvo_private.followup_history (
  id bigint generated always as identity primary key,
  company_id uuid not null, request_id uuid not null, happened_at timestamptz not null default clock_timestamp(),
  state text not null, reason text not null, due_at timestamptz, channel text,
  foreign key(company_id,request_id) references daxenvo_private.followup_job on delete cascade
);
create index followup_history_request on daxenvo_private.followup_history(company_id,request_id,id desc);
create table daxenvo_private.followup_event (
  company_id uuid not null, request_id uuid not null, operation_id uuid not null,
  actor uuid not null, kind text not null, value text, happened_at timestamptz not null default clock_timestamp(),
  primary key(company_id,request_id,operation_id),
  foreign key(company_id,request_id) references daxenvo_private.followup_job on delete cascade
);

alter table daxenvo_private.followup_job enable row level security;
alter table daxenvo_private.followup_policy enable row level security;
alter table daxenvo_private.followup_event enable row level security;
alter table daxenvo_private.followup_history enable row level security;
alter table daxenvo_private.followup_contact enable row level security;

create function daxenvo_private.audit_followup() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' or (new.state,new.reason,new.due_at,new.channel) is distinct from
      (old.state,old.reason,old.due_at,old.channel) then
    insert into daxenvo_private.followup_history(company_id,request_id,state,reason,due_at,channel)
      values(new.company_id,new.request_id,new.state,new.reason,new.due_at,new.channel);
  end if;
  return new;
end $$;
create trigger followup_audit after insert or update on daxenvo_private.followup_job
  for each row execute function daxenvo_private.audit_followup();

create function daxenvo_private.evaluate_followup(tenant uuid,target uuid) returns void
language plpgsql set search_path='' as $$
declare
  job daxenvo_private.followup_job;
  policy daxenvo_private.followup_policy;
  contact daxenvo_private.followup_contact;
  req public.quote_requests;
  qualification jsonb;
  stop_reason text;
  deadline timestamptz;
begin
  select * into job from daxenvo_private.followup_job where company_id=tenant and request_id=target for update;
  if not found then return; end if;
  select * into strict req from public.quote_requests where company_id=tenant and id=target;
  select * into policy from daxenvo_private.followup_policy where company_id=tenant;
  select * into contact from daxenvo_private.followup_contact where company_id=tenant and prospect_id=req.prospect_id;
  select result into qualification from public.request_qualifications where company_id=tenant and request_id=target
    order by revision desc limit 1;
  stop_reason := case
    when contact.opposed then 'opt_out'
    when req.status in ('gagnee','perdue') then req.status
    when job.response='refused' then 'refused'
    when job.paused then 'paused'
    when job.response in ('interested','information','appointment','human') then job.response
    when (qualification->>'requiresHumanReview')::boolean then 'qualification_review'
    when policy.company_id is null then 'not_configured'
    when job.sent_count >= policy.max_attempts then 'limit'
    when contact.channel is null then 'contact_preference_required'
  end;
  if stop_reason is null then
    deadline := greatest(job.defer_until, coalesce(job.last_contact,req.created_at) +
      make_interval(hours => case when qualification->>'priorite'='elevee' then policy.urgent_hours else policy.delay_hours end));
  end if;
  update daxenvo_private.followup_job set
    state=case when stop_reason is not null then 'cancelled' when deadline<=now() then 'prepared' else 'scheduled' end,
    reason=coalesce(stop_reason,case when deadline<=now() then 'awaiting_delivery' else 'waiting' end),
    due_at=deadline,channel=contact.channel
    where company_id=tenant and request_id=target;
end $$;

create function daxenvo_private.followup_source_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,9));
  if tg_table_name='quote_requests' then
    target:=new.id;
    insert into daxenvo_private.followup_job(company_id,request_id) values(new.company_id,target) on conflict do nothing;
  else
    target:=new.request_id;
  end if;
  perform daxenvo_private.evaluate_followup(new.company_id,target);
  return new;
end $$;
create trigger followup_request after insert or update of status,prospect_id on public.quote_requests
  for each row execute function daxenvo_private.followup_source_changed();
create trigger followup_qualification after insert on public.request_qualifications
  for each row execute function daxenvo_private.followup_source_changed();
insert into daxenvo_private.followup_job(company_id,request_id) select company_id,id from public.quote_requests;

create function daxenvo_private.followup_role(tenant uuid) returns text
language plpgsql stable set search_path='' as $$
declare membership text;
begin
  select role into membership from public.company_memberships where company_id=tenant and user_id=auth.uid();
  if membership is null then raise insufficient_privilege; end if;
  return membership;
end $$;

create function public.configure_followup_automation(tenant uuid,delay_hours int,urgent_hours int,max_attempts int,batch_size int)
returns void language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if daxenvo_private.followup_role(tenant) not in ('admin','owner') then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text,9));
  insert into daxenvo_private.followup_policy values(tenant,delay_hours,urgent_hours,max_attempts,batch_size)
    on conflict(company_id) do update set delay_hours=excluded.delay_hours,urgent_hours=excluded.urgent_hours,
      max_attempts=excluded.max_attempts,batch_size=excluded.batch_size
    where (followup_policy.delay_hours,followup_policy.urgent_hours,followup_policy.max_attempts,followup_policy.batch_size)
       is distinct from (excluded.delay_hours,excluded.urgent_hours,excluded.max_attempts,excluded.batch_size);
  if not found then return; end if;
  for target in select request_id from daxenvo_private.followup_job where company_id=tenant order by request_id loop
    perform daxenvo_private.evaluate_followup(tenant,target);
  end loop;
end $$;

create function public.followup_automation_event(tenant uuid,target uuid,operation uuid,kind text,value text default null)
returns void language plpgsql security definer set search_path='' as $$
declare membership text; prospect uuid; affected uuid; event daxenvo_private.followup_event; until_at timestamptz;
begin
  membership:=daxenvo_private.followup_role(tenant);
  if kind in ('resume','preference') and membership='member' then raise insufficient_privilege; end if;
  if kind is null or kind not in ('contact','interested','delay','information','appointment','refused','opt_out','human','pause','resume','preference')
    or operation is null or (kind='preference' and (value is null or value not in ('email','sms','phone')))
    or (kind='delay' and (value is null or length(value)>40 or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$'))
    or (kind not in ('preference','delay') and value is not null) then raise invalid_parameter_value; end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text,9));
  select prospect_id into prospect from public.quote_requests where company_id=tenant and id=target;
  if not found then raise no_data_found; end if;
  insert into daxenvo_private.followup_event(company_id,request_id,operation_id,actor,kind,value)
    values(tenant,target,operation,auth.uid(),kind,value) on conflict do nothing;
  if not found then
    select * into strict event from daxenvo_private.followup_event where company_id=tenant and request_id=target and operation_id=operation;
    if (event.actor,event.kind,event.value) is distinct from (auth.uid(),kind,value) then raise exception using errcode='PT409',message='EVENT_CONFLICT'; end if;
    return;
  end if;
  if kind in ('preference','opt_out') then
    insert into daxenvo_private.followup_contact as c(company_id,prospect_id,channel,opposed)
      values(tenant,prospect,case when kind='preference' then value end,kind='opt_out')
      on conflict(company_id,prospect_id) do update set channel=coalesce(excluded.channel,c.channel),opposed=c.opposed or excluded.opposed;
    for affected in select id from public.quote_requests where company_id=tenant and prospect_id=prospect order by id loop
      perform daxenvo_private.evaluate_followup(tenant,affected);
    end loop;
  else
    if kind='delay' then
      until_at:=value::timestamptz;
      if until_at<=now() then raise invalid_parameter_value; end if;
    end if;
    update daxenvo_private.followup_job j set
      last_contact=case when kind in ('pause','resume') then j.last_contact else now() end,
      paused=case when kind='pause' then true when kind='resume' then false else j.paused end,
      response=case when j.response='refused' or kind='pause' then j.response
        when kind='resume' then null when kind='contact' then j.response else kind end,
      defer_until=case when kind='delay' then until_at else j.defer_until end
      where company_id=tenant and request_id=target;
    perform daxenvo_private.evaluate_followup(tenant,target);
  end if;
end $$;

-- Scheduler entry point. No network I/O. One tenant per transaction.
create function daxenvo_private.run_followups(tenant uuid) returns integer language plpgsql set search_path='' as $$
declare target uuid; processed int:=0; cap int;
begin
  select batch_size into cap from daxenvo_private.followup_policy where company_id=tenant;
  if cap is null or not pg_try_advisory_xact_lock(hashtextextended(tenant::text,9)) then return 0; end if;
  for target in select request_id from daxenvo_private.followup_job where company_id=tenant
    and state in ('pending','scheduled','error') and (due_at is null or due_at<=now())
    order by due_at nulls first,request_id limit cap for update skip locked loop
    begin
      perform daxenvo_private.evaluate_followup(tenant,target);
    exception when others then
      update daxenvo_private.followup_job set state='error',reason=SQLSTATE,due_at=now()+interval '15 minutes'
        where company_id=tenant and request_id=target;
    end;
    processed:=processed+1;
  end loop;
  return processed;
end $$;

-- A preparation is identified by its immutable decision id. Only a trusted future
-- delivery integration may acknowledge that exact decision with a provider receipt.
create table daxenvo_private.followup_delivery (
  preparation_id bigint primary key references daxenvo_private.followup_history on delete cascade,
  provider_receipt text not null check (length(provider_receipt) between 1 and 256)
);
alter table daxenvo_private.followup_delivery enable row level security;
revoke all on daxenvo_private.followup_delivery from public,anon,authenticated;
create function daxenvo_private.confirm_followup_delivery(tenant uuid,target uuid,preparation bigint,receipt text)
returns void language plpgsql set search_path='' as $$
declare latest daxenvo_private.followup_history; previous text;
begin
  perform pg_advisory_xact_lock(hashtextextended(tenant::text,9));
  select d.provider_receipt into previous from daxenvo_private.followup_delivery d
    join daxenvo_private.followup_history h on h.id=d.preparation_id
    where h.company_id=tenant and h.request_id=target and h.id=preparation;
  if found and previous=receipt then return; end if;
  select * into latest from daxenvo_private.followup_history where company_id=tenant and request_id=target order by id desc limit 1;
  if latest.state is distinct from 'prepared' or latest.id is distinct from preparation then
    raise exception using errcode='PT409',message='STALE_PREPARATION';
  end if;
  insert into daxenvo_private.followup_delivery values(preparation,receipt);
  update daxenvo_private.followup_job set state='sent',reason='delivery_confirmed',sent_count=sent_count+1,last_contact=now()
    where company_id=tenant and request_id=target;
  perform daxenvo_private.evaluate_followup(tenant,target);
end $$;
revoke all on function daxenvo_private.confirm_followup_delivery(uuid,uuid,bigint,text) from public,anon,authenticated;

create function public.followup_automation_status(tenant uuid,target uuid,before_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare job daxenvo_private.followup_job; history jsonb;
begin
  perform daxenvo_private.followup_role(tenant);
  select * into job from daxenvo_private.followup_job where company_id=tenant and request_id=target;
  if not found then raise no_data_found; end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.id desc),'[]'::jsonb) into history from
    (select id,state,reason,due_at,channel,happened_at from daxenvo_private.followup_history
     where company_id=tenant and request_id=target and (before_id is null or id<before_id) order by id desc limit 25) h;
  return jsonb_build_object('job',to_jsonb(job),'history',history);
end $$;

revoke all on daxenvo_private.followup_job,daxenvo_private.followup_policy,daxenvo_private.followup_event,
  daxenvo_private.followup_history,daxenvo_private.followup_contact from public,anon,authenticated;
revoke all on function daxenvo_private.audit_followup(),daxenvo_private.evaluate_followup(uuid,uuid),
  daxenvo_private.followup_source_changed(),daxenvo_private.followup_role(uuid),daxenvo_private.run_followups(uuid)
  from public,anon,authenticated;
revoke all on function public.configure_followup_automation(uuid,int,int,int,int),public.followup_automation_event(uuid,uuid,uuid,text,text),
  public.followup_automation_status(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.configure_followup_automation(uuid,int,int,int,int),public.followup_automation_event(uuid,uuid,uuid,text,text),
  public.followup_automation_status(uuid,uuid,bigint) to authenticated;
commit;
