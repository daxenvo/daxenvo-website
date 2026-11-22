-- Test transactionnel À EXÉCUTER ultérieurement sur une base Supabase de développement,
-- après 001_company_foundation.sql, avec une connexion administrateur locale de test.
-- Non exécuté dans J7 : aucune base Supabase disponible. Toutes les données sont fictives.
begin;
insert into auth.users (id, email) values
 ('10000000-0000-4000-8000-000000000001', 'j7-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000002', 'j7-b@example.invalid');
insert into public.companies (id, name) values
 ('20000000-0000-4000-8000-000000000001', 'Entreprise fictive A'),
 ('20000000-0000-4000-8000-000000000002', 'Entreprise fictive B');
insert into public.company_memberships (company_id, user_id, role) values
 ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'member'),
 ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'member');
insert into public.prospects (id, company_id, name, sector, city) values
 ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Prospect fictif A', 'Conseil', 'Ville fictive'),
 ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Prospect fictif B', 'Conseil', 'Ville fictive');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.prospects) <> 1 then raise exception 'Isolation de lecture incorrecte'; end if;
  if (select count(*) from public.company_memberships) <> 1 then raise exception 'Lecture des adhésions incorrecte'; end if;
  if exists (select 1 from public.companies where id = '20000000-0000-4000-8000-000000000002') then
    raise exception 'Entreprise B visible depuis A';
  end if;
  begin
    insert into public.prospects (company_id, name, sector, city) values
      ('20000000-0000-4000-8000-000000000002', 'Interdit fictif', 'Conseil', 'Ville fictive');
    raise exception 'Insertion interentreprises autorisée';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.quote_requests (company_id, prospect_id, title, description) values
      ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Projet fictif', 'Projet de test fictif');
    raise exception 'Relation interentreprises autorisée';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.company_memberships set role = 'owner';
    raise exception 'Élévation de rôle autorisée';
  exception when insufficient_privilege then null;
  end;
  update public.prospects set name = 'Modification interdite' where id = '30000000-0000-4000-8000-000000000002';
  if found then raise exception 'Modification de B autorisée depuis A'; end if;
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.prospects;
    raise exception 'Lecture anonyme autorisée';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
