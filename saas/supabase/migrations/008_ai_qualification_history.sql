begin;
grant daxenvo_ai_meter to current_user;

-- A companion to the J8 rules history. Simulations never feed the J9 triggers.
create table public.request_ai_qualifications (
  company_id uuid not null, request_id uuid not null, revision integer not null check (revision > 0),
  operation uuid not null unique references daxenvo_private.ai_attempt(operation),
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
  model text not null, prompt_version text not null,
  outcome text not null check (outcome in ('completed','invalid','timeout','unavailable')),
  result jsonb not null check (jsonb_typeof(result)='object'
    and result ?& array['priorite','motif','actionRecommandee','informationsManquantes','analysePar','requiresHumanReview']
    and result->>'analysePar' is not distinct from (case when outcome='completed' then 'simulation' else 'regles' end)
    and result->'requiresHumanReview'='true'::jsonb),
  primary key(company_id,request_id,revision),
  foreign key(company_id,request_id) references public.quote_requests(company_id,id) on delete cascade
);
alter table public.request_ai_qualifications enable row level security;
revoke all on public.request_ai_qualifications from public,anon,authenticated,service_role;
grant select on public.request_ai_qualifications to authenticated,daxenvo_ai_meter;
grant insert on public.request_ai_qualifications to daxenvo_ai_meter;
create policy ai_history_read on public.request_ai_qualifications for select to authenticated
 using(company_id in (select company_id from public.company_memberships where user_id=(select auth.uid())));
create policy ai_history_meter_read on public.request_ai_qualifications for select to daxenvo_ai_meter
 using(company_id in (select company_id from public.company_memberships));
create policy ai_history_meter_insert on public.request_ai_qualifications for insert to daxenvo_ai_meter
 with check(company_id in (select company_id from public.company_memberships)
   and created_by=current_setting('daxenvo.ai_actor')::uuid);

-- PostgreSQL requires an UPDATE privilege/policy for row locks. No replacement
-- row passes WITH CHECK, including a no-op update by the function owner.
grant update(id) on public.quote_requests to daxenvo_ai_meter;
grant update(user_id) on public.company_memberships to daxenvo_ai_meter;
create policy ai_request_lock on public.quote_requests for update to daxenvo_ai_meter
 using(company_id in (select company_id from public.company_memberships)) with check(false);
create policy ai_actor_lock on public.company_memberships for update to daxenvo_ai_meter
 using(company_id=current_setting('daxenvo.ai_company')::uuid and user_id=current_setting('daxenvo.ai_actor')::uuid) with check(false);

grant update(prompt_version) on daxenvo_private.ai_attempt to daxenvo_ai_meter;
create function daxenvo_private.ai_reserve_analysis(op uuid,target uuid,fingerprint text,input_bound int)
returns jsonb language plpgsql security definer set search_path='' as $$
declare decision jsonb;
begin
 decision:=daxenvo_private.ai_reserve(op,target,fingerprint,input_bound);
 if decision ? 'model' then
   update daxenvo_private.ai_attempt set prompt_version='qualification-signals-v2' where operation=op;
 end if;
 return decision;
end $$;

create function daxenvo_private.ai_finish_analysis(op uuid,target uuid,outcome text,used_in int,used_out int,analysis jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare attempt daxenvo_private.ai_attempt; settled text; next_revision integer;
begin
 select * into attempt from daxenvo_private.ai_attempt where operation=op and request_id=target
   and actor=current_setting('daxenvo.ai_actor')::uuid and company_id=current_setting('daxenvo.ai_company')::uuid for update;
 if not found then return 'NOT_FOUND'; end if;
 perform 1 from public.company_memberships where user_id=attempt.actor and company_id=attempt.company_id for share;
 if not found then
   perform daxenvo_private.ai_finish(op,target,outcome,used_in,used_out);
   return 'NOT_FOUND';
 end if;
 perform 1 from public.quote_requests where id=target and company_id=attempt.company_id for no key update;
 if not found then
   perform daxenvo_private.ai_finish(op,target,outcome,used_in,used_out);
   return 'NOT_FOUND';
 end if;
 if attempt.state<>'reserved' then return attempt.state; end if;
 settled:=daxenvo_private.ai_finish(op,target,outcome,used_in,used_out);
 if settled in ('NOT_FOUND','stale') then return settled; end if;
 if settled<>outcome or attempt.prompt_version<>'qualification-signals-v2' then raise invalid_parameter_value; end if;
 select coalesce(max(revision),0)+1 into next_revision from public.request_ai_qualifications
 where company_id=attempt.company_id and request_id=target;
 insert into public.request_ai_qualifications(company_id,request_id,revision,operation,created_by,model,prompt_version,outcome,result)
 values(attempt.company_id,target,next_revision,op,attempt.actor,attempt.model,attempt.prompt_version,outcome,analysis);
 return settled;
end $$;

grant create on schema daxenvo_private to daxenvo_ai_meter;
alter function daxenvo_private.ai_reserve_analysis(uuid,uuid,text,int) owner to daxenvo_ai_meter;
alter function daxenvo_private.ai_finish_analysis(uuid,uuid,text,int,int,jsonb) owner to daxenvo_ai_meter;
-- Only the definer of the history-aware wrappers needs the underlying
-- accounting functions. Applications must always use the wrappers.
set local role daxenvo_ai_meter;
revoke execute on function daxenvo_private.ai_reserve(uuid,uuid,text,int),
 daxenvo_private.ai_finish(uuid,uuid,text,int,int) from daxenvo_ai_gateway;
reset role;
revoke create on schema daxenvo_private from daxenvo_ai_meter;
revoke all on function daxenvo_private.ai_reserve_analysis(uuid,uuid,text,int),
 daxenvo_private.ai_finish_analysis(uuid,uuid,text,int,int,jsonb) from public,anon,authenticated,service_role;
grant execute on function daxenvo_private.ai_reserve_analysis(uuid,uuid,text,int),
 daxenvo_private.ai_finish_analysis(uuid,uuid,text,int,int,jsonb) to daxenvo_ai_gateway;
revoke daxenvo_ai_meter from current_user;
commit;
