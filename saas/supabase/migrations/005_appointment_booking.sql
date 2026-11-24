begin;

-- One operator-provisioned connection per tenant. Raw tokens stay on the server.
create table daxenvo_private.booking_calendar (
  company_id uuid primary key references public.companies on delete cascade,
  binding uuid not null unique, writer_digest bytea not null check(octet_length(writer_digest)=32),
  per_minute int not null default 20 check(per_minute between 1 and 120),
  daily_creates int not null default 5 check(daily_creates between 1 and 1000),
  minute_start timestamptz, minute_used int not null default 0,
  day_start timestamptz, day_used int not null default 0, blocked_until timestamptz
);
create table daxenvo_private.bookings (
  id uuid primary key default gen_random_uuid(), operation uuid not null,
  company_id uuid not null references daxenvo_private.booking_calendar on delete restrict,
  request_id uuid not null, binding uuid not null, title text not null check(length(title) between 2 and 160),
  starts_at timestamptz not null, duration_minutes int not null check(duration_minutes between 15 and 240),
  proposed_start timestamptz not null, proposed_minutes int not null,
  invitee_hash text, rejected boolean not null default false, zone text not null, state text not null check(state in ('proposed','pending','confirmed','cancelled','error')),
  reference text unique, observed_at timestamptz, revision int not null default 1,
  cancel_requested boolean not null default false, failures int not null default 0, last_error text, retry_at timestamptz,
  unique(company_id,operation),
  foreign key(company_id,request_id) references public.quote_requests(company_id,id) on delete cascade
);
create index bookings_request on daxenvo_private.bookings(company_id,request_id);
create index bookings_slots on daxenvo_private.bookings(company_id,starts_at) where state in ('pending','confirmed','error');

alter table daxenvo_private.booking_calendar enable row level security;
alter table daxenvo_private.bookings enable row level security;
revoke all on daxenvo_private.booking_calendar,daxenvo_private.bookings from public,anon,authenticated,service_role;

-- A J8 appointment exists only while its provider booking is confirmed.
alter table public.appointments add column provider_managed boolean not null default false;
create policy booking_projection_insert on public.appointments as restrictive for insert to authenticated with check(not provider_managed);
create policy booking_projection_update on public.appointments as restrictive for update to authenticated using(not provider_managed) with check(not provider_managed);
create policy booking_projection_delete on public.appointments as restrictive for delete to authenticated using(not provider_managed);

create function daxenvo_private.booking_followup_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.state in ('prepared','scheduled') and exists(select from daxenvo_private.bookings
    where company_id=new.company_id and request_id=new.request_id and state='confirmed') then
    new.state:='cancelled'; new.reason:='confirmed_appointment'; new.due_at:=null;
  end if;
  return new;
end $$;
create trigger booking_followup_guard before update on daxenvo_private.followup_job
  for each row execute function daxenvo_private.booking_followup_guard();

create function daxenvo_private.project_booking() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.state='confirmed' then
    insert into public.appointments(id,company_id,request_id,title,starts_at,duration_minutes,provider_managed)
      values(new.id,new.company_id,new.request_id,new.title,new.starts_at,new.duration_minutes,true)
      on conflict(id) do update set starts_at=excluded.starts_at,duration_minutes=excluded.duration_minutes
      where appointments.company_id=excluded.company_id and appointments.request_id=excluded.request_id and appointments.provider_managed;
    if not found then raise exception using errcode='PT409',message='APPOINTMENT_CONFLICT'; end if;
  elsif old.state='confirmed' then
    delete from public.appointments where id=new.id and company_id=new.company_id and provider_managed;
  else return null;
  end if;
  perform daxenvo_private.evaluate_followup(new.company_id,new.request_id);
  return null;
end $$;
create trigger project_booking after update of state,starts_at,duration_minutes on daxenvo_private.bookings
  for each row execute function daxenvo_private.project_booking();

-- Preserve unresolved reservations if J8 callers try to delete or reassign their source.
create function daxenvo_private.booking_source_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and old.prospect_id=new.prospect_id then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(old.company_id::text,9));
  if exists(select from daxenvo_private.bookings where company_id=old.company_id and request_id=old.id
    and not rejected and state in ('pending','confirmed','error')) then
    raise exception using errcode='23503', message='ACTIVE_BOOKING';
  end if;
  if tg_op='DELETE' then return old; end if;
  delete from daxenvo_private.bookings where company_id=old.company_id and request_id=old.id and state='proposed';
  return new;
