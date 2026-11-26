begin;

-- Contact fields are optional for all existing prospects and J8 clients.
alter table public.prospects
  add column email text not null default '' check (length(email) <= 254),
  add column phone text not null default '' check (length(phone) <= 40);
grant update(email,phone) on public.prospects to authenticated;

-- J8 records the current sales stage. Keep future transitions without copying
-- the request description or inventing a timestamp for pre-existing records.
create table daxenvo_private.request_status_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, request_id uuid not null,
  previous_status text not null, next_status text not null,
  changed_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,request_id) references public.quote_requests(company_id,id) on delete cascade
);
create index status_history_company_time on daxenvo_private.request_status_history(company_id,changed_at desc);
alter table daxenvo_private.request_status_history enable row level security;
revoke all on daxenvo_private.request_status_history from public,authenticated,anon,service_role;
create role daxenvo_status_recorder nologin noinherit nobypassrls;
grant daxenvo_status_recorder to current_user;
grant usage on schema daxenvo_private to daxenvo_status_recorder;
grant insert(company_id,request_id,previous_status,next_status) on daxenvo_private.request_status_history to daxenvo_status_recorder;
create policy capture_transition on daxenvo_private.request_status_history for insert to daxenvo_status_recorder with check(true);
create function daxenvo_private.capture_request_status() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into daxenvo_private.request_status_history(company_id,request_id,previous_status,next_status)
    values(new.company_id,new.id,old.status,new.status);
  return new;
end $$;
grant create on schema daxenvo_private to daxenvo_status_recorder;
alter function daxenvo_private.capture_request_status() owner to daxenvo_status_recorder;
revoke create on schema daxenvo_private from daxenvo_status_recorder;
create trigger dashboard_status after update of status on public.quote_requests for each row
  when(old.status is distinct from new.status) execute function daxenvo_private.capture_request_status();
revoke all on function daxenvo_private.capture_request_status() from public,anon,authenticated,service_role;

