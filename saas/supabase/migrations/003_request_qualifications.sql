begin;

create schema daxenvo_private;
revoke all on schema daxenvo_private from public, anon, authenticated;
-- Provision a SHA-256 digest separately. An empty table disables all writes.
create table daxenvo_private.qualification_writer (
  singleton boolean primary key default true check (singleton),
  digest bytea not null check (octet_length(digest) = 32)
);
revoke all on daxenvo_private.qualification_writer from public, anon, authenticated;

create table public.request_qualifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  request_id uuid not null,
  revision integer not null check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  result jsonb not null,
  unique (company_id, request_id, revision),
  foreign key (company_id, request_id) references public.quote_requests(company_id, id) on delete cascade,
  check (jsonb_typeof(result) = 'object'
    and result ?& array['version','priorite','motif','actionRecommandee','informationsManquantes','signaux','requiresHumanReview','analysePar','fournisseur','repli']
    and result - array['version','priorite','motif','actionRecommandee','informationsManquantes','signaux','requiresHumanReview','analysePar','fournisseur','repli'] = '{}'::jsonb
    and result->'version' = '"j6-regles-v1"'
    and result->'analysePar' = '"regles"'
    and result->'fournisseur' = 'null'::jsonb
    and result->'repli' = '{"code":"IA_NON_CONFIGUREE"}'::jsonb
    and result->'priorite' <@ '["elevee","moyenne","faible","a_preciser"]'::jsonb
    and jsonb_typeof(result->'priorite') = 'string'
    and jsonb_typeof(result->'motif') = 'string' and length(result->>'motif') between 1 and 500
    and jsonb_typeof(result->'actionRecommandee') = 'string' and length(result->>'actionRecommandee') between 1 and 500
    and jsonb_typeof(result->'requiresHumanReview') = 'boolean'
    and jsonb_typeof(result->'informationsManquantes') = 'array'
    and result->'informationsManquantes' <@ '["description","budget","delai","typeTravaux","ville"]'::jsonb
    and jsonb_typeof(result->'signaux') = 'array'
    and result->'signaux' <@ '["Type de projet fourni","Budget déclaré","Calendrier déclaré"]'::jsonb)
);
alter table public.request_qualifications enable row level security;
revoke all on public.request_qualifications from public, anon, authenticated;
grant select on public.request_qualifications to authenticated;
create policy qualification_member_read on public.request_qualifications for select to authenticated
using (company_id in (select company_id from public.company_memberships where user_id = (select auth.uid())));

create function public.record_request_qualification(
  p_company uuid, p_request uuid, p_source jsonb, p_result jsonb, p_writer text
) returns public.request_qualifications
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  source jsonb;
  saved public.request_qualifications;
begin
  if actor is null or p_writer is null or length(p_writer) <> 64 or not exists (
    select 1 from daxenvo_private.qualification_writer
    where digest = pg_catalog.sha256(pg_catalog.convert_to(p_writer, 'UTF8'))
  ) then raise insufficient_privilege; end if;

  perform 1 from public.company_memberships
    where company_id = p_company and user_id = actor and role in ('member','admin','owner') for share;
  if not found then raise insufficient_privilege; end if;

  select jsonb_build_object('description', q.description, 'project_type', q.project_type,
    'city', q.city, 'budget', q.budget, 'requested_timeline', q.requested_timeline)
    into source from public.quote_requests q
    where q.company_id = p_company and q.id = p_request for update;
  if not found then raise no_data_found; end if;
  if source is distinct from p_source then
    raise exception using errcode = '40001', message = 'Qualification source changed';
  end if;

  insert into public.request_qualifications(company_id, request_id, revision, created_by, result)
    select p_company, p_request, coalesce(max(h.revision), 0) + 1, actor, p_result
    from public.request_qualifications h where h.company_id = p_company and h.request_id = p_request
    returning * into saved;
  return saved;
end;
$$;
revoke all on function public.record_request_qualification(uuid,uuid,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.record_request_qualification(uuid,uuid,jsonb,jsonb,text) to authenticated;
commit;
