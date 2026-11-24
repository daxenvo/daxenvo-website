begin;
-- A stale signed source is a permanent conflict for this operation.
-- PT409 lets PostgREST return HTTP 409 without a serialization retry.
grant daxenvo_qualification_writer to current_user;
create or replace function daxenvo_private.record_request_qualification(p_message text, p_signature text)
returns public.request_qualifications language plpgsql security definer set search_path = '' as $$
declare
  -- PostgREST installs the verified user JWT claims for this transaction.
  actor uuid := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
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
    raise exception using errcode = 'PT409', message = 'SOURCE_CHANGED';
  end if;
  insert into public.request_qualifications(company_id, request_id, operation_id, revision, created_by, result)
    select tenant, target, (msg->>'nonce')::uuid, coalesce(max(h.revision),0)+1, actor, msg->'result'
    from public.request_qualifications h where h.company_id=tenant and h.request_id=target
    returning * into saved;
  return saved;
end;
$$;
revoke daxenvo_qualification_writer from current_user;
commit;
