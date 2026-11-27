begin;
create role daxenvo_ai_gateway nologin noinherit nobypassrls;
create role daxenvo_ai_meter nologin noinherit nobypassrls;
grant daxenvo_ai_meter to current_user;

-- All money is expressed in integer micro-USD. No configuration means no calls.
create table daxenvo_private.ai_project (
  singleton boolean primary key check(singleton),
  daily_budget bigint not null check(daily_budget>0),
  monthly_budget bigint not null check(monthly_budget>0),
  simultaneous int not null check(simultaneous>0),
  generation bigint not null default 0
);
create table daxenvo_private.ai_policy (
  company_id uuid primary key references public.companies on delete cascade,
  model text not null check(model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  user_daily int not null check(user_daily>0), company_daily int not null check(company_daily>0),
  simultaneous int not null check(simultaneous>0), attempts int not null check(attempts between 1 and 5),
  input_limit int not null check(input_limit between 1 and 64000),
  output_limit int not null check(output_limit between 1 and 4096),
  daily_tokens bigint not null check(daily_tokens>0), monthly_tokens bigint not null check(monthly_tokens>0),
  daily_budget bigint not null check(daily_budget>0), monthly_budget bigint not null check(monthly_budget>0),
  input_rate int not null check(input_rate>0), output_rate int not null check(output_rate>0)
);
-- No cascading FK: deleting a business object must never replenish a budget.
create table daxenvo_private.ai_attempt (
  operation uuid primary key, actor uuid not null, company_id uuid not null, request_id uuid not null,
  source text not null, provider text not null check(provider='simulation'), model text not null,
  prompt_version text not null, started timestamptz not null default clock_timestamp(), finished timestamptz,
  state text not null check(state in ('reserved','completed','stale','invalid','unavailable','timeout')),
  input_max int not null, output_max int not null, input_rate int not null, output_rate int not null,
  input_used int, output_used int, charge bigint not null, reserved_cost bigint not null
);
create index ai_source_attempts on daxenvo_private.ai_attempt(company_id,request_id,source);
create index ai_usage_time on daxenvo_private.ai_attempt(company_id,started);
alter table daxenvo_private.ai_project enable row level security;
alter table daxenvo_private.ai_policy enable row level security;
alter table daxenvo_private.ai_attempt enable row level security;
revoke all on daxenvo_private.ai_project,daxenvo_private.ai_policy,daxenvo_private.ai_attempt from public,anon,authenticated,service_role;
grant usage on schema daxenvo_private to daxenvo_ai_gateway,daxenvo_ai_meter;
grant usage on schema public to daxenvo_ai_meter;
grant select,update(generation) on daxenvo_private.ai_project to daxenvo_ai_meter;
grant select on daxenvo_private.ai_policy to daxenvo_ai_meter;
grant select,insert,update(state,finished,input_used,output_used,charge) on daxenvo_private.ai_attempt to daxenvo_ai_meter;
create policy ai_project_meter on daxenvo_private.ai_project to daxenvo_ai_meter using(true) with check(true);
create policy ai_policy_meter on daxenvo_private.ai_policy for select to daxenvo_ai_meter using(company_id=nullif(current_setting('daxenvo.ai_company',true),'')::uuid);
-- Meter needs project-wide totals. Only its fixed private functions can access this table.
create policy ai_usage_meter on daxenvo_private.ai_attempt to daxenvo_ai_meter using(true) with check(company_id=nullif(current_setting('daxenvo.ai_company',true),'')::uuid);
grant select(company_id,user_id,role) on public.company_memberships to daxenvo_ai_meter;
create policy ai_membership on public.company_memberships for select to daxenvo_ai_meter
 using(company_id=nullif(current_setting('daxenvo.ai_company',true),'')::uuid and user_id=nullif(current_setting('daxenvo.ai_actor',true),'')::uuid);
grant select(id,company_id,description,project_type,city,budget,requested_timeline) on public.quote_requests to daxenvo_ai_meter;
create policy ai_request on public.quote_requests for select to daxenvo_ai_meter using(company_id in(select company_id from public.company_memberships where role in ('owner','admin','member')));

create function daxenvo_private.ai_source(target uuid) returns text language sql stable security invoker set search_path='' as $$
 select encode(sha256(convert_to(array_to_string(array(
   select encode(sha256(convert_to(f,'UTF8')),'hex') from unnest(array[q.description,q.project_type,q.city,trim_scale(q.budget)::text,q.requested_timeline]) f
 ),''),'UTF8')),'hex') from public.quote_requests q where q.id=target
$$;

create function daxenvo_private.ai_reserve(op uuid,target uuid,fingerprint text,input_bound int)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
 tenant uuid:=current_setting('daxenvo.ai_company')::uuid;
 who uuid:=current_setting('daxenvo.ai_actor')::uuid;
 p daxenvo_private.ai_policy; g daxenvo_private.ai_project; old daxenvo_private.ai_attempt;
 cost bigint; totals record; today timestamptz; month_start timestamptz;
begin
 if daxenvo_private.ai_source(target) is null then return '"NOT_FOUND"'; end if;
 if fingerprint is distinct from daxenvo_private.ai_source(target) then return '"SOURCE_CHANGED"'; end if;
 -- A physical update serializes reservations across workers and fails closed at stronger isolation.
 update daxenvo_private.ai_project set generation=generation+1 where singleton returning * into g;
 if not found then return '"NOT_CONFIGURED"'; end if;
 select * into p from daxenvo_private.ai_policy where company_id=tenant;
 if not found then return '"NOT_CONFIGURED"'; end if;
 select * into old from daxenvo_private.ai_attempt where operation=op;
 if found then
   if (old.company_id,old.actor,old.request_id,old.source) is distinct from (tenant,who,target,fingerprint) then return '"CONFLICT"'; end if;
   return jsonb_build_object('duplicate',old.state);
 end if;
 if input_bound is null or input_bound not between 1 and p.input_limit then return '"INPUT_LIMIT"'; end if;
 if exists(select from daxenvo_private.ai_attempt where company_id=tenant and request_id=target and
   (state='reserved' or (source=fingerprint and state in ('completed','timeout','unavailable')))) then return '"CONFLICT"'; end if;
 if (select count(*) from daxenvo_private.ai_attempt where company_id=tenant and request_id=target and source=fingerprint)>=p.attempts then return '"ATTEMPT_LIMIT"'; end if;
 cost:=input_bound::bigint*p.input_rate+p.output_limit::bigint*p.output_rate;
 today:=date_trunc('day',clock_timestamp()); month_start:=date_trunc('month',today);
 -- Uncertain or interrupted work retains its full reservation across window boundaries.
 with usage as (select *,state in ('reserved','timeout','unavailable') as pending,
   coalesce(input_used,input_max)::bigint+coalesce(output_used,output_max) as tokens,
   greatest(started,finished) as stamp from daxenvo_private.ai_attempt)
 select count(*) filter(where pending) as running,count(*) filter(where pending and company_id=tenant) as local_running,
   count(*) filter(where actor=who and started>=today) as user_calls,count(*) filter(where company_id=tenant and started>=today) as tenant_calls,
   coalesce(sum(charge) filter(where pending or stamp>=today),0) as gd,coalesce(sum(charge),0) as gm,
   coalesce(sum(charge) filter(where company_id=tenant and (pending or stamp>=today)),0) as cd,
   coalesce(sum(charge) filter(where company_id=tenant),0) as cm,
   coalesce(sum(tokens) filter(where company_id=tenant and (pending or stamp>=today)),0) as td,
   coalesce(sum(tokens) filter(where company_id=tenant),0) as tm into totals from usage where pending or stamp>=month_start;
 if totals.running>=g.simultaneous or totals.local_running>=p.simultaneous or totals.user_calls>=p.user_daily
   or totals.tenant_calls>=p.company_daily or totals.td+input_bound+p.output_limit>p.daily_tokens
   or totals.tm+input_bound+p.output_limit>p.monthly_tokens then return '"QUOTA_LIMIT"'; end if;
 if totals.gd+cost>g.daily_budget or totals.gm+cost>g.monthly_budget or totals.cd+cost>p.daily_budget or totals.cm+cost>p.monthly_budget then return '"BUDGET_LIMIT"'; end if;
 insert into daxenvo_private.ai_attempt(operation,actor,company_id,request_id,source,provider,model,prompt_version,state,input_max,output_max,input_rate,output_rate,charge,reserved_cost)
 values(op,who,tenant,target,fingerprint,'simulation',p.model,'qualification-signals-v1','reserved',input_bound,p.output_limit,p.input_rate,p.output_rate,cost,cost);
 return jsonb_build_object('model',p.model,'outputLimit',p.output_limit);
end $$;

create function daxenvo_private.ai_finish(op uuid,target uuid,outcome text,used_in int,used_out int)
returns text language plpgsql security definer set search_path='' as $$
declare a daxenvo_private.ai_attempt;
begin
 select * into a from daxenvo_private.ai_attempt where operation=op and request_id=target
   and company_id=current_setting('daxenvo.ai_company')::uuid and actor=current_setting('daxenvo.ai_actor')::uuid for update;
 if not found then return 'NOT_FOUND'; end if;
 if a.state<>'reserved' then return a.state; end if;
 if outcome is null or outcome not in ('completed','invalid','unavailable','timeout') then raise invalid_parameter_value; end if;
 if outcome in ('completed','invalid') and (used_in is null or used_out is null or used_in not between 0 and a.input_max or used_out not between 0 and a.output_max)
 then outcome:='unavailable'; end if;
 if outcome in ('unavailable','timeout') then used_in:=null; used_out:=null;
 elsif daxenvo_private.ai_source(target) is distinct from a.source then outcome:='stale'; end if;
 update daxenvo_private.ai_attempt set state=outcome,finished=clock_timestamp(),input_used=used_in,output_used=used_out,
 charge=coalesce(used_in::bigint*a.input_rate+used_out::bigint*a.output_rate,a.reserved_cost) where operation=op;
 return outcome;
end $$;

grant create on schema daxenvo_private to daxenvo_ai_meter;
alter function daxenvo_private.ai_source(uuid) owner to daxenvo_ai_meter;
alter function daxenvo_private.ai_reserve(uuid,uuid,text,int) owner to daxenvo_ai_meter;
alter function daxenvo_private.ai_finish(uuid,uuid,text,int,int) owner to daxenvo_ai_meter;
revoke create on schema daxenvo_private from daxenvo_ai_meter;
revoke all on function daxenvo_private.ai_source(uuid),daxenvo_private.ai_reserve(uuid,uuid,text,int),daxenvo_private.ai_finish(uuid,uuid,text,int,int) from public,anon,authenticated,service_role;
grant execute on function daxenvo_private.ai_reserve(uuid,uuid,text,int),daxenvo_private.ai_finish(uuid,uuid,text,int,int) to daxenvo_ai_gateway;
revoke daxenvo_ai_meter from current_user;
commit;