-- Read-only projections across J8–J10. The dashboard role cannot read any
-- writer digest, provider binding, signature, invitee hash or external link.
create role daxenvo_dashboard_reader nologin noinherit nobypassrls;
grant daxenvo_dashboard_reader to current_user;
grant usage on schema public,daxenvo_private to daxenvo_dashboard_reader;
grant select on daxenvo_private.request_status_history to daxenvo_dashboard_reader;
grant select(company_id,user_id) on public.company_memberships to daxenvo_dashboard_reader;
create policy dashboard_membership on public.company_memberships for select to daxenvo_dashboard_reader
  using(user_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
grant select(id,company_id,name,city,sector) on public.prospects to daxenvo_dashboard_reader;
grant select(id,company_id,prospect_id,title,status,created_at) on public.quote_requests to daxenvo_dashboard_reader;
grant select(company_id,request_id,result,revision,created_at,id) on public.request_qualifications to daxenvo_dashboard_reader;
grant select(company_id,id,request_id,title,due_date,done) on public.followups to daxenvo_dashboard_reader;
grant select(company_id,id,request_id,title,starts_at,provider_managed) on public.appointments to daxenvo_dashboard_reader;
grant select(company_id,request_id,state,reason,due_at,paused) on daxenvo_private.followup_job to daxenvo_dashboard_reader;
grant select(company_id,request_id,id,happened_at,state,reason) on daxenvo_private.followup_history to daxenvo_dashboard_reader;
grant select(company_id,request_id,operation_id,kind,happened_at) on daxenvo_private.followup_event to daxenvo_dashboard_reader;
grant select(company_id,delay_hours,urgent_hours,max_attempts,batch_size) on daxenvo_private.followup_policy to daxenvo_dashboard_reader;
grant select(company_id) on daxenvo_private.booking_calendar to daxenvo_dashboard_reader;
grant select(company_id,id,request_id,title,state,starts_at,observed_at,last_error,retry_at) on daxenvo_private.bookings to daxenvo_dashboard_reader;

do $policy$
declare relation regclass;
begin
  foreach relation in array array['public.prospects'::regclass,'public.quote_requests','public.request_qualifications',
    'public.followups','public.appointments','daxenvo_private.followup_job','daxenvo_private.followup_history',
    'daxenvo_private.followup_policy','daxenvo_private.followup_event','daxenvo_private.booking_calendar','daxenvo_private.bookings','daxenvo_private.request_status_history'] loop
    execute format('create policy dashboard_read on %s for select to daxenvo_dashboard_reader
      using(company_id in (select m.company_id from public.company_memberships m))',relation);
  end loop;
end $policy$;

create function daxenvo_private.client_dashboard(tenant uuid, panel text, term text, facet text, cursor_key text, related uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  payload jsonb;
begin
  if not exists(select from public.company_memberships m where m.company_id=tenant) then
    raise insufficient_privilege;
  end if;
  if length(term)>160 or length(facet)>160 or length(cursor_key)>64 then raise invalid_parameter_value; end if;

  if panel='synthese' then
    with latest as (
      select distinct on (q.request_id) q.request_id,q.result
      from public.request_qualifications q where q.company_id=tenant order by q.request_id,q.revision desc
    )
    select jsonb_build_object(
      'prospects',(select count(*) from public.prospects where company_id=tenant),
      'new',count(*) filter(where r.status='nouvelle'),
      'open',count(*) filter(where r.status in ('nouvelle','a_qualifier')),
      'priority',count(*) filter(where r.status not in ('gagnee','perdue') and l.result->>'priorite'='elevee'),
      'won',count(*) filter(where r.status='gagnee'),'lost',count(*) filter(where r.status='perdue'),
      'scheduled',(select count(*) from daxenvo_private.followup_job where company_id=tenant and state='scheduled'),
      'attention',(select count(*) from daxenvo_private.followup_job where company_id=tenant and
        (state='error' or reason in ('human','information','interested','appointment','qualification_review','contact_preference_required'))),
      'confirmed',(select count(*) from daxenvo_private.bookings where company_id=tenant and state='confirmed' and starts_at>=now())
    ) into payload from public.quote_requests r left join latest l on l.request_id=r.id where r.company_id=tenant;
  elsif panel='parametres' then
    select jsonb_build_object('calendar',exists(select from daxenvo_private.booking_calendar where company_id=tenant),
      'policy',(select jsonb_build_object('delay_hours',delay_hours,'urgent_hours',urgent_hours,
        'max_attempts',max_attempts,'batch_size',batch_size) from daxenvo_private.followup_policy where company_id=tenant))
      into payload;
  elsif panel='activite' then
    with events as (
      select r.id as request_id,r.created_at as stamp,'demande' as kind,r.title as title,'' as detail,r.id::text as key
      from public.quote_requests r where r.company_id=tenant
      union all select h.request_id,h.changed_at,'statut',r.title,h.previous_status||'>'||h.next_status,h.id::text
        from daxenvo_private.request_status_history h join public.quote_requests r on (r.company_id,r.id)=(h.company_id,h.request_id) where h.company_id=tenant
      union all select q.request_id,q.created_at,'qualification',r.title,'Révision '||q.revision,q.id::text
        from public.request_qualifications q join public.quote_requests r on (r.company_id,r.id)=(q.company_id,q.request_id) where q.company_id=tenant
      union all select h.request_id,h.happened_at,'relance',r.title,h.reason,h.id::text
        from daxenvo_private.followup_history h join public.quote_requests r on (r.company_id,r.id)=(h.company_id,h.request_id) where h.company_id=tenant
      union all select f.request_id,f.happened_at,'evenement',r.title,f.kind,f.operation_id::text
        from daxenvo_private.followup_event f join public.quote_requests r on (r.company_id,r.id)=(f.company_id,f.request_id) where f.company_id=tenant
      union all select b.request_id,b.observed_at,'rendez-vous',b.title,b.state,b.id::text from daxenvo_private.bookings b
        where b.company_id=tenant and b.observed_at is not null
    ) select coalesce(jsonb_agg(to_jsonb(e) order by stamp desc,kind,key),'[]') into payload
      from (select * from events order by stamp desc,kind,key limit 20) e;
  elsif panel in ('prospects','demandes','relances','rendez-vous') then
    with items(key,id,request_id,title,detail,state,stamp,priority,reason) as (
      select p.id::text,p.id,null::uuid,p.name,p.city,p.sector,null::text,null::text,null::text
        from public.prospects p where panel='prospects' and p.company_id=tenant and (facet='' or lower(p.sector)=lower(facet))
      union all select r.id::text,r.id,r.id,r.title,p.name,r.status,r.created_at::text,q.result->>'priorite',
        case when q.result->>'requiresHumanReview'='true' then 'qualification_review' end
        from public.quote_requests r join public.prospects p on (p.company_id,p.id)=(r.company_id,r.prospect_id)
        left join lateral (select result from public.request_qualifications where company_id=tenant and request_id=r.id order by revision desc limit 1) q on true
        where panel='demandes' and r.company_id=tenant and (related is null or r.prospect_id=related)
        and (facet='' or r.status=facet or (facet='attention' and q.result->>'requiresHumanReview'='true'))
      union all select 'a'||j.request_id,j.request_id,j.request_id,r.title,'Automatisation',j.state,j.due_at::text,null,j.reason
        from daxenvo_private.followup_job j join public.quote_requests r on (r.company_id,r.id)=(j.company_id,j.request_id)
        where panel='relances' and j.company_id=tenant and (related is null or r.prospect_id=related or r.id=related)
        and (facet='' or j.state=facet or (facet='attention' and (j.state='error' or j.reason in
          ('human','information','interested','appointment','qualification_review','contact_preference_required'))))
      union all select 'm'||f.id,f.id,r.id,f.title,r.title,case when f.done then 'done' else 'manual' end,f.due_date::text,null,null
        from public.followups f join public.quote_requests r on (r.company_id,r.id)=(f.company_id,f.request_id)
        where panel='relances' and f.company_id=tenant and (related is null or r.prospect_id=related or r.id=related)
        and (facet='' or facet=case when f.done then 'done' else 'manual' end)
      union all select 'b'||b.id,b.id,r.id,b.title,r.title,b.state,b.starts_at::text,null,b.last_error
        from daxenvo_private.bookings b join public.quote_requests r on (r.company_id,r.id)=(b.company_id,b.request_id)
        where panel='rendez-vous' and b.company_id=tenant and (related is null or r.prospect_id=related or r.id=related) and (facet='' or facet=b.state)
      union all select 'm'||a.id,a.id,r.id,a.title,r.title,'manual',a.starts_at::text,null,null
        from public.appointments a join public.quote_requests r on (r.company_id,r.id)=(a.company_id,a.request_id)
        where panel='rendez-vous' and a.company_id=tenant and not a.provider_managed
        and (related is null or r.prospect_id=related or r.id=related) and facet in ('','manual')
    ) select coalesce(jsonb_agg(to_jsonb(i) order by key),'[]') into payload from
      (select * from items where key>cursor_key and strpos(lower(title||' '||detail),lower(term))>0 order by key limit 26) i;
  else raise invalid_parameter_value;
  end if;
  return payload;
end $$;
grant create on schema daxenvo_private to daxenvo_dashboard_reader;
alter function daxenvo_private.client_dashboard(uuid,text,text,text,text,uuid) owner to daxenvo_dashboard_reader;
revoke create on schema daxenvo_private from daxenvo_dashboard_reader;
create function public.client_dashboard(tenant uuid,panel text,term text default '',facet text default '',cursor_key text default '',related uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select daxenvo_private.client_dashboard(tenant,panel,term,facet,cursor_key,related)
$$;
revoke all on function public.client_dashboard(uuid,text,text,text,text,uuid),
  daxenvo_private.client_dashboard(uuid,text,text,text,text,uuid) from public,anon,service_role,authenticated;
grant execute on function public.client_dashboard(uuid,text,text,text,text,uuid),
  daxenvo_private.client_dashboard(uuid,text,text,text,text,uuid) to authenticated;
revoke daxenvo_dashboard_reader,daxenvo_status_recorder from current_user;
commit;