end $$;
create trigger booking_source_guard before delete or update of prospect_id on public.quote_requests
  for each row execute function daxenvo_private.booking_source_guard();

create function daxenvo_private.booking_slot_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider_managed then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,9));
  if exists(select from daxenvo_private.bookings b where b.company_id=new.company_id and not b.rejected and b.state in ('pending','confirmed','error')
    and b.starts_at < new.starts_at+make_interval(mins=>new.duration_minutes)
    and new.starts_at < b.starts_at+make_interval(mins=>b.duration_minutes)) then
    raise exception using errcode='23503',message='SLOT_UNAVAILABLE';
  end if;
  return new;
end $$;
create trigger booking_slot_guard before insert or update of starts_at,duration_minutes on public.appointments
  for each row execute function daxenvo_private.booking_slot_guard();
revoke all on function daxenvo_private.project_booking(),daxenvo_private.booking_followup_guard(),
  daxenvo_private.booking_slot_guard(),daxenvo_private.booking_source_guard() from public,anon,authenticated,service_role;

-- Authenticate signed provider commands independently of the public Next.js handler.
create role daxenvo_booking_api nologin noinherit nobypassrls;
grant daxenvo_booking_api to current_user;
grant usage on schema public,extensions,daxenvo_private to daxenvo_booking_api;
grant select(company_id,user_id,role) on public.company_memberships to daxenvo_booking_api;
grant select(id,company_id) on public.quote_requests to daxenvo_booking_api;
grant select(id,company_id,starts_at,duration_minutes) on public.appointments to daxenvo_booking_api;
create policy booking_actor on public.company_memberships for select to daxenvo_booking_api
  using(user_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy booking_request on public.quote_requests for select to daxenvo_booking_api
  using(company_id in (select company_id from public.company_memberships));
create policy booking_appointments on public.appointments for select to daxenvo_booking_api
  using(company_id in (select company_id from public.company_memberships));
create policy booking_tenant on daxenvo_private.bookings to daxenvo_booking_api
  using(company_id in (select company_id from public.company_memberships))
  with check(company_id in (select company_id from public.company_memberships));
create policy booking_config on daxenvo_private.booking_calendar to daxenvo_booking_api
  using(company_id in (select company_id from public.company_memberships))
  with check(company_id in (select company_id from public.company_memberships));
grant select,insert,update on daxenvo_private.bookings to daxenvo_booking_api;
grant select,update(minute_start,minute_used,day_start,day_used,blocked_until) on daxenvo_private.booking_calendar to daxenvo_booking_api;

create function daxenvo_private.booking_command(message text,signature text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare
  actor uuid:=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
  msg jsonb; tenant uuid; target uuid; cmd text; fields jsonb; membership text;
  cfg daxenvo_private.booking_calendar; b daxenvo_private.bookings;
  dispatched boolean:=false; observed timestamptz; t timestamptz:=clock_timestamp();
begin
  if actor is null or message is null or octet_length(message)>8192 or signature is null
     or signature !~ '^[a-f0-9]{64}$' then raise insufficient_privilege; end if;
  msg:=message::jsonb; tenant:=(msg->>'company')::uuid; target:=(msg->>'request')::uuid;
  cmd:=msg->>'command'; fields:=msg->'fields';
  select role into membership from public.company_memberships where company_id=tenant and user_id=actor;
  if not found then raise insufficient_privilege; end if;
  select * into cfg from daxenvo_private.booking_calendar where company_id=tenant;
  if not found then raise exception using errcode='PT503',message='CALENDAR_NOT_CONFIGURED'; end if;
  if msg->>'purpose' is distinct from 'booking.v1' or (msg->>'actor')::uuid is distinct from actor
     or (msg->>'binding')::uuid is distinct from cfg.binding
     or not coalesce((msg->>'expires')::bigint between extract(epoch from t) and extract(epoch from t)+60,false)
     or sha256(extensions.hmac(convert_to(message,'UTF8'),cfg.writer_digest,'sha256'))<>sha256(decode(signature,'hex'))
     then raise insufficient_privilege; end if;
  if cmd in ('cancel','reschedule','recover') and membership='member' then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text,9));
  if not exists(select from public.quote_requests where company_id=tenant and id=target) then
    raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  if cmd not in ('read','observe','failure','cooldown') then
    update daxenvo_private.booking_calendar set minute_start=date_trunc('minute',t),
      minute_used=case when minute_start=date_trunc('minute',t) then minute_used+1 else 1 end
      where company_id=tenant and (minute_start is distinct from date_trunc('minute',t) or minute_used<per_minute)
      and (blocked_until is null or blocked_until<=t);
    if not found then raise exception using errcode='PT429',message='CALENDAR_RATE_LIMIT'; end if;
  end if;
  if cmd='cooldown' then
    update daxenvo_private.booking_calendar set blocked_until=greatest(blocked_until,t+make_interval(secs=>greatest(60,least(86400,(fields->>'delay')::int)))) where company_id=tenant;
    return '{}'::jsonb;
  end if;
  if cmd='availability' then
    return (select coalesce(jsonb_agg(to_jsonb(busy)),'[]') from
      (select starts_at,duration_minutes from public.appointments where company_id=tenant
       union all select starts_at,duration_minutes from daxenvo_private.bookings where company_id=tenant
         and state in ('pending','error') and not rejected) busy
      where starts_at<(fields->>'to')::timestamptz and starts_at+make_interval(mins=>duration_minutes)>(fields->>'from')::timestamptz);
  end if;
  if cmd='list' then
    return (select coalesce(jsonb_agg(to_jsonb(page) order by id),'[]') from
      (select * from daxenvo_private.bookings where company_id=tenant and request_id=target
        and (fields->>'after' is null or id>(fields->>'after')::uuid) order by id limit 25) page);
  end if;
  if cmd='proposal' then
    select * into b from daxenvo_private.bookings where company_id=tenant and operation=(fields->>'operation')::uuid;
    if not found then return 'null'::jsonb; end if;
    if (b.request_id,b.title,b.proposed_start,b.zone) is distinct from
      (target,fields->>'title',(fields->>'start')::timestamptz,fields->>'zone') then
      raise exception using errcode='PT409',message='OPERATION_CONFLICT'; end if;
    return to_jsonb(b);
  end if;
  if cmd='propose' then
    insert into daxenvo_private.bookings(operation,company_id,request_id,binding,title,starts_at,duration_minutes,proposed_start,proposed_minutes,zone,state)
      values((fields->>'operation')::uuid,tenant,target,cfg.binding,fields->>'title',(fields->>'start')::timestamptz,
        (fields->>'minutes')::int,(fields->>'start')::timestamptz,(fields->>'minutes')::int,fields->>'zone','proposed') on conflict(company_id,operation) do nothing;
    select * into strict b from daxenvo_private.bookings where company_id=tenant and operation=(fields->>'operation')::uuid;
    if (b.request_id,b.title,b.proposed_start,b.proposed_minutes,b.zone) is distinct from
      (target,fields->>'title',(fields->>'start')::timestamptz,(fields->>'minutes')::int,fields->>'zone') then
      raise exception using errcode='PT409',message='OPERATION_CONFLICT'; end if;
  else
    select * into b from daxenvo_private.bookings where company_id=tenant and request_id=target and id=(fields->>'id')::uuid;
    if not found then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
    if b.binding<>cfg.binding then raise exception using errcode='PT409',message='CALENDAR_CHANGED'; end if;
    if cmd='reserve' and (coalesce(fields->>'invitee_hash','') !~ '^[a-f0-9]{64}$' or
      (b.invitee_hash is not null and b.invitee_hash<>fields->>'invitee_hash')) then
      raise exception using errcode='PT409',message='INVITEE_CONFLICT'; end if;
    if cmd='reserve' and b.state='proposed' then
      if b.starts_at<=t or exists(select from daxenvo_private.bookings x where x.company_id=tenant and not x.rejected and x.state in ('confirmed','pending','error')
        and x.starts_at<b.starts_at+make_interval(mins=>b.duration_minutes) and b.starts_at<x.starts_at+make_interval(mins=>x.duration_minutes))
        or exists(select from public.appointments x where x.company_id=tenant and x.starts_at<b.starts_at+make_interval(mins=>b.duration_minutes)
        and b.starts_at<x.starts_at+make_interval(mins=>x.duration_minutes)) then
        raise exception using errcode='PT409',message='SLOT_UNAVAILABLE'; end if;
      update daxenvo_private.booking_calendar set day_start=case when day_start>t-interval '24 hours' then day_start else t end,day_used=case when day_start>t-interval '24 hours' then day_used+1 else 1 end
        where company_id=tenant and (day_start is null or day_start<=t-interval '24 hours' or day_used<daily_creates);
      if not found then raise exception using errcode='PT429',message='BOOKING_LIMIT'; end if;
      update daxenvo_private.bookings set state='pending',invitee_hash=fields->>'invitee_hash',revision=revision+1 where id=b.id returning * into b;
      dispatched:=true;
    elsif cmd in ('observe','failure') then
      if b.revision=(fields->>'revision')::int and (b.state in ('confirmed','pending','error') or (b.state='cancelled' and b.reference is not null)) then
        if cmd='failure' then
          update daxenvo_private.bookings set state=case when state='pending' then 'error' else state end,
            rejected=rejected or (reference is null and coalesce((fields->>'rejected')::boolean,false)),
            last_error=left(fields->>'error',64),failures=failures+1,revision=revision+1,
            retry_at=t+make_interval(secs=>greatest(15,least(86400,(fields->>'delay')::int))) where id=b.id returning * into b;
          if b.last_error='CALENDAR_RATE_LIMIT' then
            update daxenvo_private.booking_calendar set blocked_until=b.retry_at where company_id=tenant;
          end if;
        else
          observed:=(fields->>'updated')::timestamptz;
          if (b.observed_at is null or observed>=b.observed_at) and not
            (b.state='cancelled' and fields->>'status'='confirmed' and fields->>'reference'=b.reference) then
            if fields->>'status' not in ('confirmed','cancelled') or nullif(fields->>'reference','') is null or observed is null then
              raise invalid_parameter_value; end if;
            update daxenvo_private.bookings set state=fields->>'status',reference=fields->>'reference',
              cancel_requested=case when reference is distinct from fields->>'reference' or fields->>'status'='cancelled'
                or fields->>'recovery'='true' then false else cancel_requested end,
              starts_at=(fields->>'start')::timestamptz,duration_minutes=(fields->>'minutes')::int,observed_at=observed,
              failures=0,last_error=null,retry_at=null,revision=revision+1 where id=b.id and ((cancel_requested and fields->>'recovery'='true') or
              (state,reference,starts_at,duration_minutes,observed_at,last_error) is distinct from
              (fields->>'status',fields->>'reference',(fields->>'start')::timestamptz,(fields->>'minutes')::int,observed,null::text));
            select * into strict b from daxenvo_private.bookings where id=(fields->>'id')::uuid;
          end if;
        end if;
      end if;
    elsif cmd in ('sync','cancel','reschedule','recover') then
      if (b.state='proposed' or b.rejected) and cmd='cancel' then
        update daxenvo_private.bookings set state='cancelled',revision=revision+1 where id=b.id returning * into b;
      elsif b.state not in ('confirmed','pending','error','cancelled') then
        raise exception using errcode='PT409',message='NOT_RESERVED';
      elsif b.state<>'cancelled' and (b.retry_at>t or (b.failures>=5 and cmd<>'recover')) then
        raise exception using errcode='PT429',message='RECONCILIATION_DEFERRED';
      elsif cmd='cancel' and b.state in ('pending','error') then
        raise exception using errcode='PT409',message='RECONCILE_FIRST';
      elsif cmd='cancel' and b.state='confirmed' and not b.cancel_requested then
        update daxenvo_private.bookings set cancel_requested=true,revision=revision+1 where id=b.id returning * into b;
        dispatched:=true;
      end if;
    elsif cmd not in ('reserve','read') then raise invalid_parameter_value;
    end if;
  end if;
  return jsonb_build_object('booking',to_jsonb(b),'dispatch',dispatched);
end $$;
grant create on schema daxenvo_private to daxenvo_booking_api;
alter function daxenvo_private.booking_command(text,text) owner to daxenvo_booking_api;
revoke create on schema daxenvo_private from daxenvo_booking_api;
create function public.booking_command(message text,signature text) returns jsonb
language sql security invoker set search_path='' as $$ select daxenvo_private.booking_command(message,signature) $$;
revoke all on function public.booking_command(text,text),daxenvo_private.booking_command(text,text) from public,anon,authenticated,service_role;
grant execute on function public.booking_command(text,text),daxenvo_private.booking_command(text,text) to authenticated;
revoke daxenvo_booking_api from current_user;
commit;
