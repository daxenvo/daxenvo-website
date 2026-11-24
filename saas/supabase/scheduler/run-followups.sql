-- psql entry point for a periodic server-side job. Each tenant commits separately.
-- The supervisor must receive a non-zero exit after any error.
\set ON_ERROR_STOP on
create temporary table followup_tick_failures(company_id uuid, error_code text);
create function pg_temp.tick_followups(tenant uuid) returns void language plpgsql as $$
begin
  perform daxenvo_private.run_followups(tenant);
exception when others then
  insert into pg_temp.followup_tick_failures values(tenant,SQLSTATE);
end $$;
select format('select pg_temp.tick_followups(%L::uuid)',company_id)
from daxenvo_private.followup_policy order by company_id
\gexec
table pg_temp.followup_tick_failures;
do $$ begin
  if exists(select from pg_temp.followup_tick_failures) then
    raise exception 'Follow-up tick failed for one or more tenants';
  end if;
end $$;
