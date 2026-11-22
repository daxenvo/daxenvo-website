begin;

-- Seules les colonnes métier sont modifiables via le rôle de l'API.
revoke update on public.prospects, public.quote_requests, public.followups, public.appointments from authenticated;
grant update (name, sector, city) on public.prospects to authenticated;
grant update (prospect_id, title, description, project_type, city, budget, requested_timeline, status)
  on public.quote_requests to authenticated;
grant update (request_id, title, due_date, done) on public.followups to authenticated;
grant update (request_id, title, starts_at, duration_minutes) on public.appointments to authenticated;

-- Une politique restrictive complète la politique permissive d'appartenance de J7.
do $migration$
declare
  business_table text;
begin
  foreach business_table in array array['prospects', 'quote_requests', 'followups', 'appointments'] loop
    execute format(
      'create policy delete_managers on public.%I as restrictive for delete to authenticated
       using (company_id in (select m.company_id from public.company_memberships m
              where m.user_id = (select auth.uid()) and m.role in (''owner'', ''admin'')))',
      business_table);
  end loop;
end
$migration$;

grant update (name) on public.companies to authenticated;
create policy companies_rename_owner on public.companies for update to authenticated
  using (id in (select m.company_id from public.company_memberships m
                where m.user_id = (select auth.uid()) and m.role = 'owner'))
  with check (id in (select m.company_id from public.company_memberships m
                     where m.user_id = (select auth.uid()) and m.role = 'owner'));

commit;
