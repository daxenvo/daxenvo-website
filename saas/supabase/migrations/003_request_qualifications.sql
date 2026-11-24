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
  operation_id uuid not null unique,
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


-- Only the private implementation runs with this narrowly scoped role.
create role daxenvo_qualification_writer nologin noinherit nobypassrls;
grant daxenvo_qualification_writer to current_user;
grant usage on schema public, auth, extensions, daxenvo_private to daxenvo_qualification_writer;
grant select on daxenvo_private.qualification_writer to daxenvo_qualification_writer;
grant select, update(role) on public.company_memberships to daxenvo_qualification_writer;
grant select, update(title) on public.quote_requests to daxenvo_qualification_writer;
grant select, insert on public.request_qualifications to daxenvo_qualification_writer;

create policy qualification_writer_membership on public.company_memberships
  for select to daxenvo_qualification_writer using (user_id = (select auth.uid()));
create policy qualification_writer_membership_lock on public.company_memberships
  for update to daxenvo_qualification_writer using (user_id = (select auth.uid())) with check (false);
create policy qualification_writer_request on public.quote_requests
  for select to daxenvo_qualification_writer using (company_id in (select company_id from public.company_memberships));
create policy qualification_writer_request_lock on public.quote_requests
  for update to daxenvo_qualification_writer using (company_id in (select company_id from public.company_memberships)) with check (false);
create policy qualification_writer_history on public.request_qualifications
  for select to daxenvo_qualification_writer using (company_id in (select company_id from public.company_memberships));
create policy qualification_writer_append on public.request_qualifications
  for insert to daxenvo_qualification_writer with check (created_by = (select auth.uid())
    and company_id in (select company_id from public.company_memberships));

create function daxenvo_private.record_request_qualification(p_message text, p_signature text)
returns public.request_qualifications language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  msg jsonb;
  tenant uuid;
  target uuid;
  deadline bigint;
  now_seconds bigint := floor(extract(epoch from clock_timestamp()));
  source_hash text;
  saved public.request_qualifications;
begin
  if actor is null or p_message is null or octet_length(p_message) > 16384
    or p_signature is null or p_signature !~ '^[0-9a-f]{64}$' or not exists (
      select 1 from daxenvo_private.qualification_writer
      where sha256(extensions.hmac(convert_to(p_message,'UTF8'), digest, 'sha256'))
        = sha256(decode(p_signature,'hex'))
    ) then raise insufficient_privilege; end if;
  msg := p_message::jsonb;
  tenant := (msg->>'company')::uuid;
  target := (msg->>'request')::uuid;
  deadline := (msg->>'expires')::bigint;
  if msg->>'purpose' is distinct from 'daxenvo.qualification.v1'
    or (msg->>'actor')::uuid is distinct from actor or deadline is null
    or deadline < now_seconds or deadline > now_seconds + 60 then raise insufficient_privilege; end if;

  perform 1 from public.company_memberships where company_id = tenant and user_id = actor
    and role in ('member','admin','owner') for share;
  if not found then raise insufficient_privilege; end if;
  select encode(sha256(convert_to(
    encode(sha256(convert_to(q.description,'UTF8')),'hex') ||
    encode(sha256(convert_to(q.project_type,'UTF8')),'hex') ||
    encode(sha256(convert_to(q.city,'UTF8')),'hex') ||
    encode(sha256(convert_to(trim_scale(q.budget)::text,'UTF8')),'hex') ||
    encode(sha256(convert_to(q.requested_timeline,'UTF8')),'hex'), 'UTF8')), 'hex')
    into source_hash from public.quote_requests q where q.company_id = tenant and q.id = target for update;
  if not found then raise no_data_found; end if;
  if source_hash is distinct from msg->>'source' then
    raise exception using errcode = '40001', message = 'Qualification source changed';
  end if;
  insert into public.request_qualifications(company_id, request_id, operation_id, revision, created_by, result)
    select tenant, target, (msg->>'nonce')::uuid, coalesce(max(h.revision),0)+1, actor, msg->'result'
    from public.request_qualifications h where h.company_id=tenant and h.request_id=target
    returning * into saved;
  return saved;
end;
$$;
grant create on schema daxenvo_private to daxenvo_qualification_writer;
alter function daxenvo_private.record_request_qualification(text,text) owner to daxenvo_qualification_writer;
revoke create on schema daxenvo_private from daxenvo_qualification_writer;
revoke all on function daxenvo_private.record_request_qualification(text,text) from public, anon, authenticated;
grant usage on schema daxenvo_private to authenticated;
grant execute on function daxenvo_private.record_request_qualification(text,text) to authenticated;
create function public.record_request_qualification(p_message text,p_signature text)
returns public.request_qualifications language sql security invoker set search_path = '' as $$
  select * from daxenvo_private.record_request_qualification(p_message,p_signature);
$$;
revoke all on function public.record_request_qualification(text,text) from public,anon,authenticated;
grant execute on function public.record_request_qualification(text,text) to authenticated;
revoke daxenvo_qualification_writer from current_user;
commit;
